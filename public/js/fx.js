// Visual effects: stage scaling, FLIP zoom, fit-text, sparkles & fireworks.

/** Scale a fixed 1920x1080 #stage to fit the window (letterboxed). */
export function fitStage(stage, w = 1920, h = 1080) {
  const apply = () => {
    const s = Math.min(innerWidth / w, innerHeight / h);
    stage.style.transform = `translate(${(innerWidth - w * s) / 2}px, ${(innerHeight - h * s) / 2}px) scale(${s})`;
  };
  addEventListener('resize', apply);
  apply();
  return apply;
}

/** Animate `el` (covering the stage) from the rect of `fromEl` to full size. Both in the same scaled stage. */
export function zoomFrom(el, fromEl, stage, { duration = 520, reverse = false } = {}) {
  const s = stage.getBoundingClientRect().width / 1920;
  const r = fromEl.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  const x = (r.left - sr.left) / s, y = (r.top - sr.top) / s, w = r.width / s, h = r.height / s;
  const from = `translate(${x}px, ${y}px) scale(${w / 1920}, ${h / 1080})`;
  const frames = [{ transform: from, opacity: 1 }, { transform: 'translate(0,0) scale(1,1)', opacity: 1 }];
  el.style.transformOrigin = '0 0';
  return el.animate(reverse ? frames.reverse() : frames, { duration, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'both' }).finished;
}

/** Shrink font until text fits its box. */
export function fitText(el, { max = 96, min = 40, step = 2 } = {}) {
  let size = max;
  el.style.fontSize = size + 'px';
  while (size > min && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
    size -= step;
    el.style.fontSize = size + 'px';
  }
  return size;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Count a number up/down inside el. */
export function countTo(el, from, to, format, duration = 700) {
  if (el._raf) cancelAnimationFrame(el._raf);
  const t0 = performance.now();
  const stepFn = now => {
    const p = Math.min(1, (now - t0) / duration);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = format(Math.round(from + (to - from) * e));
    if (p < 1) el._raf = requestAnimationFrame(stepFn);
  };
  el._raf = requestAnimationFrame(stepFn);
}

// ---------------------------------------------------------------------------
// Particles: ambient twinkles, sparkle bursts, fireworks.

const COLORS = ['#FFD877', '#F5B82E', '#FF7A1A', '#FFF4DC', '#D6246E', '#FFB3D1', '#9FE8FF'];

export function createParticles(canvas) {
  const g = canvas.getContext('2d');
  const W = canvas.width = 1920, H = canvas.height = 1080;
  let parts = [];
  let twinkles = [];
  let running = false;
  let ambient = true;

  for (let i = 0; i < 60; i++) twinkles.push({ x: Math.random() * W, y: Math.random() * H, p: Math.random() * Math.PI * 2, s: 0.5 + Math.random() * 1.5 });

  function frame() {
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    if (ambient) {
      for (const t of twinkles) {
        t.p += 0.02 * t.s;
        const a = Math.max(0, Math.sin(t.p)) * 0.35;
        if (a < 0.02) continue;
        g.fillStyle = `rgba(255,216,119,${a})`;
        g.beginPath(); g.arc(t.x, t.y, t.s * 1.4, 0, Math.PI * 2); g.fill();
      }
    }
    parts = parts.filter(p => p.life > 0);
    for (const p of parts) {
      p.vx *= p.drag; p.vy = p.vy * p.drag + p.g;
      p.x += p.vx; p.y += p.vy; p.life -= 1;
      if (p.rocket && p.life <= 0) burst(p.x, p.y, 110, p.color);
      const a = Math.min(1, p.life / p.fade);
      g.globalAlpha = a;
      g.fillStyle = p.color;
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
      if (p.trail) { g.globalAlpha = a * 0.35; g.beginPath(); g.arc(p.x - p.vx * 2, p.y - p.vy * 2, p.r * 0.8, 0, Math.PI * 2); g.fill(); }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    if (parts.length || ambient) requestAnimationFrame(frame); else running = false;
  }
  function kick() { if (!running) { running = true; requestAnimationFrame(frame); } }

  function burst(x, y, n = 120, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 9;
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0.09, drag: 0.965, life: 50 + Math.random() * 50, fade: 40,
        r: 1.5 + Math.random() * 2.5, color: color && Math.random() < 0.7 ? color : COLORS[(Math.random() * COLORS.length) | 0], trail: true });
    }
    kick();
  }

  return {
    setAmbient(on) { ambient = on; kick(); },
    burst,
    sparkle(x = W / 2, y = H / 2, n = 160) { burst(x, y, n); },
    fireworks(count = 8, spread = 2600) {
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          const x = 200 + Math.random() * (W - 400);
          parts.push({ x, y: H + 10, vx: (Math.random() - 0.5) * 2, vy: -(14 + Math.random() * 6), g: 0.22, drag: 0.995,
            life: 45 + Math.random() * 15, fade: 10, r: 3, color: COLORS[(Math.random() * COLORS.length) | 0], rocket: true });
          kick();
        }, Math.random() * spread);
      }
    },
  };
}
