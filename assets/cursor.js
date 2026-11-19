/* Partsmith Markets — custom cursor (iPadOS-style pointer by default, a Vercel-style triangle or a literal arrow) + a "Cursor" bar to
   customise it: shape, direction (tilted / upright), color and size. The choice is saved in this browser and applies to the welcome
   screen and the main page. "Classic" switches back to the normal system cursor. */
const STYLES = {
  ipad: { name: 'iPad' },
  triangle: { name: 'Triangle' },
  arrow: { name: 'Arrow' },
  classic: { name: 'Classic' },
};
const DIRS = { tilted: 'Tilted', upright: 'Upright' };
const COLORS = { auto: 'auto', white: '#f5f5f5', black: '#0a0a0a', cyan: '#22d3ee', blue: '#5b7cf0', green: '#34d399', pink: '#f472b6', amber: '#fbbf24' };
const SIZES = { normal: 32, large: 44 };
const KEY = 'pm-cursor-v2';   // new key so everyone starts on the new iPad-style default
let pref = { style: 'ipad', dir: 'tilted', color: 'auto', size: 'normal' };
try { pref = { ...pref, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) {}
if (!STYLES[pref.style]) pref.style = 'ipad';
if (!DIRS[pref.dir]) pref.dir = 'tilted';
if (!COLORS[pref.color]) pref.color = 'auto';
if (!SIZES[pref.size]) pref.size = 'normal';

const dark = () => document.documentElement.dataset.appTheme === 'dark';
const fillOf = color => color === 'auto' ? (dark() ? '#f5f5f5' : '#0a0a0a') : COLORS[color];
// light fills get a dark outline, dark fills a light one, so the cursor shows on any background
function edgeOf(hex) {
  const n = parseInt(hex.slice(1), 16), l = (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.55 ? '#0a0a0a' : '#ffffff';
}
// Shapes are drawn pointing straight up with the tip (the click point) at (16,2).
// "Tilted" turns them about the tip like a normal cursor and moves the tip to (3,2).
const SHAPES = {
  triangle: 'M16 2 L29 25.5 L3 25.5 Z',
  arrow: 'M16 2 L26 13 L19.6 13 L19.6 29 L12.4 29 L12.4 13 L6 13 Z',
  ipad: 'M16 3 L25.5 26 L16 20.5 L6.5 26 Z',   // soft arrowhead with a notched base, like the iPadOS pointer
};
function svg(style, color, dir, click, px = 32) {
  if (style === 'ipad') return ipadSvg(color, dir, click, px);
  const f = fillOf(color), e = edgeOf(f);
  const tilt = style === 'triangle' ? -16 : -32;   // a wide triangle needs less tilt to still read as "pointing"
  const tf = dir === 'tilted' ? `translate(${hot(style, dir)[0] - 16} 0) rotate(${tilt} 16 2)` : '';
  let body = `<g transform="${tf}"><path d="${SHAPES[style]}" fill="${f}" stroke="${e}" stroke-width="1.4" stroke-linejoin="round"/></g>`;
  if (click) body += `<circle cx="27" cy="6" r="3.3" fill="${f}" stroke="${e}" stroke-width="1.2"/>`;   // "clickable" marker
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 32 32">${body}</svg>`;
}
// iPadOS-style pointer: translucent graphite with rounded corners and a thin light rim.
// "Auto" uses the iPad graphite on both light and dark pages; other colors tint it.
function ipadSvg(color, dir, click, px) {
  const f = color === 'auto' ? '#45454b' : COLORS[color];
  const rim = color === 'auto' ? '#ffffff' : edgeOf(f);
  const tf = dir === 'tilted' ? `translate(${hot('ipad', dir)[0] - 16} 0) rotate(-38 16 3)` : '';
  const d = SHAPES.ipad;
  // the layers are opaque and the whole group is faded together, so overlaps don't leave seams
  let body = `<g transform="${tf}" opacity=".9">
      <path d="${d}" fill="none" stroke="#000" stroke-opacity=".2" stroke-width="5.4" stroke-linejoin="round"/>
      <path d="${d}" fill="${rim}" stroke="${rim}" stroke-width="3.8" stroke-linejoin="round"/>
      <path d="${d}" fill="${f}" stroke="${f}" stroke-width="2.2" stroke-linejoin="round"/>
    </g>`;
  if (click) body += `<g opacity=".9"><circle cx="27" cy="7" r="3.4" fill="${rim}"/><circle cx="27" cy="7" r="2.5" fill="${f}"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 32 32">${body}</svg>`;
}
// where the tip (click point) sits in the 32×32 drawing
function hot(style, dir) {
  if (style === 'ipad') return dir === 'upright' ? [16, 3] : [5, 3];
  return dir === 'upright' ? [16, 2] : style === 'triangle' ? [8, 2] : [3, 2];
}
const url = (s, x, y) => `url("data:image/svg+xml,${encodeURIComponent(s)}") ${x} ${y}`;

function apply() {
  const root = document.documentElement;
  if (pref.style === 'classic') { root.removeAttribute('data-cursor'); return; }
  const px = SIZES[pref.size], k = px / 32;
  const [hx, hy] = hot(pref.style, pref.dir);
  const x = Math.round(hx * k), y = Math.round(hy * k);
  root.style.setProperty('--cur', url(svg(pref.style, pref.color, pref.dir, false, px), x, y) + ', auto');
  root.style.setProperty('--cur-pointer', url(svg(pref.style, pref.color, pref.dir, true, px), x, y) + ', pointer');
  root.setAttribute('data-cursor', pref.style);
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch (e) {} apply(); renderAll(); }
// "Auto" follows light / dark mode
new MutationObserver(() => { apply(); renderAll(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-app-theme'] });

// ---------------------------------------------------------------- the Cursor bar (one per slot)
const slots = [...document.querySelectorAll('.cursor-slot')];
const preview = (style, px = 22) => style === 'classic'
  ? `<svg viewBox="0 0 32 32" width="${px}" height="${px}" aria-hidden="true"><path d="M4 3 L4 24 L9.5 19 L13 27 L16 25.7 L12.6 18 L20 18 Z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>`
  : svg(style, pref.color, pref.dir, false, px).replace('<svg ', '<svg aria-hidden="true" ');
function render(slot) {
  const open = slot.classList.contains('open'), off = pref.style === 'classic' ? 'disabled' : '';
  const swatch = (k, v) => k === 'auto'
    ? `<button type="button" class="cur-swatch auto" data-color="auto" aria-pressed="${pref.color === 'auto'}" title="${pref.style === 'ipad' ? 'Auto: iPad graphite' : 'Auto: black in light mode, white in dark mode'}" aria-label="Auto" ${off}></button>`
    : `<button type="button" class="cur-swatch" data-color="${k}" aria-pressed="${pref.color === k}" title="${k[0].toUpperCase() + k.slice(1)}" aria-label="${k}" style="--sw:${v}" ${off}></button>`;
  slot.innerHTML = `
    <button type="button" class="btn sm cur-btn" aria-expanded="${open}" aria-haspopup="true" title="Customize your cursor">${preview(pref.style, 18)}<span>Cursor</span></button>
    <div class="cur-bar" role="group" aria-label="Cursor settings" ${open ? '' : 'hidden'}>
      <div class="cur-row"><span class="cur-lbl">Shape</span>
        ${Object.entries(STYLES).map(([k, v]) => `<button type="button" class="cur-opt" data-style="${k}" aria-pressed="${pref.style === k}">${preview(k)}<span>${v.name}</span></button>`).join('')}
      </div>
      <div class="cur-row"><span class="cur-lbl">Direction</span>
        ${Object.entries(DIRS).map(([k, v]) => `<button type="button" class="chip" data-dir="${k}" aria-pressed="${pref.dir === k}" ${off}>${v}</button>`).join('')}
      </div>
      <div class="cur-row"><span class="cur-lbl">Color</span>${Object.entries(COLORS).map(([k, v]) => swatch(k, v)).join('')}</div>
      <div class="cur-row"><span class="cur-lbl">Size</span>
        ${Object.keys(SIZES).map(k => `<button type="button" class="chip" data-size="${k}" aria-pressed="${pref.size === k}" ${off}>${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}
      </div>
    </div>`;
}
function renderAll() { slots.forEach(render); }
slots.forEach(slot => {
  render(slot);
  slot.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.classList.contains('cur-btn')) { const was = slot.classList.contains('open'); closeAll(); slot.classList.toggle('open', !was); slot.classList.toggle('opening', !was); render(slot); setTimeout(() => slot.classList.remove('opening'), 200); return; }
    if (b.dataset.style) pref.style = b.dataset.style;
    else if (b.dataset.color) pref.color = b.dataset.color;
    else if (b.dataset.size) pref.size = b.dataset.size;
    else if (b.dataset.dir) pref.dir = b.dataset.dir;
    else return;
    save();
  });
});
function closeAll() { slots.forEach(s => { if (s.classList.contains('open')) { s.classList.remove('open'); render(s); } }); }
// composedPath() still lists the slot even after a click re-renders (and detaches) the button that was clicked
document.addEventListener('click', e => { if (!e.composedPath().some(n => n.classList && n.classList.contains('cursor-slot'))) closeAll(); });
// Escape closes an open cursor bar first, without also closing the welcome screen behind it
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !slots.some(s => s.classList.contains('open'))) return;
  e.preventDefault(); e.stopPropagation(); closeAll();
}, true);
apply();
