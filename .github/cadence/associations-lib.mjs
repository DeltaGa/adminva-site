// @ts-check
// The pure part of the follow-up of the student associations (site/DESIGN.md 6, D93): the codes an
// association types (alphabet, format, hash), the key of an association in a Stripe reference, the
// reading of the paid Checkout Sessions of the pre-order link, the counts per association, and the
// data files the portal reads. Needs nothing but node:crypto: site/publish.mjs copies it, beside
// associations-sync.mjs, into the Adminva site, where the nightly workflow runs it. The Stripe
// reader takes `fetch` as an argument; nothing here touches a file, the clock or the console.
import { createHash } from 'node:crypto';

/** No 0/O, 1/I/L, U: a code read aloud or copied by hand has one spelling. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 16 characters of a 30-letter alphabet: about 78 bits, out of reach of a search by hash. */
export const CODE_LENGTH = 16;
const CODE_GROUP = 4;
const CODE_SEPARATORS = /[\s-]+/g;
/** The prefix of the reference that names an association ("ASSO-AENUM"); "ASSO" alone names none. */
export const ASSOCIATION_PREFIX = 'ASSO';
const PREFIX_DASH = `${ASSOCIATION_PREFIX}-`;
const COMBINING_MARKS = /[\u0300-\u036f]/g;
const NOT_IN_KEY = /[^A-Z0-9-]/g;
const KEY = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const HASH = /^[0-9a-f]{64}$/;
/** Business rule of the partnership: 1,30 $ per net pre-order, paid at launch (D93). */
export const SHARE_CENTS_PER_NET = 130;
/** A personal rebate: 25 % of the pre-order price (6,49 $), rounded down to the cent (D99). */
const PERSONAL_CENTS_PER_NET = 162;
export const DATA_VERSION = 1;
const STRIPE_SESSIONS = 'https://api.stripe.com/v1/checkout/sessions';
const STRIPE_PAGE_SIZE = 100;
/* 1000 pages of 100: far above the pre-orders of one term; a loop that would not end stops. */
const STRIPE_MAX_PAGES = 1000;
const STRIPE_EXPAND = 'data.payment_intent.latest_charge';
const PAID = 'paid';
const KEY_IN_TEXT = /\b[rs]k_(?:live|test)_[A-Za-z0-9*]+/g;

/** @typedef {{ confirmed: number, refunded: number }} Tally */
/** @typedef {{ of: string, centsPerNet: number }} View */
/**
 * @typedef {{ version: number, updatedAt: string, confirmed: number, refunded: number, net: number,
 *   centsPerNet: number, shareCents: number, personal?: true }} CountsFile
 */
/**
 * The personal follow-up views (D99): a key and a code of their own, so that the code of the
 * association never shows the rebate; the counts are those of the association `of`, at their own rate.
 * @type {Map<string, View>}
 */
export const PERSONAL_VIEWS = new Map([['AENUM-PERSO', { of: 'AENUM', centsPerNet: PERSONAL_CENTS_PER_NET }]]);
const NO_COUNT = Object.freeze({ confirmed: 0, refunded: 0 });
/** @typedef {(url: string, init: { headers: Record<string, string>, signal?: AbortSignal }) => Promise<{ ok: boolean, status: number, json: () => Promise<unknown> }>} Fetch */

/**
 * A new code, in groups of four ("7KQ4-M2XD-..."), from a source of random integers in [0, max).
 * @param {(max: number) => number} randomInt crypto.randomInt in the script; a fixed source in tests
 * @returns {string}
 */
export function newCode(randomInt) {
  let raw = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return raw.match(new RegExp(`.{${CODE_GROUP}}`, 'g'))?.join('-') ?? raw;
}

/**
 * A code as typed, reduced to what is hashed: spaces and dashes removed, upper case.
 * site/associations.js does the same in the browser (tested against this function).
 * @param {string} code
 * @returns {string}
 */
export function normalizeCode(code) {
  return code.replace(CODE_SEPARATORS, '').toUpperCase();
}

/**
 * The name of an association's data file, without ".json": the SHA-256 of its code, in hex.
 * @param {string} code
 * @returns {string}
 */
export function codeHash(code) {
  return createHash('sha256').update(normalizeCode(code), 'utf8').digest('hex');
}

/**
 * The key of an association in a Stripe reference: its sigle without accents, upper case, letters,
 * digits and dashes only (an accented letter loses its accent, "AEPUM-CS" stays). "" when nothing is left.
 * @param {string} sigle
 * @returns {string}
 */
