// Cadence site, the follow-up page of the student associations (site/DESIGN.md 6, D93). The
// association types the code it received; the browser computes its SHA-256 (the code itself is
// never sent, stored or put in the address), loads <data-dir><hash>.json and shows the counts the
// nightly job of the Adminva site wrote there. Copy lives in the page (data-* attributes); figures
// are formatted in the page's language. Without this script the page says it needs JavaScript.
// Loaded after site.js on the two follow-up pages; its pure helpers are window.CadencePortal.

const HASH_ALGORITHM = 'SHA-256';
const HEX_RADIX = 16;
const HEX_WIDTH = 2;
const CODE_SEPARATORS = /[\s-]+/g;
const DATA_EXT = '.json';
const DATA_VERSION = 1;
const STATUS_NOT_FOUND = 404;
const CENTS_PER_DOLLAR = 100;
const TIME_ZONE = 'America/Toronto';
const CURRENCY = 'CAD';
const FIGURES = ['confirmed', 'refunded', 'net'];
const COUNT_FIELDS = ['confirmed', 'refunded', 'net', 'centsPerNet', 'shareCents'];

/* ---------- Pure helpers (normalizeCode is site/associations-lib.mjs's, tested against it) ---------- */

function normalizeCode(code) {
  return String(code).replace(CODE_SEPARATORS, '').toUpperCase();
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(HEX_RADIX).padStart(HEX_WIDTH, '0')).join('');
}

/** The counts of a data file, or null when its shape is not the one the nightly job writes. */
function readCounts(value) {
  const isCount = (n) => Number.isInteger(n) && n >= 0;
  if (!value || value.version !== DATA_VERSION || Number.isNaN(Date.parse(value.updatedAt)) || !COUNT_FIELDS.every((k) => isCount(value[k]))) {
    return null;
  }
  return value;
}

function money(cents, lang) {
  return new Intl.NumberFormat(lang, { style: 'currency', currency: CURRENCY }).format(cents / CENTS_PER_DOLLAR);
}

function day(iso, lang) {
  return new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeZone: TIME_ZONE }).format(new Date(iso));
}

/* ---------- The page ---------- */

async function hashOf(code) {
  const digest = await window.crypto.subtle.digest(HASH_ALGORITHM, new window.TextEncoder().encode(code));
  return toHex(digest);
}

/** The counts for a code: { counts } when found, { missing: true } for an unknown code; throws otherwise. */
async function load(dir, code) {
  const response = await window.fetch(`${dir}${await hashOf(code)}${DATA_EXT}`, { cache: 'no-store' });
  if (response.status === STATUS_NOT_FOUND) {
    return { missing: true };
  }
  const counts = response.ok ? readCounts(await response.json()) : null;
  if (!counts) {
    throw new Error('unreadable counts');
  }
  return { counts };
}

/* The locale of the figures (data-locale): "en-CA" writes $14.30, where "en" would write CA$14.30. */
function show(part, counts) {
  const lang = part.locale;
  for (const name of FIGURES) {
    part.result.querySelector(`[data-figure="${name}"]`).textContent = new Intl.NumberFormat(lang).format(counts[name]);
  }
  part.result.querySelector('[data-figure="share"]').textContent = money(counts.shareCents, lang);
  part.result.querySelector('[data-rate]').textContent = money(counts.centsPerNet, lang);
  part.result.querySelector('[data-updated]').textContent = day(counts.updatedAt, lang);
  part.result.hidden = false;
  part.title.focus();
}

function say(part, key) {
  part.status.textContent = key ? part.status.dataset[key] : '';
}

function wirePortal(form) {
  const part = {
    input: form.querySelector('[data-code]'),
    button: form.querySelector('button'),
    status: document.querySelector('[data-status]'),
    result: document.querySelector('[data-result]'),
    title: document.querySelector('[data-result-title]'),
    locale: form.dataset.locale || document.documentElement.lang,
  };
  document.querySelectorAll('[data-nojs]').forEach((el) => { el.hidden = true; });
  form.hidden = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = normalizeCode(part.input.value);
    part.result.hidden = true;
    if (!code) {
      say(part, 'empty');
      part.input.focus();
      return;
    }
    say(part, 'busy');
    part.button.disabled = true;
    try {
      const found = await load(form.dataset.dir, code);
      say(part, found.missing ? 'unknown' : '');
      if (found.counts) {
        show(part, found.counts);
      }
    } catch {
      /* Offline, an old browser without crypto.subtle, or a damaged file: the same honest message. */
      say(part, 'error');
    } finally {
      part.button.disabled = false;
    }
  });
}

window.CadencePortal = { normalizeCode, toHex, readCounts, hashOf };

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-portal]').forEach(wirePortal);
  });
}
