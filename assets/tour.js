/* Partsmith Markets — guided tour with a futuristic HUD look.
   Starts automatically on a visitor's first visit (once the Home screen is showing), can be
   skipped at any step (button or Esc), and can be replayed from "Take the tour" on the Home
   screen or by typing "tour" in the command center. Steps marked `home` run on the welcome
   screen; the rest run on the main page. Steps whose target isn't visible are skipped. */
const DONE = 'pm-tour-done';
const welcome = document.getElementById('welcomeDlg');
const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const $ = s => document.querySelector(s);

const STEPS = [
  { home: true, title: 'Welcome aboard', body: 'A 60-second tour of Partsmith Markets. Use Next or the → key. Press Skip or Esc to leave anytime.' },
  { home: true, el: '#wcAuthOut', title: 'Log in or sign up', body: 'Create a free account with your email or Google. Accounts unlock a few personal settings, like the one on the next step.' },
  { home: true, el: () => visible($('#wcHideWrap')) ? $('#wcHideWrap') : $('#wcHint'), title: "Don't want this screen every time?",
    body: 'Once you\'re logged in, tick "Don\'t show this welcome screen again" at the bottom. It\'s saved to your account, so it applies on every device. You can turn it back on from your account menu.' },
  { home: true, el: '#welcomeDlg .cursor-slot', title: 'Make the cursor yours', body: 'Switch between the triangle, the arrow or the classic cursor. Tilt it, recolor it or make it bigger.' },
  { home: true, el: '.wc-grid', title: "What's inside", body: 'Daily ideas, your watchlist, tips every 2 hours, daily stories, the command center and market mood. Click any tile to jump straight there.' },
  { home: true, el: '#welcomeGo', title: 'Enter the dashboard', body: 'This takes you into the main site. Next, the tour shows you around it.' },
  { el: '#helpBtn', title: 'Back to home', body: 'The Home button, or the Partsmith Markets logo, brings you back to the welcome screen whenever you like.' },
  { el: '.menubar', alt: '.ribbon', title: 'Getting around', body: 'Jump to any section from here: Picks, Tips, Stories, Tape, Sentiment, Calendar and Sources. The Jump-to buttons on the right of the bar below do the same.' },
  { el: '.ribbon', title: 'Market at a glance', body: 'The major indexes, rates, oil, gold, bitcoin and CNN\'s Fear & Greed mood gauge. Hover any reading to see its source.' },
  { el: '.sidebar-left', title: 'Your watchlist', body: 'Click + next to a stock to save it. Use the "My watchlist" chip to see only your stocks, or filter by Picks, AI & chips, Mega-cap, Trending or ETFs.' },
  { el: '#picks', title: "Today's 3 ideas", body: 'Three stocks scored on news, price action, crowd buzz and analysts, with the risks spelled out. Click a card to inspect it. Research, not advice.' },
  { el: '.sidebar-right', title: 'Inspector', body: 'Details for whichever stock you select: price, what\'s driving it, key figures and sources.' },
  { el: '#cmdBtn', title: 'Command center', body: 'Press Ctrl K (⌘K on a Mac) and type things like "add all AI giants", "go to stories" or "dark mode". Connect a Claude or Gemini key to ask questions in your own words.' },
  { el: '#liveBtn', title: 'Live quotes', body: 'Prices refresh hourly on trading days. Paste a free Finnhub key here to stream them every minute.' },
  { el: '#themeSeg', title: 'Light or dark', body: 'Pick light, dark or match your device.' },
  { el: '.acct', title: 'Your account', body: 'Log in, sign up or sign out here. Your name opens a menu with your settings.' },
  { el: '#quoteBar', title: 'Quote of the day', body: 'A new line from a legendary investor every day at midnight New York time.' },
  { el: '#status', title: 'Status bar', body: 'When the data was last updated, how old it is, and when the next refresh runs.' },
  { title: 'Tour complete', body: 'Replay this tour anytime: click "Take the tour" on the Home screen, or type "tour" in the command center.', end: true },
];

// ---------------------------------------------------------------- UI
const dlg = document.createElement('dialog');
dlg.className = 'tour'; dlg.setAttribute('aria-labelledby', 'tourTitle');
dlg.innerHTML = `
  <div class="tour-spot" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
  <div class="tour-outro" aria-hidden="true"><div class="tour-tri"></div></div>
  <div class="tour-card" role="document">
    <div class="tour-meta"><span>SYS://TOUR</span><span id="tourStep">01 / 00</span></div>
    <h3 id="tourTitle"></h3>
    <p id="tourBody"></p>
    <div class="tour-progress" id="tourProg"></div>
    <div class="tour-btns">
      <button type="button" class="tour-btn ghost" id="tourSkip">Skip tour</button>
      <span style="flex:1"></span>
      <button type="button" class="tour-btn" id="tourBack">◂ Back</button>
      <button type="button" class="tour-btn primary" id="tourNext">Next ▸</button>
    </div>
  </div>`;
document.body.appendChild(dlg);
const spot = dlg.querySelector('.tour-spot'), card = dlg.querySelector('.tour-card');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
let i = 0, steps = [], typer = 0, active = false;

const target = st => { const e = typeof st.el === 'function' ? st.el() : st.el && $(st.el); return visible(e) ? e : (st.alt && visible($(st.alt)) ? $(st.alt) : null); };