export function associationKey(sigle) {
  return sigle.normalize('NFD').replace(COMBINING_MARKS, '').toUpperCase().replace(NOT_IN_KEY, '');
}

/**
 * The association a Stripe reference credits, as a key: "ASSO-AENUM" and, for the links handed out
 * before the pre-order page, the bare sigle "AENUM". Null for a reference that names none.
 * @param {string | null | undefined} reference
 * @returns {string | null}
 */
export function keyOfReference(reference) {
  if (!reference) {
    return null;
  }
  const upper = reference.toUpperCase();
  const key = upper.startsWith(PREFIX_DASH) ? upper.slice(PREFIX_DASH.length) : upper;
  return KEY.test(key) ? key : null;
}

/**
 * The secret CADENCE_ASSOCIATIONS: a JSON object from the key of each association to the hash of
 * its code. Throws, naming the problem but never a value, on anything else.
 * @param {string | undefined} text
 * @returns {Map<string, string>}
 */
export function parseMapping(text) {
  if (!text?.trim()) {
    throw new Error('CADENCE_ASSOCIATIONS is empty');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    /* The text is a secret: the parser's message would quote it. */
    throw new Error('CADENCE_ASSOCIATIONS is not JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('CADENCE_ASSOCIATIONS must be an object of key -> hash');
  }
  const mapping = new Map();
  for (const [key, hash] of Object.entries(value)) {
    if (!KEY.test(key) || typeof hash !== 'string' || !HASH.test(hash)) {
      throw new Error('CADENCE_ASSOCIATIONS holds an entry that is not key -> 64 hex digits');
    }
    mapping.set(key, hash);
  }
  if (mapping.size === 0) {
    throw new Error('CADENCE_ASSOCIATIONS names no association');
  }
  return mapping;
}

/**
 * Whether a paid session was refunded in full (a partial refund leaves the pre-order standing).
 * Throws on a paid session whose charge Stripe did not return: a count is never guessed.
 * @param {any} session a Checkout Session with data.payment_intent.latest_charge expanded
 * @returns {boolean}
 */
function isRefunded(session) {
  const charge = session?.payment_intent?.latest_charge;
  if (typeof charge !== 'object' || charge === null || typeof charge.refunded !== 'boolean') {
    throw new Error('A paid Checkout Session came without its charge: can the key read PaymentIntents and Charges?');
  }
  return charge.refunded;
}

/**
 * Pre-orders per association: confirmed (paid), and among them refunded. Sessions are counted once
 * by id; unpaid ones and references that name no known association are left out. A followed
 * personal view (PERSONAL_VIEWS) gets a copy of the counts of its association, followed or not,
 * and never a session of its own. O(n).
 * @param {Iterable<any>} sessions
 * @param {Set<string>} keys the associations followed
 * @returns {Map<string, Tally>} every followed key, zero when it has none
 */
export function tally(sessions, keys) {
  /** @param {string} key */
  const countedAs = (key) => PERSONAL_VIEWS.get(key)?.of ?? key;
  const counts = countSessions(sessions, new Set([...keys].map(countedAs)));
  return new Map([...keys].map((key) => [key, { ...(counts.get(countedAs(key)) ?? NO_COUNT) }]));
}

/**
 * The counts of the paid sessions whose reference names one of `keys`.
 * @param {Iterable<any>} sessions
 * @param {Set<string>} keys
 * @returns {Map<string, Tally>}
 */
function countSessions(sessions, keys) {
  const counts = new Map([...keys].map((key) => [key, { confirmed: 0, refunded: 0 }]));
  const seen = new Set();
  for (const session of sessions) {
    if (session?.payment_status !== PAID || seen.has(session.id)) {
      continue;
    }
    seen.add(session.id);
    const key = keyOfReference(session.client_reference_id);
    const count = key === null ? undefined : counts.get(key);
    if (!count) {
      continue;
    }
    count.confirmed += 1;
    count.refunded += isRefunded(session) ? 1 : 0;
  }
  return counts;
}

/**
 * The data file of one association, or of a personal view (its rate, and `personal: true`).
 * @param {Tally} count
 * @param {string} updatedAt ISO instant of the change
 * @param {View} [view] PERSONAL_VIEWS.get(key); absent for an association
 * @returns {CountsFile}
 */
export function countsFile(count, updatedAt, view) {
  const net = count.confirmed - count.refunded;
  const centsPerNet = view?.centsPerNet ?? SHARE_CENTS_PER_NET;
  /** @type {CountsFile} */
  const file = { version: DATA_VERSION, updatedAt, confirmed: count.confirmed, refunded: count.refunded, net, centsPerNet, shareCents: net * centsPerNet };
  if (view) {
    file.personal = true;
  }
  return file;
}

/**
 * A data file as read back, or null when its shape is not the one this module writes
 * (`personal` is absent, as in the files written before D99, or true).
 * @param {string} text
 * @returns {CountsFile | null}
 */
export function readCounts(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    /* A damaged file is rewritten from Stripe, like a missing one. */
    return null;
  }
  const numbers = ['confirmed', 'refunded', 'net', 'centsPerNet', 'shareCents'];
  const isCount = (n) => Number.isInteger(n) && n >= 0;
  if (value?.version !== DATA_VERSION || typeof value.updatedAt !== 'string' || !numbers.every((k) => isCount(value[k]))) {
    return null;
  }
  if (value.personal !== undefined && value.personal !== true) {
    return null;
  }
  return value;
}

