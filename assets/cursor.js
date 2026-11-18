/* Partsmith Markets — custom futuristic cursor + a "Cursor" bar to customise it.
   The choice (style, color, size) is saved in this browser and applies to the welcome
   screen and the main page. "Classic" switches back to the normal system cursor. */
const STYLES = {
  futuristic: { name: 'Futuristic' },
  neon: { name: 'Neon' },
  blade: { name: 'Blade' },
  classic: { name: 'Classic' },
};
const COLORS = { cyan: '#22d3ee', blue: '#5b7cf0', green: '#34d399', pink: '#f472b6', amber: '#fbbf24', white: '#e5e7eb' };
const SIZES = { normal: 32, large: 44 };
const KEY = 'pm-cursor';
let pref = { style: 'futuristic', color: 'cyan', size: 'normal' };
try { pref = { ...pref, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) {}
if (!STYLES[pref.style]) pref.style = 'futuristic';
if (!COLORS[pref.color]) pref.color = 'cyan';
if (!SIZES[pref.size]) pref.size = 'normal';

// 32×32 drawings, tip at (3,2). `click` adds a small targeting ring for links and buttons.
function svg(style, c, click, px = 32) {
  let body;
  if (style === 'neon') {
    const p = 'M3 2 L3 24 L9 18.6 L12.6 27.4 L16.4 25.8 L12.9 17.2 L21 17.2 Z';
    body = `<path d="${p}" fill="none" stroke="${c}" stroke-opacity=".35" stroke-width="4.2" stroke-linejoin="round"/>
      <path d="${p}" fill="${c}" fill-opacity=".14" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="${p}" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width=".6" stroke-linejoin="round"/>`;
  } else if (style === 'blade') {
    const p = 'M3 2 L3 22.5 L7.8 18 L11 25.6 L13.4 24.6 L10.3 17.2 L16.6 17 Z';
    body = `<path d="${p}" fill="#0b1020" stroke="${c}" stroke-width="1.5" stroke-linejoin="miter"/>
      <path d="M4.6 6.5 L4.6 18.3" stroke="${c}" stroke-width="1.1" stroke-linecap="round"/>`;
  } else { // futuristic
    const p = 'M3 2 L3 24 L8.6 19 L12.4 27.6 L16.6 25.8 L12.9 17.6 L21.2 17.6 Z';
    body = `<path d="${p}" fill="none" stroke="${c}" stroke-opacity=".3" stroke-width="4" stroke-linejoin="miter"/>
      <path d="${p}" fill="#0b1020" stroke="${c}" stroke-width="1.6" stroke-linejoin="miter"/>
      <path d="M5.2 7.2 L5.2 18.6 L8.4 15.8 M5.2 7.2 L14.2 15.6" fill="none" stroke="${c}" stroke-width="1" stroke-opacity=".9" stroke-linecap="square"/>
      <rect x="11.4" y="21.4" width="1.6" height="1.6" fill="${c}" transform="rotate(-23 12.2 22.2)"/>`;
  }
  if (click) body += `<circle cx="25" cy="25" r="4.6" fill="none" stroke="${c}" stroke-width="1.6"/><circle cx="25" cy="25" r="1.4" fill="${c}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 32 32">${body}</svg>`;
}
const url = (s, hot) => `url("data:image/svg+xml,${encodeURIComponent(s)}") ${hot} ${hot}`;

function apply() {
  const root = document.documentElement;
  if (pref.style === 'classic') { root.removeAttribute('data-cursor'); return; }
  const c = COLORS[pref.color], px = SIZES[pref.size], hot = Math.round(px * 3 / 32);
  root.style.setProperty('--cur', url(svg(pref.style, c, false, px), hot) + ', auto');
  root.style.setProperty('--cur-pointer', url(svg(pref.style, c, true, px), hot) + ', pointer');
  root.setAttribute('data-cursor', pref.style);
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch (e) {} apply(); renderAll(); }

// ---------------------------------------------------------------- the Cursor bar (one per slot)
const slots = [...document.querySelectorAll('.cursor-slot')];
const preview = (style, color, px = 22) => style === 'classic'
  ? `<svg viewBox="0 0 32 32" width="${px}" height="${px}" aria-hidden="true"><path d="M4 3 L4 24 L9.5 19 L13 27 L16 25.7 L12.6 18 L20 18 Z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>`
  : svg(style, COLORS[color], false, px).replace('<svg ', '<svg aria-hidden="true" ');
function render(slot) {
  const open = slot.classList.contains('open');
  slot.innerHTML = `
    <button type="button" class="btn sm cur-btn" aria-expanded="${open}" aria-haspopup="true" title="Customize your cursor">${preview(pref.style, pref.color, 18)}<span>Cursor</span></button>
    <div class="cur-bar" role="group" aria-label="Cursor settings" ${open ? '' : 'hidden'}>
      <div class="cur-row"><span class="cur-lbl">Style</span>
        ${Object.entries(STYLES).map(([k, v]) => `<button type="button" class="cur-opt" data-style="${k}" aria-pressed="${pref.style === k}">${preview(k, pref.color)}<span>${v.name}</span></button>`).join('')}
      </div>
      <div class="cur-row"><span class="cur-lbl">Color</span>
        ${Object.entries(COLORS).map(([k, v]) => `<button type="button" class="cur-swatch" data-color="${k}" aria-pressed="${pref.color === k}" title="${k[0].toUpperCase() + k.slice(1)}" aria-label="${k}" style="--sw:${v}" ${pref.style === 'classic' ? 'disabled' : ''}></button>`).join('')}
      </div>
      <div class="cur-row"><span class="cur-lbl">Size</span>
        ${Object.keys(SIZES).map(k => `<button type="button" class="chip" data-size="${k}" aria-pressed="${pref.size === k}" ${pref.style === 'classic' ? 'disabled' : ''}>${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}
      </div>
    </div>`;
}
function renderAll() { slots.forEach(render); }
slots.forEach(slot => {
  render(slot);
  slot.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.classList.contains('cur-btn')) { const was = slot.classList.contains('open'); closeAll(); slot.classList.toggle('open', !was); render(slot); return; }
    if (b.dataset.style) pref.style = b.dataset.style;
    else if (b.dataset.color) pref.color = b.dataset.color;
    else if (b.dataset.size) pref.size = b.dataset.size;
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
