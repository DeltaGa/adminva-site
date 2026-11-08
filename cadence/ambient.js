// The living ambience of the Cadence site (site/DESIGN.md 5.2, D60): the app's five lights behind
// frosted glass (app/src/ambient), its moods (red week, gold events), and the voice orb
// (app/src/components/Orb.tsx), drawn by one frame loop. Loaded in <head> before site.js, which
// starts it and drives it through window.CadenceAmbient. Colours are read from the tokens of
// site/style.css; none is written here. Without this script the CSS draws the same lights, still.

const MS_PER_S = 1000;

/* The ambience (DESIGN.md 4; app/src/ambient/engine.ts, AmbientCanvas.tsx, envelope.ts). */
const AMBIENT_WIDTH_PX = 64;
const AMBIENT_MIN_HEIGHT_PX = 24;
const AMBIENT_MAX_HEIGHT_PX = 160;
const BLOB_RADIUS_OF_SHORT_SIDE = 0.95;
const IDLE_FPS = 30;
const MAX_FRAME_S = 0.1;
const EASE_RATE = 1.4;
const SETTLE = 0.002;
const INITIAL_TIME_S = 40;
const RED_SPEEDS_DRIFT = 0.7;
const NIGHT_LIGHTS = ['--amb-blue', '--amb-indigo', '--amb-teal', '--amb-navy', '--amb-plum'];
const DAY_LIGHTS = ['--amb-day-blue', '--amb-day-lavender', '--amb-day-aqua', '--amb-day-peach', '--amb-day-sky'];
/* The app's trajectories (blobMotion), radius breathing and mood weights. */
const DRIFT = { sx: 0.11, sxStep: 0.031, sy: 0.083, syStep: 0.027, syTurn: 7, syMod: 5, px: 0.4, pxStep: 1.9, py: 1.1, pyStep: 2.7, prStep: 1.3 };
const SWAY = { x: 0.55, x2: 0.08, x2Rate: 2.3, y: 0.46, y2: 0.06, y2Rate: 1.9, breathe: 0.22, breatheRate: 0.37 };
const MOOD = { redBeatFloor: 0.72, redBeat: 0.28, emberWeight: 0.8, redGrow: 0.18, goldGrow: 0.3, goldAlpha: 0.4, redAlpha: 0.45, alphaCap: 0.95, baseRed: 0.85, baseGold: 0.7, goldOdd: 1, goldEven: 0.75 };
const RED_LIGHTS = [0, 3];
const GRADIENT_MID = { stop: 0.55, alpha: 0.45 };
const HEARTBEAT = { periodS: 2.4, pulses: [{ center: 0.1, width: 0.06, weight: 1 }, { center: 0.38, width: 0.07, weight: 0.7 }] };
const ATTACK_EXPONENT = 3;
/* Gold events of DESIGN.md 6: a block checked (the interlude), a change applied, an action of the welcome scene. */
const EVENTS = {
  finished: { gold: 0.85, speed: 5, a: 0.45, h: 0.7, d: 3.4 },
  applied: { gold: 0.4, speed: 3, a: 0.3, h: 0.3, d: 2 },
  scene: { gold: 0.3, speed: 3.5, a: 0.3, h: 0.3, d: 2 },
};
/* WCAG 2.2 relative luminance, with its textbook constants. */
const SRGB = { max: 255, threshold: 0.04045, low: 12.92, offset: 0.055, scale: 1.055, gamma: 2.4, linearLimit: 0.0031308 };
const LUMA = [0.2126, 0.7152, 0.0722];
const DARK_GROUND = 0.5;

/* The orb (DESIGN.md 7). Its canvas holds the widest glow: R * 1.15 * 1.67, plus 10 %. */
const ORB_CANVAS_PER_RADIUS = 2 * 1.1 * 1.15 * 1.67;
const ORB_MAX_DPR = 2;
const ORB = { still: 2.4, breathe: 0.03, breatheRate: 1.5, voiceGrow: 0.12, voiceClock: 2, glow: 1.32, glowVoice: 0.35, glowFrom: 0.75, glowAlpha: 0.5, glowAlphaVoice: 0.3, rim: 0.75, rimWidth: 1.5 };
const ORB_LIGHT = { rate: 0.9, rateStep: 0.37, phase: 1.7, orbit: 0.38, orbitSway: 0.12, orbitRate: 0.7, orbitVoice: 0.5, yRatio: 1.21, size: 0.62, sizeSway: 0.15, sizeRate: 1.3, sizeVoice: 0.25, smallLast: 0.55, redMix: 0.6, goldMix: 0.5 };
const ORB_BODY = { dx: 0.3, dy: 0.35, r: 1.1, goldCore: 0.7, goldEdge: 0.6, specDx: 0.35, specDy: 0.42, specR: 0.7, shadeDy: 1.1, shadeR: 1.25, shadeFrom: 0.16 };
/* A voice that rises and falls while the student speaks. */
const VOICE = { base: 0.45, swing: 0.35, rateA: 7, rateB: 2.3, ease: 8 };

