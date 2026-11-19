#!/usr/bin/env node
// Refreshes the data files of the student associations' follow-up page (D93): reads the completed
// Checkout Sessions of the pre-order payment link from Stripe, counts the paid and the refunded ones
// per association, and writes <hash>.json for each association whose counts changed. With --commit
// it commits and pushes those files, and only them. Run every night by the workflow
// cadence-associations of the Adminva site, where site/publish.mjs copies this file and its library.
//
//   node associations-sync.mjs --data <dir> --payment-link <plink_...> [--commit]
//
// Needs Node 22+ and two variables: STRIPE_RESTRICTED_KEY (a read-only restricted key, "rk_...")
// and CADENCE_ASSOCIATIONS (JSON: association key -> hash of its code). Without them it fails and
// writes nothing. Prints counts of files, never a key, a code, an association or a payment.
// Exit code 0 on success, 1 on failure. Verified on Windows (Node 24); the workflow runs on Linux.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { listSessions, nextFiles, parseMapping, redact, tally } from './associations-lib.mjs';

const ENV_KEY = 'STRIPE_RESTRICTED_KEY';
const ENV_MAPPING = 'CADENCE_ASSOCIATIONS';
const RESTRICTED_KEY = /^rk_(?:live|test)_[A-Za-z0-9]+$/;
const PAYMENT_LINK = /^plink_[A-Za-z0-9]+$/;
const STRIPE_TIMEOUT_MS = 30_000;
const DATA_EXT = '.json';
const COMMIT_MESSAGE = 'cadence: chiffres des associations';
/* The identity GitHub documents for commits made by a workflow. */
const BOT_IDENTITY = ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com'];

function readConfig(argv, env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      data: { type: 'string' },
      'payment-link': { type: 'string' },
      commit: { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (!values.data) {
    throw new Error('--data <dir> is required');
  }
  if (!PAYMENT_LINK.test(values['payment-link'] ?? '')) {
    throw new Error('--payment-link must be a Stripe payment link id (plink_...)');
  }
  const key = env[ENV_KEY] ?? '';
  if (!key) {
    throw new Error(`${ENV_KEY} is not set: nothing read, nothing written`);
  }
  if (!RESTRICTED_KEY.test(key)) {
    throw new Error(`${ENV_KEY} must be a restricted key (rk_live_... or rk_test_...), never a secret key`);
  }
  return { dataDir: path.resolve(values.data), paymentLink: values['payment-link'], commit: values.commit, key, mapping: parseMapping(env[ENV_MAPPING]) };
}

/** The data files there today: hash -> text. */
function readExisting(dataDir) {
  const existing = new Map();
  if (!fs.existsSync(dataDir)) {
    return existing;
  }
  for (const name of fs.readdirSync(dataDir)) {
    if (name.endsWith(DATA_EXT)) {
      existing.set(name.slice(0, -DATA_EXT.length), fs.readFileSync(path.join(dataDir, name), 'utf8'));
    }
  }
  return existing;
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr ?? result.error?.message ?? ''}`);
  }
  return result.stdout;
}

/** Commits the data folder and pushes, when git sees a change in it. */
function commitData(dataDir) {
  git(['add', '--', dataDir], dataDir);
  if (!git(['diff', '--cached', '--name-only', '--', dataDir], dataDir).trim()) {
    console.log('Nothing to commit.');
    return;
  }
  git([...BOT_IDENTITY, 'commit', '-q', '-m', COMMIT_MESSAGE], dataDir);
  git(['push', '-q'], dataDir);
  console.log('Committed and pushed.');
}

async function main() {
  const config = readConfig(process.argv.slice(2), process.env);
  const sessions = await listSessions({ key: config.key, paymentLink: config.paymentLink, fetch: globalThis.fetch, timeoutMs: STRIPE_TIMEOUT_MS });
  const tallies = tally(sessions, new Set(config.mapping.keys()));
  const files = nextFiles({ mapping: config.mapping, tallies, existing: readExisting(config.dataDir), now: new Date().toISOString() });
  fs.mkdirSync(config.dataDir, { recursive: true });
  for (const file of files) {
    fs.writeFileSync(path.join(config.dataDir, `${file.hash}${DATA_EXT}`), file.text);
  }
  console.log(`${config.mapping.size} association(s) followed, ${files.length} file(s) changed.`);
  if (config.commit && files.length) {
    commitData(config.dataDir);
  }
  return 0;
}

function fail(error) {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exit(1);
}

main().then((code) => { process.exitCode = code; }, fail);