// Show the right screen underneath: welcome steps need the Home screen open, the rest need it closed.
// (Both are modal dialogs; closing and reopening the tour keeps it on top.)
function setScreen(home) {
  if (!welcome || home === welcome.open) return;
  dlg.close();
  if (home) welcome.showModal(); else welcome.close();
  dlg.showModal();
}

async function show(n, dir = 1) {
  i = n;
  const st = steps[i];
  setScreen(!!st.home);
  let el = st.el ? target(st) : null;
  if (st.el && !el) { // e.g. hidden on a small screen: skip it
    const nx = i + dir; if (nx >= 0 && nx < steps.length) return show(nx, dir); }
  if (el) { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce.matches ? 'auto' : 'smooth' }); await wait(reduce.matches ? 0 : 320); el = target(st); }
  place(el);
  $('#tourStep').textContent = `${String(i + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}`;
  type($('#tourTitle'), st.title);
  $('#tourBody').textContent = st.body;
  $('#tourProg').innerHTML = steps.map((_, k) => `<i class="${k < i ? 'done' : k === i ? 'on' : ''}"></i>`).join('');
  $('#tourBack').disabled = i === 0;
  $('#tourNext').textContent = st.end ? 'Finish ✓' : 'Next ▸';
  $('#tourSkip').hidden = !!st.end;
  $('#tourNext').focus({ preventScroll: true });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

function place(el) {
  const W = innerWidth, H = innerHeight, pad = 8;
  let r;
  if (el) { const b = el.getBoundingClientRect(); r = { x: b.left - pad, y: b.top - pad, w: b.width + pad * 2, h: b.height + pad * 2 }; }
  else r = { x: W / 2, y: H / 2, w: 0, h: 0 };
  // keep huge targets (whole sidebars) inside the screen
  r.x = Math.max(4, r.x); r.y = Math.max(4, r.y); r.w = Math.min(r.w, W - r.x - 4); r.h = Math.min(r.h, H - r.y - 4);
  Object.assign(spot.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  spot.classList.toggle('none', !el);
  // card: below, above, beside, or centred
  const cw = card.offsetWidth, ch = card.offsetHeight, gap = 16;
  let x, y;
  if (!el) { x = (W - cw) / 2; y = (H - ch) / 2; }
  else if (r.y + r.h + gap + ch < H) { y = r.y + r.h + gap; x = r.x; }
  else if (r.y - gap - ch > 0) { y = r.y - gap - ch; x = r.x; }
  else if (r.x + r.w + gap + cw < W) { x = r.x + r.w + gap; y = r.y + 12; }
  else if (r.x - gap - cw > 0) { x = r.x - gap - cw; y = r.y + 12; }
  else { x = (W - cw) / 2; y = H - ch - 16; }
  x = Math.max(12, Math.min(W - cw - 12, x)); y = Math.max(12, Math.min(H - ch - 12, y));
  Object.assign(card.style, { left: x + 'px', top: y + 'px' });
}

function type(node, text) {
  clearInterval(typer);
  if (reduce.matches) { node.textContent = text; return; }
  let k = 0; node.textContent = '';
  typer = setInterval(() => { k += 2; node.textContent = text.slice(0, k); if (k >= text.length) clearInterval(typer); }, 14);
}

function start() {
  if (active) return;
  active = true;
  steps = STEPS.slice();
  if (welcome && !welcome.open) welcome.showModal();
  dlg.showModal();
  show(0);
}
function finish(markDone = true) {
  if (!active) return;
  active = false; clearInterval(typer);
  try { if (markDone) localStorage.setItem(DONE, '1'); } catch (e) {}
  dlg.close();
}
$('#tourNext').onclick = () => steps[i].end ? outro() : show(i + 1, 1);

// Finish: a Vercel-style triangle rises from the bottom of the screen and sweeps away the tour
function outro() {
  if (reduce.matches) return finish();
  clearInterval(typer);
  dlg.classList.add('outro');
  const tri = dlg.querySelector('.tour-tri');
  tri.addEventListener('animationend', () => { dlg.classList.remove('outro'); finish(); }, { once: true });
  setTimeout(() => { if (dlg.classList.contains('outro')) { dlg.classList.remove('outro'); finish(); } }, 2200);   // safety net
}
$('#tourBack').onclick = () => i > 0 && show(i - 1, -1);
$('#tourSkip').onclick = () => finish();
dlg.addEventListener('cancel', e => { e.preventDefault(); finish(); });   // Esc = skip
dlg.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') { e.preventDefault(); $('#tourNext').click(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); $('#tourBack').click(); }
});
addEventListener('resize', () => { if (active) place(target(steps[i])); });

// replay: "Take the tour" on the Home screen, or `window.pmTour()` from the command center
window.pmTour = start;
const replay = document.getElementById('tourBtn'); if (replay) replay.onclick = start;

// first visit: start once the Home screen is showing
let seen = false; try { seen = localStorage.getItem(DONE) === '1'; } catch (e) {}
if (!seen && welcome) {
  const kick = () => { if (welcome.open && !active) setTimeout(() => { if (welcome.open && !active) start(); }, 900); };
  if (welcome.open) kick();
  else new MutationObserver((_, mo) => { if (welcome.open) { mo.disconnect(); kick(); } }).observe(welcome, { attributes: true, attributeFilter: ['open'] });
}