/** @param {CountsFile} a @param {CountsFile} b */
function sameCounts(a, b) {
  return a.confirmed === b.confirmed && a.refunded === b.refunded && a.centsPerNet === b.centsPerNet && a.personal === b.personal;
}

/**
 * The files to write: one per followed association whose counts changed, or whose file is missing
 * or unreadable. A file whose counts did not change keeps its date: nothing to commit that night.
 * @param {{ mapping: Map<string, string>, tallies: Map<string, Tally>, existing: Map<string, string>, now: string }} input
 *   existing: hash -> text of the file today; now: ISO instant of the run
 * @returns {{ hash: string, text: string }[]} sorted by hash
 */
export function nextFiles({ mapping, tallies, existing, now }) {
  const files = [];
  for (const [key, hash] of mapping) {
    const next = countsFile(tallies.get(key) ?? NO_COUNT, now, PERSONAL_VIEWS.get(key));
    const before = readCounts(existing.get(hash) ?? '');
    if (before && sameCounts(before, next)) {
      continue;
    }
    files.push({ hash, text: `${JSON.stringify(next, null, 2)}\n` });
  }
  return files.sort((a, b) => (a.hash < b.hash ? -1 : 1));
}

/**
 * A message from Stripe or from this module, with any API key in it masked.
 * @param {string} text
 * @returns {string}
 */
export function redact(text) {
  return text.replace(KEY_IN_TEXT, '[key]');
}

/**
 * The address of one page of the Checkout Sessions of a payment link, completed ones only.
 * @param {string} paymentLink "plink_..."
 * @param {string | null} after the id of the last session of the previous page
 * @returns {string}
 */
export function sessionsUrl(paymentLink, after) {
  const url = new URL(STRIPE_SESSIONS);
  url.searchParams.set('payment_link', paymentLink);
  url.searchParams.set('status', 'complete');
  url.searchParams.set('limit', String(STRIPE_PAGE_SIZE));
  url.searchParams.append('expand[]', STRIPE_EXPAND);
  if (after) {
    url.searchParams.set('starting_after', after);
  }
  return url.toString();
}

/**
 * Every completed Checkout Session of the payment link, page after page. Throws on any answer that
 * is not a list (with Stripe's message, the key masked): a count is never built from half a list.
 * @param {{ key: string, paymentLink: string, fetch: Fetch, timeoutMs: number }} options
 * @returns {Promise<any[]>}
 */
export async function listSessions({ key, paymentLink, fetch, timeoutMs }) {
  const sessions = [];
  let after = null;
  for (let page = 0; page < STRIPE_MAX_PAGES; page++) {
    const response = await fetch(sessionsUrl(paymentLink, after), {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = /** @type {any} */ (await response.json().catch(() => null));
    if (!response.ok || !Array.isArray(body?.data)) {
      const reason = typeof body?.error?.message === 'string' ? body.error.message : 'no list in the answer';
      throw new Error(redact(`Stripe answered ${response.status}: ${reason}`));
    }
    sessions.push(...body.data);
    const last = body.data.at(-1);
    if (!body.has_more || !last) {
      return sessions;
    }
    after = last.id;
  }
  throw new Error(`More than ${STRIPE_MAX_PAGES} pages of sessions: stopped`);
}
