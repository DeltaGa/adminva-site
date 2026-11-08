// Cadence site (site/DESIGN.md 5, D60). Marks <html> with "js", and with "motion" unless the reader
// asks for reduced motion or paused it, before the first paint. Then starts the ambience (ambient.js)
// and runs the page: the spoken week of the opening, the moods of the story (red week, gold), the
// reveals, the memory card and the pause button. Without this script every element is simply there,
// in its final state. Loaded in <head> by every page after ambient.js, without defer. Curves and
// durations are read from the tokens of site/style.css; none is written here.

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const PAUSE_KEY = 'cadence-motion-paused';
const PAUSE_ON = '1';
const REVEAL_THRESHOLD = 0.1;
const REVEAL_ROOT_MARGIN = '0px 0px -8% 0px';
/* A mood holds while its element crosses the middle fifth of the screen. */
const MOOD_ROOT_MARGIN = '-40% 0px -40% 0px';

/* The welcome scene (DESIGN.md 15.2: one vocal beat, then the next). */
const SCENE_DELAY_S = 1.8;
const BEAT = { act: 1.1, leave: 2.9, next: 3.9, ghost: 0.6 };
const BEATS = ['move', 'cancel', 'add'];
const LIFT_SCALE = 1.06;
const LIFT_SHARE = 0.2;
const DROP_PX = -28;
const DROP_STRETCH = 1.12;

const ambient = window.CadenceAmbient;
/* The scene of the opening, once started; the pause button finishes it. */
const sceneState = { scene: null };

/* ---------- The welcome scene (site/DESIGN.md 5.3) ---------- */

function flip(el, change, easing) {
  const before = el.getBoundingClientRect();
  change();
  const after = el.getBoundingClientRect();
  const dx = before.left - after.left;
  const dy = before.top - after.top;
  const move = `translate(${dx}px, ${dy}px)`;
  el.animate(
    [
      { transform: move, easing: ambient.token('--ease-out') },
      { transform: `${move} scale(${LIFT_SCALE})`, offset: LIFT_SHARE, easing },
      { transform: 'none' },
    ],
    { duration: ambient.ms('--d-move') / (1 - LIFT_SHARE) },
  );
}

function sceneSteps() {
  const steps = [];
  BEATS.forEach((action, n) => {
    const beatAt = SCENE_DELAY_S + n * BEAT.next;
    steps.push({ at: beatAt, run: (s) => say(s, n, true) });
    if (action === 'add') {
      steps.push({ at: beatAt + BEAT.ghost, run: (s) => s.host.classList.add('at-ghost') });
    }
    steps.push({ at: beatAt + BEAT.act, run: (s) => act(s, action) });
    if (n < BEATS.length - 1) {
      steps.push({ at: beatAt + BEAT.leave, run: (s) => say(s, n, false) });
    }
  });
  steps.push({ at: SCENE_DELAY_S + (BEATS.length - 1) * BEAT.next + BEAT.leave, run: finishScene });
  return steps;
}

function say(scene, n, on) {
  scene.bubbles.forEach((b, i) => b.classList.toggle('is-on', on && i === n));
  if (ambient.state.orb) {
    ambient.state.orb.target = on ? 1 : 0;
  }
}

function act(scene, action) {
  const host = scene.host;
  if (action === 'move') {
    flip(host.querySelector('.b-labo'), () => host.classList.add('at-move'), ambient.token('--ease-spring'));
  } else if (action === 'cancel') {
    host.classList.add('at-cancel');
  } else {
    host.classList.add('at-add');
    host.querySelector('.b-meet').animate(
      [{ opacity: 0, transform: `translateY(${DROP_PX}px) scaleY(${DROP_STRETCH})` }, { opacity: 1, transform: 'none' }],
      { duration: ambient.ms('--d-release'), easing: ambient.token('--ease-bounce') },
    );
  }
  if (ambient.state.orb) {
    ambient.state.orb.target = 0;
  }
  ambient.fire(ambient.events.scene);
}

function finishScene(scene) {
  scene.host.classList.add('is-done');
  scene.host.classList.remove('at-move', 'at-cancel', 'at-ghost', 'at-add');
  scene.bubbles.forEach((b) => b.classList.remove('is-on'));
  scene.clock = Infinity;
  if (ambient.state.orb) {
    ambient.state.orb.target = 0;
  }
  scene.replay.hidden = ambient.state.reduced;
}

function startScene(scene) {
  scene.host.classList.remove('is-done', 'at-move', 'at-cancel', 'at-ghost', 'at-add');
  scene.clock = 0;
  scene.next = 0;
  scene.replay.hidden = true;
  ambient.wake();
}

function tickScene(scene, dt) {
  if (scene.clock === Infinity) {
    return;
  }
  scene.clock += dt;
  while (scene.next < scene.steps.length && scene.steps[scene.next].at <= scene.clock) {
    scene.steps[scene.next].run(scene);
    scene.next += 1;
  }
}

