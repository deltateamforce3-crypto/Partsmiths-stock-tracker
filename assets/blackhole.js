/* Partsmith Markets — interactive "black hole" background for the welcome screen.
   A small black hole bounces around the drafting-grid background and bends the grid lines
   around it. Moving the pointer over the background pulls it smoothly toward the cursor;
   leave it alone and it goes back to bouncing. Pauses whenever the welcome screen is closed. */
const dlg = document.getElementById('welcomeDlg');
if (dlg) {
  const cv = document.createElement('canvas');
  cv.className = 'wc-bg'; cv.setAttribute('aria-hidden', 'true');
  dlg.prepend(cv);
  // click the orb to hide it (the grid keeps bending); this button brings it back
  const orbBtn = document.createElement('button');
  orbBtn.type = 'button'; orbBtn.className = 'btn sm wc-orb-btn'; orbBtn.hidden = true;
  orbBtn.innerHTML = '<span class="wc-orb-dot" aria-hidden="true"></span>Bring back the orb';
  dlg.appendChild(orbBtn);
  let orbOn = true, show = 1;
  try { orbOn = localStorage.getItem('pm-orb-hidden') !== '1'; } catch (e) {}
  show = orbOn ? 1 : 0; orbBtn.hidden = orbOn;
  function setOrb(on) {
    orbOn = on; orbBtn.hidden = on;
    try { on ? localStorage.removeItem('pm-orb-hidden') : localStorage.setItem('pm-orb-hidden', '1'); } catch (e) {}
    dlg.classList.remove('orb-hover');
    if (reduce.matches) { show = on ? 1 : 0; draw(); }
  }
  orbBtn.onclick = () => setOrb(true);
  const ctx = cv.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const GRID = 28, STEP = 9;
  let W = 0, H = 0, dpr = 1, raf = 0, last = 0, t = 0;
  const hole = { x: 0, y: 0, vx: 70, vy: 52, r: 26 };
  const ptr = { x: 0, y: 0, active: false, at: 0 };
  let colors = {};

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim();
    const dark = document.documentElement.dataset.appTheme === 'dark';
    colors = { accent: v('--accent') || '#2f55d4', bg: v('--bg') || (dark ? '#111' : '#eef0f3'), dark };
  }
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = dlg.clientWidth; H = dlg.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    hole.r = Math.max(18, Math.min(34, Math.min(W, H) * 0.035));
    if (!hole.x) { hole.x = W * 0.72; hole.y = H * 0.32; }
  }

  // grid point bent toward the hole (gravitational-lensing look), capped so lines never cross the core
  function bend(px, py) {
    const dx = hole.x - px, dy = hole.y - py, d2 = dx * dx + dy * dy, d = Math.sqrt(d2) || 1;
    const R = hole.r * 5.5;
    // with the orb showing, lines wrap around its edge; as it fades, that edge shrinks away and the
    // pull eases off near the centre, so the grid just dips smoothly with no circular gap
    const e = 1 - Math.pow(1 - show, 3), core = hole.r * 1.05 * e, soft = (hole.r * 1.6) ** 2;
    const fall = e + (1 - e) * d2 / (d2 + soft);
    const pull = Math.min(d - core, ((R * R * hole.r * 0.9) / (d2 + R * R * 0.6)) * fall);
    if (pull <= 0) return [px, py];
    return [px + (dx / d) * pull, py + (dy / d) * pull];
  }

  function step(dt) {
    const now = performance.now();
    const chasing = ptr.active && now - ptr.at < 2500;
    if (chasing) {           // spring toward the cursor, with damping, so it glides rather than snaps
      hole.vx += (ptr.x - hole.x) * 7 * dt; hole.vy += (ptr.y - hole.y) * 7 * dt;
      const damp = Math.exp(-3.2 * dt); hole.vx *= damp; hole.vy *= damp;
    } else {                 // drift back to a steady cruising speed
      const sp = Math.hypot(hole.vx, hole.vy) || 1, target = Math.min(W, H) * 0.11 + 40;
      const k = 1 + (target / sp - 1) * Math.min(1, dt * 1.5);
      hole.vx *= k; hole.vy *= k;
    }
    hole.x += hole.vx * dt; hole.y += hole.vy * dt;
    const m = hole.r * 1.6;  // bounce off the edges
    if (hole.x < m) { hole.x = m; hole.vx = Math.abs(hole.vx); }
    if (hole.x > W - m) { hole.x = W - m; hole.vx = -Math.abs(hole.vx); }
    if (hole.y < m) { hole.y = m; hole.vy = Math.abs(hole.vy); }
    if (hole.y > H - m) { hole.y = H - m; hole.vy = -Math.abs(hole.vy); }
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // bent grid
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.accent; ctx.globalAlpha = colors.dark ? 0.16 : 0.13;
    ctx.beginPath();
    for (let x = 0; x <= W + GRID; x += GRID) {
      for (let y = 0; y <= H + STEP; y += STEP) { const [a, b] = bend(x, y); y === 0 ? ctx.moveTo(a, b) : ctx.lineTo(a, b); }
    }
    for (let y = 0; y <= H + GRID; y += GRID) {
      for (let x = 0; x <= W + STEP; x += STEP) { const [a, b] = bend(x, y); x === 0 ? ctx.moveTo(a, b) : ctx.lineTo(a, b); }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (show < 0.01) return;
    const { x, y } = hole, e = 1 - Math.pow(1 - show, 3), r = hole.r * e;  // eased shrink / grow
    ctx.globalAlpha = Math.min(1, show * 1.4);
    // outer glow
    let g = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 4.2);
    g.addColorStop(0, hexA(colors.accent, colors.dark ? 0.45 : 0.32));
    g.addColorStop(0.35, hexA(colors.accent, colors.dark ? 0.14 : 0.1));
    g.addColorStop(1, hexA(colors.accent, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 4.2, 0, Math.PI * 2); ctx.fill();
    // photon ring + event horizon
    g = ctx.createRadialGradient(x, y, r * 0.75, x, y, r * 1.22);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.72, 'rgba(0,0,0,1)');
    g.addColorStop(0.86, hexA('#ffe2b8', 0.95)); g.addColorStop(1, hexA(colors.accent, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.22, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function hexA(c, a) {
    c = c.trim();
    if (c.startsWith('#')) {
      let h = c.slice(1); if (h.length === 3) h = h.split('').map(ch => ch + ch).join('');
      const n = parseInt(h.slice(0, 6), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
    }
    const m = c.match(/[\d.]+/g); return m ? `rgba(${m[0]},${m[1]},${m[2]},${a})` : `rgba(47,85,212,${a})`;
  }

  function frame(ts) {
    const dt = Math.min(0.05, (ts - (last || ts)) / 1000); last = ts; t += dt;
    show += ((orbOn ? 1 : 0) - show) * Math.min(1, dt * 7);
    step(dt); draw();
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (raf) return;
    readColors(); resize(); last = 0;
    if (reduce.matches) { draw(); return; }   // still image for people who turn off motion
    raf = requestAnimationFrame(frame);
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  dlg.addEventListener('pointermove', e => {
    // follow the cursor over the background, not while it's over buttons and tiles
    ptr.active = !e.target.closest('.wc-tile, button, a, input, label, .wc-top, .wc-bottom');
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.at = performance.now();
  });
  dlg.addEventListener('pointerleave', () => { ptr.active = false; dlg.classList.remove('orb-hover'); });
  const onOrb = e => orbOn && !e.target.closest('.wc-tile, button, a, input, label, .wc-top, .wc-bottom')
    && Math.hypot(e.clientX - hole.x, e.clientY - hole.y) < hole.r * 1.4;
  dlg.addEventListener('pointermove', e => dlg.classList.toggle('orb-hover', onOrb(e)));
  dlg.addEventListener('click', e => { if (onOrb(e)) setOrb(false); });
  addEventListener('resize', () => { if (dlg.open) { resize(); if (!raf) draw(); } });
  new MutationObserver(() => {
    readColors();
    if (dlg.open) start(); else stop();
  }).observe(dlg, { attributes: true, attributeFilter: ['open'] });
  new MutationObserver(() => { readColors(); if (dlg.open && !raf) draw(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-app-theme'] });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (dlg.open) start(); });
  if (dlg.open) start();
}
