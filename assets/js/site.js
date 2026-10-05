(() => {
  const d = document, root = d.documentElement;
  const motion = root.classList.contains('motion');
  const $ = (s, c = d) => c.querySelector(s), $$ = (s, c = d) => [...c.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const fmt = n => Math.round(n).toLocaleString('fr-CA').replace(/ /g, ' ');

  const head = $('.head'), bar = $('.progress'), scene = $('[data-scene]'), heroImg = $('.hero-fig img');
  const outs = scene ? $$('.col-out li', scene) : [], ins = scene ? $$('.col-in li', scene) : [];
  const cssTimeline = CSS.supports('animation-timeline: view()');
  const parallax = motion && heroImg && matchMedia('(min-width: 56rem) and (pointer: fine)').matches;

  let ticking = false;
  const frame = () => {
    ticking = false;
    const y = scrollY, max = root.scrollHeight - innerHeight;
    head.classList.toggle('is-condensed', y > 24);
    bar.style.transform = `scaleX(${max > 0 ? clamp(y / max) : 0})`;
    if (parallax && y < innerHeight) heroImg.style.setProperty('--py', `${(y * 0.06).toFixed(1)}px`);
    if (scene && motion) {
      const r = scene.getBoundingClientRect(), span = r.height - innerHeight;
      const p = span > 0 ? clamp(-r.top / span) : 0;
      if (!cssTimeline) scene.style.setProperty('--p', clamp(p / 0.78).toFixed(3));
      scene.classList.toggle('is-done', p > 0.74);
      outs.forEach((li, i) => {
        const on = p > 0.12 + i * 0.15;
        li.classList.toggle('off', on);
        ins[i].classList.toggle('on', on);
      });
    }
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  frame();

  const burger = $('.burger');
  if (burger) {
    const setOpen = open => { head.classList.toggle('is-open', open); burger.setAttribute('aria-expanded', open); };
    burger.addEventListener('click', () => setOpen(!head.classList.contains('is-open')));
    $$('.drawer a').forEach(a => a.addEventListener('click', () => setOpen(false)));
    d.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
  }

  const count = el => {
    const end = +el.dataset.count, t0 = performance.now(), dur = 1100;
    const step = t => {
      const p = clamp((t - t0) / dur);
      el.textContent = fmt(end * (1 - Math.pow(1 - p, 4)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  if (motion && 'IntersectionObserver' in window) {
    $$('[data-stagger]').forEach(g => [...g.children].forEach((c, i) => { c.setAttribute('data-rv', ''); c.style.setProperty('--i', Math.min(i, 6)); }));
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      if (e.target.dataset.count) count(e.target);
      io.unobserve(e.target);
    }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    $$('[data-rv],[data-count]').forEach(el => io.observe(el));
  }

  const sticky = $('.bar'), heroCta = $('[data-hero-cta]'), end = $('#contact');
  if (sticky && 'IntersectionObserver' in window) {
    let past = false, atEnd = false;
    if (!heroCta) addEventListener('scroll', () => { past = scrollY > innerHeight * 0.5; sync(); }, { passive: true });
    const sync = () => sticky.classList.toggle('is-on', past && !atEnd);
    if (heroCta) new IntersectionObserver(([e]) => { past = !e.isIntersecting && e.boundingClientRect.bottom < 80; sync(); }, { rootMargin: '-72px 0px 0px 0px' }).observe(heroCta);
    if (end) new IntersectionObserver(([e]) => { atEnd = e.isIntersecting; sync(); }, { threshold: 0.25 }).observe(end);
    root.classList.add('has-bar');
    sync();
  }

  if (motion && matchMedia('(pointer: fine)').matches) {
    $$('.btn-fill, .btn-lg').forEach(b => {
      b.addEventListener('pointermove', e => {
        const r = b.getBoundingClientRect();
        b.style.setProperty('--mx', `${((e.clientX - r.left) / r.width - 0.5) * 8}px`);
        b.style.setProperty('--my', `${((e.clientY - r.top) / r.height - 0.5) * 6}px`);
      });
      b.addEventListener('pointerleave', () => { b.style.setProperty('--mx', '0px'); b.style.setProperty('--my', '0px'); });
    });
  }

  const est = $('[data-est]');
  if (est) {
    const h = $('#est-h'), c = $('#est-c'), oh = $('#est-h-out'), oc = $('#est-c-out'), sum = $('#est-sum'), wk = $('#est-wk');
    const fill = el => el.style.setProperty('--fill', `${(el.value - el.min) / (el.max - el.min) * 100}%`);
    const calc = () => {
      const week = h.value * c.value;
      oh.textContent = `${h.value} h`;
      oc.textContent = `${c.value} $`;
      sum.textContent = `${fmt(week * 52)} $`;
      wk.textContent = `${fmt(week)} $`;
      fill(h); fill(c);
    };
    h.addEventListener('input', calc);
    c.addEventListener('input', calc);
    calc();
  }
})();