function makeScene(host) {
  const scene = { host, bubbles: [...host.querySelectorAll('.bubble')], replay: host.querySelector('[data-replay]'), steps: sceneSteps(), clock: Infinity, next: 0 };
  scene.replay.addEventListener('click', () => {
    if (!ambient.state.motion) {
      setPaused(false);
    }
    startScene(scene);
  });
  if (ambient.state.motion) {
    startScene(scene);
  } else {
    finishScene(scene);
  }
  return scene;
}

/* ---------- Reveals, spoken phrases, moods ---------- */

function observeOnce(selector, className) {
  const items = document.querySelectorAll(selector);
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add(className));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add(className);
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: REVEAL_THRESHOLD, rootMargin: REVEAL_ROOT_MARGIN });
  items.forEach((el) => observer.observe(el));
}

function watchMoods() {
  const moods = document.querySelectorAll('[data-mood], [data-event]');
  if (!moods.length || !('IntersectionObserver' in window)) {
    return;
  }
  const fired = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const el = entry.target;
      if (el.dataset.mood === 'red') {
        ambient.state.redTarget = entry.isIntersecting ? 1 : 0;
      } else if (entry.isIntersecting && !fired.has(el)) {
        fired.add(el);
        ambient.fire(ambient.events.finished);
      }
    }
    ambient.wake();
  }, { rootMargin: MOOD_ROOT_MARGIN });
  moods.forEach((el) => observer.observe(el));
}

/* ---------- The memory card: Confirmer, Pas vraiment, Revoir ---------- */

function wireMemory(card) {
  const part = (name) => card.querySelector(`[data-${name}]`);
  const proposal = part('proposal');
  const added = part('new');
  const done = part('done');
  const live = part('live');
  const answers = card.querySelectorAll('[data-said]');
  part('actions').hidden = false;
  const answer = (yes) => {
    proposal.classList.add('is-leaving');
    window.setTimeout(() => {
      proposal.hidden = true;
      proposal.classList.remove('is-leaving');
      added.hidden = !yes;
      answers.forEach((p) => { p.hidden = p.dataset.said !== (yes ? 'yes' : 'no'); });
      done.hidden = false;
      live.textContent = card.querySelector(`[data-said="${yes ? 'yes' : 'no'}"]`).textContent;
      part('again').focus();
      if (yes && ambient.state.motion) {
        added.animate([{ opacity: 0, transform: `translateY(${-DROP_PX}px)` }, { opacity: 1, transform: 'none' }], { duration: ambient.ms('--d-rise'), easing: ambient.token('--ease-spring') });
      }
      if (yes) {
        ambient.fire(ambient.events.applied);
      }
    }, ambient.state.motion ? ambient.ms('--d-exit') : 0);
  };
  part('yes').addEventListener('click', () => answer(true));
  part('no').addEventListener('click', () => answer(false));
  part('again').addEventListener('click', () => {
    added.hidden = true;
    done.hidden = true;
    proposal.hidden = false;
    live.textContent = '';
    part('yes').focus();
  });
}

/* ---------- Pause (WCAG 2.2.2) ---------- */

function readPaused() {
  try {
    return window.localStorage.getItem(PAUSE_KEY) === PAUSE_ON;
  } catch {
    /* Storage can be refused (private mode): the choice then lasts for the page only. */
    return false;
  }
}

function storePaused(paused) {
  try {
    if (paused) {
      window.localStorage.setItem(PAUSE_KEY, PAUSE_ON);
    } else {
      window.localStorage.removeItem(PAUSE_KEY);
    }
  } catch {
    /* Storage can be refused (private mode): the choice then lasts for the page only. */
  }
}

function setPaused(paused) {
  ambient.state.motion = !paused && !ambient.state.reduced;
  document.documentElement.classList.toggle('motion', ambient.state.motion);
  storePaused(paused);
  document.querySelectorAll('.motion-toggle').forEach((b) => b.setAttribute('aria-pressed', String(paused)));
  if (paused && sceneState.scene) {
    finishScene(sceneState.scene);
  }
  ambient.wake();
}

/* ---------- Start ---------- */

function start() {
  ambient.start();
  const sceneHost = document.querySelector('[data-scene]');
  if (sceneHost) {
    const scene = makeScene(sceneHost);
    ambient.state.onTick = (dt) => tickScene(scene, dt);
    sceneState.scene = scene;
  }
  document.querySelectorAll('[data-memory]').forEach(wireMemory);
  document.querySelectorAll('.motion-toggle').forEach((button) => {
    button.hidden = ambient.state.reduced;
    button.setAttribute('aria-pressed', String(!ambient.state.motion && !ambient.state.reduced));
    button.addEventListener('click', () => setPaused(ambient.state.motion));
  });
  observeOnce('[data-reveal]', 'is-in');
  observeOnce('[data-say]', 'is-said');
  watchMoods();
}

/* Before the first paint: the classes that the stylesheet keys its motion on. */
function boot() {
  ambient.state.reduced = window.matchMedia(REDUCED_MOTION_QUERY).matches;
  ambient.state.motion = !ambient.state.reduced && !readPaused();
  document.documentElement.classList.add('js');
  document.documentElement.classList.toggle('motion', ambient.state.motion);
  document.addEventListener('DOMContentLoaded', start);
}

boot();