/* The page's one state, shared by the frame loop and the handlers of this script. */
const state = { motion: false, reduced: false, lights: null, events: [], red: 0, redTarget: 0, gold: 0, speed: 0, T: INITIAL_TIME_S, beatClock: 0, acc: 0, last: 0, running: false, ambient: null, orb: null, onTick: null };

/* ---------- Tokens ---------- */

function token(name) {
  return window.getComputedStyle(document.body).getPropertyValue(name).trim();
}

/** A CSS colour token as [r, g, b, a]. */
function colour(name) {
  const value = token(name);
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1);
  }
  const parts = (value.match(/[\d.]+/g) || []).map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts.length > 3 ? parts[3] : 1];
}

function seconds(name) {
  const value = token(name);
  return value.endsWith('ms') ? parseFloat(value) / MS_PER_S : parseFloat(value);
}

function rgba(c, alpha) {
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${alpha})`;
}

function mix(a, b, t) {
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t);
}

/* Towards gold with the app's softened weight 1 - (1 - t)^2 (DESIGN.md 4.3). */
function mixGold(a, gold, t) {
  return mix(a, gold, 1 - (1 - t) * (1 - t));
}

/* ---------- Ambient arithmetic (app/src/ambient/envelope.ts) ---------- */

function beatAt(s) {
  const x = s % HEARTBEAT.periodS;
  return HEARTBEAT.pulses.reduce((sum, p) => sum + p.weight * Math.exp(-(((x - p.center) / p.width) ** 2)), 0);
}

function envelopeAt(ev, elapsed) {
  if (elapsed < ev.a) {
    return 1 - (1 - elapsed / ev.a) ** ATTACK_EXPONENT;
  }
  if (elapsed < ev.a + ev.h) {
    return 1;
  }
  return 0.5 * (1 + Math.cos((Math.PI * (elapsed - ev.a - ev.h)) / ev.d));
}

function fire(ev) {
  state.events.push({ ...ev, t0: null });
  wake();
}

function stepEvents(now) {
  let glow = 0;
  let speed = 0;
  state.events = state.events.filter((ev) => {
    const t0 = ev.t0 === null ? now : ev.t0;
    ev.t0 = t0;
    const elapsed = now - t0;
    if (elapsed >= ev.a + ev.h + ev.d) {
      return false;
    }
    const strength = envelopeAt(ev, elapsed);
    glow = Math.max(glow, strength * ev.gold);
    speed = Math.max(speed, strength * ev.speed);
    return true;
  });
  state.gold = glow;
  state.speed = speed;
}

/* ---------- Ambient drawing ---------- */

function readLights() {
  const night = document.body.classList.contains('night');
  const names = night ? NIGHT_LIGHTS : DAY_LIGHTS;
  const ground = colour(night ? '--amb-base' : '--amb-day-base');
  const dark = luminanceOf(ground.map((v) => v / SRGB.max)) < DARK_GROUND;
  return {
    base: ground,
    blobs: names.map(colour),
    additive: dark,
    dark,
    bound: parseFloat(token(dark ? '--amb-max-l' : '--amb-min-l')),
    red: [colour('--amb-red-1'), colour('--amb-red-2')],
    ember: colour('--amb-ember'),
    redBase: colour('--amb-red-base'),
    goldLight: colour('--amb-gold'),
    goldBase: colour('--amb-gold-base'),
  };
}

function toLinear(v) {
  return v <= SRGB.threshold ? v / SRGB.low : ((v + SRGB.offset) / SRGB.scale) ** SRGB.gamma;
}

function toSrgb(v) {
  return v <= SRGB.linearLimit ? v * SRGB.low : SRGB.scale * v ** (1 / SRGB.gamma) - SRGB.offset;
}

function luminanceOf(c) {
  return LUMA[0] * toLinear(c[0]) + LUMA[1] * toLinear(c[1]) + LUMA[2] * toLinear(c[2]);
}

function makeAmbient(host) {
  const canvas = document.createElement('canvas');
  canvas.className = 'ambient__canvas';
  host.prepend(canvas);
  const linear = Array.from({ length: SRGB.max + 1 }, (_, i) => toLinear(i / SRGB.max));
  return { host, canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }), linear, w: 0, h: 0 };
}

function sizeAmbient(amb) {
  const ratio = window.innerHeight / Math.max(1, window.innerWidth);
  amb.w = AMBIENT_WIDTH_PX;
  amb.h = Math.round(Math.min(AMBIENT_MAX_HEIGHT_PX, Math.max(AMBIENT_MIN_HEIGHT_PX, AMBIENT_WIDTH_PX * ratio)));
  amb.canvas.width = amb.w;
  amb.canvas.height = amb.h;
}

function blobColour(L, i, red, beat) {
  const isRed = RED_LIGHTS.includes(i);
  const redNow = red * (MOOD.redBeatFloor + MOOD.redBeat * beat);
  let c = isRed ? mix(L.blobs[i], L.red[RED_LIGHTS.indexOf(i)], redNow) : mix(L.blobs[i], L.ember, red * MOOD.emberWeight);
  c = mixGold(c, L.goldLight, state.gold * (i % 2 ? MOOD.goldOdd : MOOD.goldEven));
  const alpha = Math.min(MOOD.alphaCap, L.blobs[i][3] * (1 + MOOD.goldAlpha * state.gold + (isRed ? MOOD.redAlpha * redNow : 0)));
  return { c, alpha, grow: isRed ? 1 + MOOD.redGrow * redNow : 1 };
}

function drawBlob(amb, L, i, beat) {
  const { w, h, ctx } = amb;
  const T = state.T;
  const sx = DRIFT.sx + i * DRIFT.sxStep;
  const sy = DRIFT.sy + ((i * DRIFT.syTurn) % DRIFT.syMod) * DRIFT.syStep;
  const px = i * DRIFT.pxStep + DRIFT.px;
  const py = i * DRIFT.pyStep + DRIFT.py;
  const x = w * (0.5 + SWAY.x * Math.sin(T * sx + px) + SWAY.x2 * Math.sin(T * sx * SWAY.x2Rate + py));
  const y = h * (0.5 + SWAY.y * Math.sin(T * sy + py) + SWAY.y2 * Math.cos(T * sy * SWAY.y2Rate + px));
  const look = blobColour(L, i, state.red, beat);
  const short = Math.min(w, h / 2);
  const r = short * BLOB_RADIUS_OF_SHORT_SIDE * (1 + SWAY.breathe * Math.sin(T * SWAY.breatheRate + i * DRIFT.prStep)) * (1 + MOOD.goldGrow * state.gold) * look.grow;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(look.c, look.alpha));
  g.addColorStop(GRADIENT_MID.stop, rgba(look.c, look.alpha * GRADIENT_MID.alpha));
  g.addColorStop(1, rgba(look.c, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/* Bounds every pixel's luminance so that text laid on the ambience keeps its contrast (D60). */
function boundLuminance(amb, L) {
  const image = amb.ctx.getImageData(0, 0, amb.w, amb.h);
  const px = image.data;
  const lin = amb.linear;
  for (let p = 0; p < px.length; p += 4) {
    const r = lin[px[p]];
    const g = lin[px[p + 1]];
    const b = lin[px[p + 2]];
    const y = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
    const over = L.dark ? y > L.bound : y < L.bound;
    if (over) {
      const k = L.dark ? L.bound / y : (1 - L.bound) / (1 - y);
      const fit = (v) => Math.round(SRGB.max * toSrgb(L.dark ? v * k : 1 - (1 - v) * k));
      px[p] = fit(r);
      px[p + 1] = fit(g);
      px[p + 2] = fit(b);
    }
  }
  amb.ctx.putImageData(image, 0, 0);
}

function drawAmbient(amb) {
  const L = state.lights;
  const { ctx, w, h } = amb;
  const beat = state.motion && state.red > SETTLE ? beatAt(state.beatClock) : 0;
  let base = mix(L.base, L.redBase, state.red * MOOD.baseRed);
  base = mixGold(base, L.goldBase, state.gold * MOOD.baseGold);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = rgba(base, 1);
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = L.additive ? 'lighter' : 'source-over';
  L.blobs.forEach((_, i) => drawBlob(amb, L, i, beat));
  boundLuminance(amb, L);
}

/* ---------- The orb ---------- */

function makeOrb(host) {
  const canvas = document.createElement('canvas');
  host.append(canvas);
  const read = (n) => colour(n);
  const tones = {
    core: [read('--orb-core-1'), read('--orb-core-2')],
    coreGold: [read('--orb-core-gold-1'), read('--orb-core-gold-2')],
    lights: ['--orb-light-1', '--orb-light-2', '--orb-light-3', '--orb-light-4'].map(read),
    lightRed: read('--orb-light-red'),
    lightGold: read('--orb-light-gold'),
    glow: read('--orb-glow'),
    glowGold: read('--orb-glow-gold'),
    glowRed: read('--orb-glow-red'),
    spec: read('--orb-spec'),
    shade: read('--orb-shade'),
    rim: read('--orb-rim'),
  };
  return { host, canvas, ctx: canvas.getContext('2d'), tones, size: 0, visible: true, level: 0, target: 0 };
}

function sizeOrb(orb) {
  const dpr = Math.min(ORB_MAX_DPR, window.devicePixelRatio || 1);
  orb.size = orb.host.clientWidth;
  orb.canvas.width = Math.round(orb.size * dpr);
  orb.canvas.height = Math.round(orb.size * dpr);
  orb.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function radial(ctx, at, stops) {
  const g = ctx.createRadialGradient(at[0], at[1], 0, at[0], at[1], at[2]);
  stops.forEach(([offset, c, alpha]) => g.addColorStop(offset, rgba(c, alpha)));
  return g;
}

function drawOrbLights(orb, c, R, t) {
  const { ctx, tones } = orb;
  const lvl = orb.level;
  ctx.globalCompositeOperation = 'lighter';
  tones.lights.forEach((tone, i) => {
    const a = t * (ORB_LIGHT.rate + i * ORB_LIGHT.rateStep) * (i % 2 ? -1 : 1) + i * ORB_LIGHT.phase;
    const orbit = R * (ORB_LIGHT.orbit + ORB_LIGHT.orbitSway * Math.sin(t * ORB_LIGHT.orbitRate + i)) * (1 + lvl * ORB_LIGHT.orbitVoice);
    const x = c + Math.cos(a) * orbit;
    const y = c + Math.sin(a * ORB_LIGHT.yRatio) * orbit;
    const r = R * (ORB_LIGHT.size + ORB_LIGHT.sizeSway * Math.sin(t * ORB_LIGHT.sizeRate + i * 2) + lvl * ORB_LIGHT.sizeVoice) * (i === tones.lights.length - 1 ? ORB_LIGHT.smallLast : 1);
    let tint = i === 1 ? mix(tone, tones.lightRed, state.red * ORB_LIGHT.redMix) : tone;
    tint = mixGold(tint, tones.lightGold, state.gold * ORB_LIGHT.goldMix);
    ctx.fillStyle = radial(ctx, [x, y, r], [[0, tint, tone[3]], [1, tint, 0]]);
    ctx.fillRect(c - R, c - R, R * 2, R * 2);
  });
  ctx.globalCompositeOperation = 'source-over';
}

function drawOrb(orb) {
  const { ctx, tones, size } = orb;
  const c = size / 2;
  const lvl = orb.level;
  const t = state.motion ? state.T + lvl * ORB.voiceClock : ORB.still;
  const R0 = size / ORB_CANVAS_PER_RADIUS;
  const R = R0 * (1 + (state.motion ? Math.sin(t * ORB.breatheRate) * ORB.breathe : 0) + lvl * ORB.voiceGrow);
  ctx.clearRect(0, 0, size, size);
  const outer = R * (ORB.glow + lvl * ORB.glowVoice);
  const glow = mix(mixGold(tones.glow, tones.glowGold, state.gold), tones.glowRed, state.red / 2);
  const glowAlpha = ORB.glowAlpha + ORB.glowAlphaVoice * lvl;
  ctx.fillStyle = radial(ctx, [c, c, outer], [[(R * ORB.glowFrom) / outer, glow, glowAlpha], [1, glow, 0]]);
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.clip();
  const core = mixGold(tones.core[0], tones.coreGold[0], state.gold * ORB_BODY.goldCore);
  const edge = mixGold(tones.core[1], tones.coreGold[1], state.gold * ORB_BODY.goldEdge);
  ctx.fillStyle = radial(ctx, [c - R * ORB_BODY.dx, c - R * ORB_BODY.dy, R * ORB_BODY.r], [[0, core, 1], [1, edge, 1]]);
  ctx.fillRect(c - R, c - R, R * 2, R * 2);
  drawOrbLights(orb, c, R, t);
  ctx.fillStyle = radial(ctx, [c - R * ORB_BODY.specDx, c - R * ORB_BODY.specDy, R * ORB_BODY.specR], [[0, tones.spec, tones.spec[3]], [1, tones.spec, 0]]);
  ctx.fillRect(c - R, c - R, R * 2, R * 2);
  ctx.fillStyle = radial(ctx, [c, c + R * ORB_BODY.shadeDy, R * ORB_BODY.shadeR], [[ORB_BODY.shadeFrom, tones.shade, tones.shade[3]], [1, tones.shade, 0]]);
  ctx.fillRect(c - R, c - R, R * 2, R * 2);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(c, c, R - ORB.rim, 0, Math.PI * 2);
  ctx.lineWidth = ORB.rimWidth;
  ctx.strokeStyle = rgba(tones.rim, tones.rim[3]);
  ctx.stroke();
}

/* ---------- The frame loop: one for the ambience, the orb and the scene ---------- */

function isBusy() {
  return state.events.length > 0 || Math.abs(state.redTarget - state.red) > SETTLE || state.red > SETTLE;
}

function wake() {
  if (!state.running) {
    state.running = true;
    state.last = 0;
    window.requestAnimationFrame(frame);
  }
}

function advance(dt, now) {
  const k = 1 - Math.exp(-dt * EASE_RATE);
  state.red += (state.redTarget - state.red) * k;
  stepEvents(now);
  if (state.motion) {
    state.T += dt * (1 + state.speed) * (1 + state.red * RED_SPEEDS_DRIFT);
    state.beatClock = now;
  }
  const orb = state.orb;
  if (orb) {
    const speaking = state.motion && orb.target > 0;
    const goal = speaking ? VOICE.base + VOICE.swing * Math.abs(Math.sin(now * VOICE.rateA) * Math.sin(now * VOICE.rateB)) : 0;
    orb.level += (goal - orb.level) * Math.min(1, dt * VOICE.ease);
  }
  if (state.onTick && state.motion) {
    state.onTick(dt);
  }
}

function frame(timeMs) {
  const now = timeMs / MS_PER_S;
  const dt = state.last ? Math.min(MAX_FRAME_S, now - state.last) : 0;
  state.last = now;
  advance(dt, now);
  state.acc += dt;
  const busy = isBusy() || (state.orb && state.orb.level > SETTLE);
  if (busy || state.acc >= 1 / IDLE_FPS || dt === 0) {
    state.acc = 0;
    if (state.ambient) {
      drawAmbient(state.ambient);
    }
    if (state.orb && state.orb.visible) {
      drawOrb(state.orb);
      state.orb.host.classList.add('is-live');
    }
  }
  state.running = state.motion || busy;
  if (state.running && !document.hidden) {
    window.requestAnimationFrame(frame);
  } else {
    state.running = false;
  }
}

/* ---------- Start: the canvas of the ambience, and the orb when the page has one ---------- */

function startAmbient() {
  const host = document.querySelector('.ambient');
  if (host && document.createElement('canvas').getContext) {
    state.lights = readLights();
    state.ambient = makeAmbient(host);
    sizeAmbient(state.ambient);
    host.classList.add('is-live');
    window.addEventListener('resize', () => {
      sizeAmbient(state.ambient);
      wake();
    });
  }
  const orbHost = document.querySelector('.orb');
  if (orbHost && state.ambient) {
    state.orb = makeOrb(orbHost);
    sizeOrb(state.orb);
    watchOrb(state.orb);
    window.addEventListener('resize', () => sizeOrb(state.orb));
  }
  document.addEventListener('visibilitychange', wake);
  wake();
}

function watchOrb(orb) {
  if (!('IntersectionObserver' in window)) {
    return;
  }
  new IntersectionObserver((entries) => {
    orb.visible = entries.some((e) => e.isIntersecting);
    wake();
  }).observe(orb.host);
}

/** Milliseconds of a duration token. */
function ms(name) {
  return seconds(name) * MS_PER_S;
}

/* The one name this script gives the page; site.js drives it. */
window.CadenceAmbient = { state, fire, wake, token, ms, events: EVENTS, start: startAmbient };
