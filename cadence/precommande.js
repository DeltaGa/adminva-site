// Cadence site, the pre-order page (site/DESIGN.md 6, D93). Opens the steps that
// site/sync-precommande.mjs writes in place of the plain payment link: where the student studies
// (required), then how they found us and, for a student association, which one (optional). The link
// to Stripe always carries the answer as its reference (data-param), built from the attributes of
// the page: data-reference on each answer, data-association on the one that names an association,
// the key of the association as its value. ?asso=<SIGLE> preselects that association. Nothing is
// sent anywhere or kept. Without this script the plain payment link stays. Loaded after site.js on
// the two pre-order pages only; its pure helpers are exposed as window.CadencePreorder for tests.

const ASSOCIATION_PARAM = 'asso';
const COUNT_TOKEN = '{n}';
const COMBINING_MARKS = /[\u0300-\u036f]/g;
const NOT_IN_KEY = /[^A-Z0-9-]/g;
const NOT_A_TERM = /[^a-z0-9]+/g;

/* ---------- Pure helpers (the same rules as site/associations-lib.mjs and precommande-lib.mjs) ---------- */

/** The sigle without accents, upper case, letters, digits and dashes: the key of an association. */
function keyOf(text) {
  return String(text).normalize('NFD').replace(COMBINING_MARKS, '').toUpperCase().replace(NOT_IN_KEY, '');
}

/** Lower case, without accents, words only: the terms a search is matched on. */
function termsOf(text) {
  return String(text).normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase().replace(NOT_A_TERM, ' ').trim();
}

/** Whether every word of the search is in the terms of a row. */
function matches(terms, query) {
  const words = termsOf(query).split(' ').filter(Boolean);
  return words.every((word) => terms.includes(word));
}

/** "ASSO" + "AENUM" -> "ASSO-AENUM" for the answer that names an association; the answer alone otherwise. */
function referenceOf(answer, isAssociation, key) {
  return isAssociation && key ? `${answer}-${key}` : answer;
}

/** The payment address with the reference in it. */
function paymentUrl(base, param, reference) {
  const url = new window.URL(base);
  url.searchParams.set(param, reference);
  return url.toString();
}

/* ---------- The page ---------- */

function checked(root, name) {
  return root.querySelector(`input[name="${name}"]:checked`);
}

function reveal(el) {
  if (!el.hidden) {
    return;
  }
  el.hidden = false;
  const ambient = window.CadenceAmbient;
  if (ambient && ambient.state.motion) {
    el.animate(
      [{ opacity: 0, transform: `translateY(${ambient.token('--rise')})` }, { opacity: 1, transform: 'none' }],
      { duration: ambient.ms('--d-rise'), easing: ambient.token('--ease-spring') },
    );
  }
}

function filterRows(part, school) {
  const query = part.search.value;
  let shown = 0;
  for (const row of part.rows) {
    const visible = row.dataset.school === school && matches(row.dataset.terms, query);
    row.hidden = !visible;
    shown += visible ? 1 : 0;
  }
  const count = part.count;
  if (!query.trim()) {
    count.textContent = '';
  } else if (shown === 0) {
    count.textContent = count.dataset.none;
  } else {
    count.textContent = (shown === 1 ? count.dataset.one : count.dataset.many).replace(COUNT_TOKEN, String(shown));
  }
}

function update(root, part) {
  const school = checked(root, 'school');
  if (!school) {
    return;
  }
  reveal(part.rest);
  const source = checked(root, 'source');
  const isAssociation = Boolean(source && source.hasAttribute('data-association'));
  if (isAssociation) {
    reveal(part.associations);
  } else {
    part.associations.hidden = true;
  }
  filterRows(part, school.value);
  /* A choice hidden by the search still stands; one of another school does not. */
  const association = checked(root, 'asso');
  const key = association && association.closest('label').dataset.school === school.value ? association.value : '';
  const reference = source ? referenceOf(source.dataset.reference, isAssociation, key) : root.dataset.none;
  part.go.href = paymentUrl(root.dataset.pay, root.dataset.param, reference);
}

/** ?asso=AENUM: the association answer and that association, chosen in advance. */
function preselect(root, part) {
  const wanted = keyOf(new window.URLSearchParams(window.location.search).get(ASSOCIATION_PARAM) || '');
  if (!wanted) {
    return;
  }
  const answer = root.querySelector('input[name="source"][data-association]');
  answer.checked = true;
  const row = part.rows.find((r) => r.querySelector('input').value === wanted);
  if (row) {
    row.querySelector('input').checked = true;
    part.search.value = row.querySelector('b').textContent;
  }
}

function wirePreorder(root) {
  const part = {
    rest: root.querySelector('[data-rest]'),
    associations: root.querySelector('[data-associations]'),
    search: root.querySelector('[data-search]'),
    count: root.querySelector('[data-count]'),
    rows: [...root.querySelectorAll('[data-list] .choice')],
    go: root.querySelector('[data-go]'),
  };
  const plain = document.querySelector('[data-pay-plain]');
  if (plain) {
    plain.hidden = true;
  }
  root.hidden = false;
  preselect(root, part);
  root.addEventListener('change', () => update(root, part));
  part.search.addEventListener('input', () => update(root, part));
  /* Back from Stripe: the browser restores the choices; the link follows them. */
  window.addEventListener('pageshow', () => update(root, part));
  update(root, part);
}

window.CadencePreorder = { keyOf, termsOf, matches, referenceOf, paymentUrl };

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-preorder]').forEach(wirePreorder);
  });
}
