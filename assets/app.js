/* Partsmith Markets — renders data/market.json and, when a Finnhub key is set, streams quotes. */
(async function () {
  // The GitHub updater saves fresh data to the repo's `data` branch, so read it from there
  // (works on any host and on a local copy). Fall back to the copy shipped with the site.
  const DATA_BRANCH_URL = 'https://raw.githubusercontent.com/deltateamforce3-crypto/Partsmiths-stock-tracker/data/data/market.json';
  async function loadData() {
    for (const url of [DATA_BRANCH_URL, 'data/market.json']) {
      try {
        const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
        if (r.ok) return await r.json();
      } catch (e) { /* try the next copy */ }
    }
    throw new Error('Neither the data branch nor data/market.json could be loaded');
  }
  let D;
  try {
    D = await loadData();
  } catch (err) {
    document.getElementById('sheet').innerHTML = `<section class="card"><div class="card-body note"><h2>Couldn't load data/market.json</h2><p>${String(err.message || err)}</p><p>Browsers block <code>fetch()</code> on pages opened straight from disk. Serve the folder instead: <code>python3 -m http.server 8000</code>, then open <code>http://localhost:8000</code>. On GitHub Pages this works automatically.</p></div></section>`;
    return;
  }
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 2) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sign = n => n > 0 ? '+' : n < 0 ? '−' : '';
  const pct = n => n == null ? '—' : sign(n) + Math.abs(n).toFixed(2) + '%';
  // Dollar change: from the data when present, otherwise worked out from price and % change.
  const chgOf = w => w.chg != null ? w.chg : (w.px != null && w.pct != null ? w.px - w.px / (1 + w.pct / 100) : null);
  const money = n => n == null ? '' : sign(Math.round(n * 100)) + '$' + fmt(Math.abs(n));
  const move = (c, p) => p == null ? '—' : c == null ? pct(p) : `${money(c)} (${pct(p)})`;
  const cls = n => n == null ? 'flat' : n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  const src = id => { const s = D.sources[id]; if (!s) return ''; const [pub, rest] = s.name.split(' — '); const label = id.startsWith('news-') && rest ? `${pub}: ${rest.length > 34 ? rest.slice(0, 32).trim() + '…' : rest}` : pub; return `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.name)}">${esc(label)}</a>`; };
  const srcs = ids => [...new Set(ids)].map(src).join('');
  let bySym = Object.fromEntries(D.watchlist.map(w => [w.sym, w]));
  let pickSyms = D.picks.map(p => p.sym);

  // my watchlist: symbols the viewer saved with the + button, kept in this browser
  let mine = [];
  try { mine = JSON.parse(localStorage.getItem('pm-my-watchlist') || '[]').filter(x => typeof x === 'string'); } catch (e) { mine = []; }
  const inMine = s => mine.includes(s);
  const plusSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const checkSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  function toggleMine(s) {
    mine = inMine(s) ? mine.filter(x => x !== s) : [...mine, s];
    try { localStorage.setItem('pm-my-watchlist', JSON.stringify(mine)); } catch (e) {}
    toast(inMine(s) ? `${s} added to your watchlist` : `${s} removed from your watchlist`);
    renderChips(); renderWL(); renderInsp(); renderSheet();
  }
  const addBtn = (s, cls = 'add-btn', label = false) => `<button type="button" class="${cls}" data-add="${s}" aria-pressed="${inMine(s)}" title="${inMine(s) ? 'In your watchlist — click to remove' : 'Add to your watchlist'}" aria-label="${inMine(s) ? 'Remove ' + s + ' from' : 'Add ' + s + ' to'} your watchlist">${inMine(s) ? checkSvg : plusSvg}${label ? `<span>${inMine(s) ? 'In your watchlist' : 'Add to watchlist'}</span>` : ''}</button>`;
  let toastT;
  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800);
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-add]'); if (!b) return; e.stopPropagation(); toggleMine(b.dataset.add); }, true);

  // theme
  const root = document.documentElement;
  // pref is 'light', 'dark' or 'system'; 'system' follows the OS setting and updates when it changes.
  const sysDark = matchMedia('(prefers-color-scheme: dark)');
  let pref = 'system';
  try { pref = localStorage.getItem('pm-theme') || 'system'; } catch (e) {}
  if (!['light', 'dark', 'system'].includes(pref)) pref = 'system';
  const applyTheme = () => {
    root.dataset.appTheme = pref === 'system' ? (sysDark.matches ? 'dark' : 'light') : pref;
    document.querySelectorAll('#themeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === pref)));
    drawChart();
  };
  document.querySelectorAll('#themeSeg button').forEach(b => b.onclick = () => {
    pref = b.dataset.theme;
    try { localStorage.setItem('pm-theme', pref); } catch (e) {}
    applyTheme();
  });
  sysDark.addEventListener('change', () => { if (pref === 'system') applyTheme(); });

  // header
  let snap = new Date(D.snapshot);
  let snapStr = snap.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
  $('#docName').textContent = `Session sheet · ${D.session}`;
  $('#snapLabel').textContent = `Snapshot ${snapStr}`;

  // ribbon
  function renderRibbon() {
  const idx = D.indices.map(i => `<div class="readout" title="${esc(D.sources[i.src].name)}"><span class="k">${esc(i.name)}</span><span class="v">${fmt(i.last)}</span><span class="d ${cls(i.pct)}">${money(i.chg)} · ${pct(i.pct)}</span></div>`).join('');
  const mac = D.macro.map(m => `<div class="readout sm" title="${esc(D.sources[m.src].name)} · as of ${esc(m.asof)} ET"><span class="k">${esc(m.k)}</span><span class="v">${esc(m.v)}</span><span class="d ${m.dir > 0 ? 'up' : 'down'}">${esc(m.d)}</span></div>`).join('');
  $('#ribbon').innerHTML = `
    <div class="rb-group"><div class="rb-items">${idx}</div><div class="rb-label">Indices · close ${esc(D.session)}</div></div>
    <div class="rb-group"><div class="rb-items">${mac}</div><div class="rb-label">Rates, FX &amp; commodities</div></div>
    ${D.fearGreed ? (() => { const f = D.fearGreed, chg = f.prevClose == null ? null : f.score - f.prevClose; return `<div class="rb-group"><div class="rb-items"><a class="readout sm" href="${esc(D.sources['cnn-fg'] ? D.sources['cnn-fg'].url : 'https://www.cnn.com/markets/fear-and-greed')}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none" title="CNN Business Fear &amp; Greed Index: 0 = extreme fear, 100 = extreme greed"><span class="k">Fear &amp; Greed</span><span class="v">${f.score} <span style="font-size:.8em;font-weight:500" class="${f.score < 45 ? 'down' : f.score > 55 ? 'up' : 'flat'}">${esc(f.rating)}</span></span><span class="d ${chg == null ? 'flat' : cls(chg)}">${chg == null ? '' : (chg > 0 ? '+' : chg < 0 ? '−' : '±') + Math.abs(chg) + ' vs. prev. close'}</span></a></div><div class="rb-label">CNN mood gauge</div></div>`; })() : ''}
    <div class="rb-group"><div class="rb-items">
      <a class="rb-btn" href="#picks"><svg class="ic"><use href="#i-target"/></svg><span>Picks</span></a>
      <a class="rb-btn" href="#learn"><svg class="ic"><use href="#i-bulb"/></svg><span>Tips</span></a>
      <a class="rb-btn" href="#stories"><svg class="ic"><use href="#i-news"/></svg><span>Stories</span></a>
      <a class="rb-btn" href="#tape"><svg class="ic"><use href="#i-chart"/></svg><span>Tape</span></a>
      <a class="rb-btn" href="#sentiment"><svg class="ic"><use href="#i-chat"/></svg><span>Social</span></a>
      <a class="rb-btn" href="#calendar"><svg class="ic"><use href="#i-cal"/></svg><span>Week</span></a>
      <a class="rb-btn" href="#sources"><svg class="ic"><use href="#i-doc"/></svg><span>Sources</span></a>
    </div><div class="rb-label">Jump to</div></div>`;
  }
  renderRibbon();

  // watchlist
  const filters = [['all', 'All'], ['mine', 'My watchlist'], ['pick', 'Picks'], ['ai', 'AI & chips'], ['mega', 'Mega-cap'], ['social', 'Trending'], ['etf', 'ETFs']];
  let filt = 'all', q = '', sel = pickSyms[0];
  try { if (localStorage.getItem('pm-filter') === 'mine') filt = 'mine'; } catch (e) {}
  function renderChips() {
    $('#chips').innerHTML = filters.map(([k, l]) => `<button class="chip" data-f="${k}" aria-pressed="${k === filt}">${l}${k === 'mine' ? ` <span class="chip-n">${mine.length}</span>` : ''}</button>`).join('');
  }
  renderChips();
  $('#chips').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; filt = b.dataset.f; try { localStorage.setItem('pm-filter', filt); } catch (e) {} renderChips(); renderWL(); };
  $('#q').oninput = e => { q = e.target.value.trim().toLowerCase(); renderWL(); };
  function renderWL() {
    const rows = D.watchlist.filter(w => (filt === 'all' || (filt === 'mine' ? inMine(w.sym) : filt === 'pick' ? pickSyms.includes(w.sym) : w.tags.includes(filt))) && (!q || w.sym.toLowerCase().includes(q) || w.name.toLowerCase().includes(q)));
    $('#wlCount').textContent = rows.length + ' symbols';
    $('#wl').innerHTML = rows.map(w => `<div class="wl-item${inMine(w.sym) ? ' saved' : ''}"><button class="wl-row" role="option" data-s="${w.sym}" aria-selected="${w.sym === sel}">
      <span class="wl-sym">${w.sym}${pickSyms.includes(w.sym) ? '<span class="badge pk">PICK</span>' : ''}${w.tags.includes('etf') ? '<span class="badge" title="Exchange-traded fund">ETF</span>' : ''}${w.stale ? '<span class="badge stale">' + esc(w.stale) + '</span>' : ''}</span>
      <span class="wl-px">${w.px == null ? '—' : '$' + fmt(w.px)}</span>
      <span class="wl-name">${esc(w.name)}</span>
      <span class="wl-chg ${cls(w.pct)}">${w.pct == null ? 'n/a' : move(chgOf(w), w.pct)}${w.ah ? ` <span class="${cls(w.ahPct)}" title="After hours">· AH ${move(w.px != null ? w.ah - w.px : null, w.ahPct)}</span>` : ''}</span>
    </button>${addBtn(w.sym, 'add-btn wl-add')}</div>`).join('') || (filt === 'mine' && !q
      ? '<div class="note" style="padding:1rem;text-align:center">Your watchlist is empty.<br>Click the <b>+</b> next to any stock to add it here.</div>'
      : '<div class="note" style="padding:1rem;text-align:center">No symbols match.</div>');
  }
  $('#wl').onclick = e => { const r = e.target.closest('.wl-row'); if (r) select(r.dataset.s); };
  function select(s) { sel = s; renderWL(); renderInsp(); }

  // inspector
  function renderInsp() {
    const w = bySym[sel]; if (!w) return;
    const p = D.picks.find(x => x.sym === sel);
    $('#inspFor').textContent = w.sym;
    const facts = (w.facts || []).map(([k, v]) => `<span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>`).join('');
    $('#insp').innerHTML = `
      <div class="insp-head"><div><div class="insp-sym">${w.sym}</div><div class="sub">${esc(w.name)}</div></div>${addBtn(w.sym, 'btn sm add-wide', true)}</div>
      <div>
        <div class="insp-px">${w.px == null ? '—' : '$' + fmt(w.px)}</div>
        <div class="${cls(w.pct)}" style="font-family:var(--font-tech);font-weight:600">${w.pct == null ? (w.stale ? 'Last verified: ' + esc(w.stale) : 'Close not captured') : move(chgOf(w), w.pct) + ' on the day'}</div>
        ${w.ah ? `<div class="${cls(w.ahPct)}" style="font-family:var(--font-tech)">After hours $${fmt(w.ah)} · ${move(w.px != null ? w.ah - w.px : null, w.ahPct)}</div>` : ''}
      </div>
      <div class="prop"><div class="prop-h">Quote</div><div class="kv">
        <span class="k">Price source</span><span class="v">${src(w.src)}</span>
        <span class="k">As of</span><span class="v">${w.stale ? esc(w.stale) : esc(snapStr)}</span>
        ${p ? `<span class="k">Today's pick</span><span class="v">${esc(p.role)}</span>` : ''}
      </div></div>
      ${w.note ? `<div class="prop"><div class="prop-h">What's driving it</div><p>${esc(w.note)}</p>${w.noteSrc ? `<p class="srcs" style="padding-top:0">${srcs(w.noteSrc)}</p>` : ''}</div>` : ''}
      ${facts ? `<div class="prop"><div class="prop-h">Key figures</div><div class="kv">${facts}</div>${w.factsSrc ? `<p class="srcs" style="padding-top:0">${srcs(w.factsSrc)}</p>` : ''}</div>` : ''}
      <div class="live-note">${live.on ? 'Live quote from Finnhub, refreshed every minute. Free-tier quotes can lag the exchange slightly.' : 'Prices come from the last data refresh, not a streaming quote. Turn on Live quotes (top right) or check your broker before trading.'}</div>`;
  }

  // tips & strategies: data/tips.json, rotated every 2 hours on New York time (no server run needed)
  let TIPS = null;
  fetch('data/tips.json?t=' + Math.floor(Date.now() / 36e5), { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null).then(t => { if (t && t.tips && t.strategies) { TIPS = t; renderLearn(); } }).catch(() => {});
  const etClock = () => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map(x => [x.type, x.value]));
    const h = +p.hour % 24, mi = +p.minute;
    return { slot: Math.round(Date.UTC(+p.year, +p.month - 1, +p.day) / 864e5) * 12 + Math.floor(h / 2), h, mi };
  };
  let learnSlot = null;
  function learnHTML() {
    if (!TIPS) return '<div class="note" style="padding:1rem">Loading tips…</div>';
    const c = etClock(), t = TIPS.tips[c.slot % TIPS.tips.length], st = TIPS.strategies[c.slot % TIPS.strategies.length];
    const left = (2 - c.h % 2) * 60 - c.mi, nextH = (c.h - c.h % 2 + 2) % 24;
    const nextLabel = `${nextH % 12 || 12} ${nextH < 12 ? 'AM' : 'PM'} ET`;
    const card = (kind, x) => `<article class="tipcard">
        <div class="tip-kind">${kind}</div>
        <h3>${esc(x.title)}</h3>
        <p>${esc(x.body)}</p>
        <div class="tip-try"><b>Try this:</b> ${esc(x.tryit)}</div>
        <div class="srcs"><a href="${esc(x.url)}" target="_blank" rel="noopener" title="${esc(x.src)}">${esc(x.src)}</a></div>
      </article>`;
    learnSlot = c.slot;
    return `<div class="tips">${card('Tip', t)}${card('Strategy', st)}</div>
      <div class="tip-foot note">New tip &amp; strategy at ${nextLabel} · in ${Math.floor(left / 60)}h ${String(left % 60).padStart(2, '0')}m. Educational only, not personal advice.</div>`;
  }
  function renderLearn() { const b = $('#learnBox'); if (b) b.innerHTML = learnHTML(); }
  setInterval(() => { if (TIPS) renderLearn(); }, 60000);

  function storiesHTML() {
    const S = D.stories || [];
    if (!S.length) return '<div class="card-body note">Today\'s stories arrive with the next data update (every morning from 7 AM ET).</div>';
    return `<ol class="stories">${S.map(x => `<li class="story">
        <div class="story-meta"><span class="outlet">${esc(x.outlet)}</span><span>${esc(x.time || '')}</span></div>
        <a class="story-title" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>
        ${x.summary ? `<p>${esc(x.summary)}</p>` : ''}
      </li>`).join('')}</ol>`;
  }

  // sheet
  const lean = { bull: 'Bullish', bear: 'Bearish', split: 'Split', info: 'Context' };
  function renderSheet() {
  const tableOpen = $('#tblBtn') && $('#tblBtn').getAttribute('aria-pressed') === 'true';
  $('#sheet').innerHTML = `
    <section class="card">
      <div class="hero">
        <div>
          <div class="eyebrow">Session recap · ${esc(D.session)}</div>
          <h2>${esc(D.headline)}</h2>
          <p>${esc(D.summary)}</p>
          <div class="srcs" style="margin-top:.5rem">${srcs(D.summarySrc)}</div>
        </div>
        <div class="hero-stats">
          ${D.indices.map(i => `<div class="stat"><div class="k">${esc(i.name)}</div><div class="v">${fmt(i.last)}</div><div class="${cls(i.pct)}" style="font-family:var(--font-tech);font-size:.88rem">${move(i.chg, i.pct)}</div></div>`).join('')}
        </div>
      </div>
    </section>

    <section class="card" id="picks">
      <div class="card-head">
        <div><div class="eyebrow">Today's 3 ideas · for ${esc(D.picksFor)}</div><h2>Watchlist picks</h2></div>
        <div class="sub">${D.mode === 'auto' ? 'Scores 0–10 come from the rule in Methodology.' : 'Scores 0–10 are Claude\'s judgment from the cited sources.'} Click a card to inspect.</div>
      </div>
      <div class="picks">
        ${D.picks.map((p, n) => { const w = bySym[p.sym]; return `
        <article class="pick" data-s="${p.sym}" tabindex="0">
          <div class="pick-top">
            <div><div class="pick-no">IDEA ${String(n + 1).padStart(2, '0')}</div><div class="pick-sym">${p.sym}</div><div class="pick-name">${esc(w.name)}</div></div>
            <span class="pick-actions"><span class="role">${esc(p.role)}</span>${addBtn(p.sym, 'add-btn')}</span>
          </div>
          <div class="pick-px"><span class="px">${w.px == null ? '—' : '$' + fmt(w.px)}</span>
            <span class="meta ${cls(w.pct)}">${w.pct == null ? (w.stale ? esc(w.stale) : '') : move(chgOf(w), w.pct)}</span>
            ${w.ah ? `<span class="meta ${cls(w.ahPct)}">AH $${fmt(w.ah)} · ${move(w.px != null ? w.ah - w.px : null, w.ahPct)}</span>` : ''}</div>
          <ul class="thesis">${p.thesis.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
          <div>${Object.entries(p.scores).map(([k, v]) => `<div class="score"><span class="lbl">${esc(k)}</span><span class="bar"><i style="width:${v * 10}%"></i></span><span class="n">${v}</span></div>`).join('')}</div>
          <div class="risk"><b>Risk</b><span class="riskpill ${p.risk}">${p.risk === 'high' ? 'HIGH' : 'MODERATE'}</span> ${esc(p.risks)}</div>
          <div class="srcs">${srcs(p.src)}</div>
        </article>`; }).join('')}
      </div>
      <div style="padding:0 1rem 1rem"><div class="disclaimer"><b>Not investment advice.</b> These are research ideas built from public reporting, not recommendations to buy or sell. They aren't tailored to your goals, timeline or risk tolerance. Single stocks can lose a lot of value quickly. Consider position sizing and diversification, and talk to a licensed advisor before investing money you can't afford to lose.</div></div>
    </section>

    <section class="card" id="learn">
      <div class="card-head">
        <div><div class="eyebrow">Learn · changes every 2 hours</div><h2>Tips &amp; strategies</h2></div>
        <div class="sub">From the SEC, IRS, FINRA, CFPB and established research firms</div>
      </div>
      <div id="learnBox">${learnHTML()}</div>
    </section>

    <section class="card" id="stories">
      <div class="card-head">
        <div><div class="eyebrow">Daily stories · ${esc(D.storiesDate || D.session)}</div><h2>Investing stories of the day</h2></div>
        <div class="sub">Established newsrooms only: ${[...new Set((D.stories || []).map(x => x.outlet))].map(esc).join(', ') || 'MarketWatch, CNBC, Kiplinger, NPR, NYT'}</div>
      </div>
      ${storiesHTML()}
    </section>

    <section class="card" id="tape">
      <div class="card-head">
        <div><div class="eyebrow">Tape · last ${D.history.dates.length} sessions</div><h2>Indices since ${esc(D.history.dates[0] || '—')}</h2></div>
        <div style="display:flex;gap:.4rem"><button class="btn sm" id="tblBtn" aria-pressed="false">Table view</button></div>
      </div>
      <div class="chart-wrap">
        <div class="legend" id="legend"></div>
        <svg id="chart" role="img" aria-label="Percent change of S&P 500, Dow and Nasdaq since Nov 9"></svg>
        <div class="tip" id="tip" hidden></div>
        <div id="tbl" hidden></div>
        <div class="note" style="margin-top:.5rem">${esc(D.history.note)} <span class="srcs" style="display:inline-flex">${srcs(D.history.src)}</span></div>
      </div>
    </section>

    <section class="card" id="sentiment">
      <div class="card-head"><div><div class="eyebrow">Crowd &amp; institutions</div><h2>Market mood &amp; social sentiment</h2></div><div class="sub">${D.mode === 'auto' ? 'CNN, Reddit communities, Stocktwits, analysts and Schwab research' : 'Reddit, X, Stocktwits, retail flow and Schwab research'}</div></div>
      <div class="scroll"><table>
        <thead><tr><th>Platform</th><th>Tickers</th><th>Lean</th><th>What it says</th><th>Source</th></tr></thead>
        <tbody>${D.sentiment.map(s => `<tr><td><div class="tick">${esc(s.platform)}</div><div class="sub" style="font-size:.82rem">${esc(s.detail)}</div></td><td class="tick" style="white-space:nowrap">${esc(s.tickers)}</td><td><span class="lean ${s.lean}">${lean[s.lean]}</span></td><td>${esc(s.read)}</td><td><span class="srcs">${src(s.src)}</span></td></tr>`).join('')}</tbody>
      </table></div>
      <div class="card-body note" style="border-top:1px solid var(--line)">
        <p><b style="color:var(--ink)">${D.mode === 'auto' ? 'Market headlines' : 'Macro backdrop'}.</b>${D.mode === 'auto' ? ' From established outlets in the last 24 hours, one per outlet.' : ''}</p>
        ${D.macroNotes.length ? '' : '<p>No headlines from established outlets yet. They arrive with the 3 PM update.</p>'}
        ${D.macroNotes.map(m => `<p>• ${esc(m.t)} <span class="srcs" style="display:inline-flex">${src(m.src)}</span></p>`).join('')}
      </div>
    </section>

    <section class="card" id="calendar">
      <div class="card-head"><div><div class="eyebrow">Week ahead</div><h2>Catalyst calendar</h2></div><div class="srcs">${src(D.calendarSrc)}</div></div>
      <div class="cal">${D.calendar.map(c => `<div class="cal-day"><div class="d">${esc(c.d)}</div><ul>${c.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}</div>
    </section>

    <section class="card" id="method">
      <div class="card-head"><div><div class="eyebrow">Methodology</div><h2>How the picks are chosen</h2></div></div>
      <div class="card-body note">
${D.mode === 'auto' ? `
        <p>The GitHub Action builds this sheet from <b>Finnhub</b> (quotes, analyst recommendations, company news, earnings dates), <b>ApeWisdom</b> (Reddit mentions across r/wallstreetbets, r/stocks, r/investing and others) and <b>Stocktwits</b> trending symbols. Charles Schwab's daily update is linked for context because Schwab has no public data feed.</p>
        <p>Candidates are the watchlist plus the top Reddit and Stocktwits names. Anything under $5 or a $2B market cap is dropped. Each stock is scored 0–10 on <b>Catalyst</b> (headlines in the last 36 hours, plus earnings within 3 days), <b>Price action</b> (today's move vs. SPY), <b>Crowd</b> (Reddit rank, a jump in mentions, Stocktwits trending) and <b>Institutional</b> (share of analysts at Buy). The weighted top three are taken from <b>three different industries</b>, and each gets a risk rating and counter-arguments.</p>` : `<p>Each weekday morning the sheet is rebuilt from published reporting: index closes from AP, CNBC and the Motley Fool; Charles Schwab's daily Market Update and strategist research; crowd attention from Reddit trackers, Stocktwits and X roundups; and retail-flow reporting.</p>
        <p>Candidates need a fresh, verifiable catalyst. Each one is scored on <b>Catalyst</b> (news or earnings that could move it), <b>Price action</b> (how it traded against the tape), <b>Crowd</b> (attention and sentiment on social platforms) and <b>Institutional</b> (Schwab commentary and the analyst consensus). The three are chosen to avoid stacking one theme, so at least one idea sits outside the dominant trade. A risk rating and the main counter-arguments come with every idea.</p>`}
        <p>Crowd sentiment is a signal of attention, not of quality: heavily discussed stocks often move sharply both ways.</p>
      </div>
    </section>

    <section class="card" id="sources">
      <div class="card-head"><div><div class="eyebrow">Bill of materials</div><h2>Sources</h2></div><div class="sub">${Object.keys(D.sources).length} sources · snapshot ${esc(snapStr)}</div></div>
      <ol class="src-list">${Object.values(D.sources).map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></li>`).join('')}</ol>
    </section>`;
  $('#tblBtn').onclick = function () { toggleTable(this.getAttribute('aria-pressed') !== 'true'); };
  if (tableOpen) toggleTable(true);
  drawChart();
  }

  $('#sheet').addEventListener('click', e => { const c = e.target.closest('.pick'); if (c && !e.target.closest('a')) select(c.dataset.s); });
  $('#sheet').addEventListener('keydown', e => { const c = e.target.closest('.pick'); if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(c.dataset.s); } });

  // chart (indexed % change since first date)
  const colors = () => { const cs = getComputedStyle(root); return ['--s1', '--s2', '--s3'].map(v => cs.getPropertyValue(v).trim()); };
  function drawChart() {
    const svg = $('#chart'); if (!svg) return;
    const H = D.history;
    if (!H || H.dates.length < 2) { svg.innerHTML = ''; svg.style.height = '40px'; $('#legend').innerHTML = '<span>History is building — the chart appears after the second trading day.</span>'; return; }
    svg.style.height = '';
    const rel = H.series.map(s => { const b = s.values.find(v => v != null); return s.values.map(v => v == null || !b ? null : (v / b - 1) * 100); });
    const C = colors();
    $('#legend').innerHTML = H.series.map((s, i) => `<span><i style="background:${C[i]}"></i>${esc(s.name)}</span>`).join('');
    const W = svg.clientWidth || 700, Ht = 280, m = { l: 44, r: 70, t: 14, b: 26 };
    svg.setAttribute('viewBox', `0 0 ${W} ${Ht}`);
    const all = rel.flat().filter(v => v != null);
    let lo = Math.floor(Math.min(...all, 0)), hi = Math.ceil(Math.max(...all, 0));
    if (hi - lo < 1) { hi = lo + 1; }
    const x = i => m.l + i * (W - m.l - m.r) / (H.dates.length - 1);
    const y = v => m.t + (hi - v) * (Ht - m.t - m.b) / (hi - lo);
    const cs = getComputedStyle(root), line = cs.getPropertyValue('--line').trim(), ink3 = cs.getPropertyValue('--ink-3').trim(), surf = cs.getPropertyValue('--raised').trim();
    let g = '';
    for (let v = lo; v <= hi; v += 1) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${line}" stroke-width="1" ${v === 0 ? '' : 'stroke-dasharray="2 4"'}/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${v > 0 ? '+' : ''}${v}%</text>`;
    H.dates.forEach((d, i) => g += `<text x="${x(i)}" y="${Ht - 8}" text-anchor="middle">${d}</text>`);
    rel.forEach((vals, si) => {
      const segs = [[]]; vals.forEach((v, i) => { if (v == null) segs.push([]); else segs[segs.length - 1].push([x(i), y(v)]); });
      segs.filter(sg => sg.length > 1).forEach(sg => g += `<polyline fill="none" stroke="${C[si]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${sg.map(p => p.join(',')).join(' ')}"/>`);
      vals.forEach((v, i) => { if (v != null) g += `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${C[si]}" stroke="${surf}" stroke-width="2"/>`; });
    });
    // direct labels at end, de-collided
    const ends = rel.map((v, i) => { const last = [...v].reverse().find(t => t != null); return { i, y: y(last ?? 0), v: last ?? 0 }; }).sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
    ends.forEach(e => g += `<text x="${W - m.r + 8}" y="${e.y + 4}" style="fill:${cs.getPropertyValue('--ink-2')};font-weight:600">${H.series[e.i].sym} ${e.v > 0 ? '+' : '−'}${Math.abs(e.v).toFixed(1)}%</text>`);
    g += `<line id="xh" x1="0" x2="0" y1="${m.t}" y2="${Ht - m.b}" stroke="${ink3}" stroke-width="1" opacity="0"/>`;
    g += `<rect x="${m.l - 10}" y="0" width="${W - m.l - m.r + 20}" height="${Ht}" fill="transparent" id="hit"/>`;
    svg.innerHTML = g;
    const tip = $('#tip'), xh = $('#xh');
    $('#hit').onmousemove = e => {
      const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width;
      const i = Math.max(0, Math.min(H.dates.length - 1, Math.round((px - m.l) / ((W - m.l - m.r) / (H.dates.length - 1)))));
      xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('opacity', .5);
      tip.hidden = false;
      tip.innerHTML = `<div class="t">${H.dates[i]}</div>` + H.series.map((s, si) => `<div class="row"><span><i style="background:${C[si]}"></i>${s.name}</span><span>${s.values[i] == null ? 'not captured' : fmt(s.values[i]) + ' (' + (rel[si][i] >= 0 ? '+' : '−') + Math.abs(rel[si][i]).toFixed(2) + '%)'}</span></div>`).join('');
      const wrap = svg.parentElement.getBoundingClientRect();
      let left = e.clientX - wrap.left + 14; if (left + 230 > wrap.width) left = e.clientX - wrap.left - 244;
      tip.style.left = left + 'px'; tip.style.top = (e.clientY - wrap.top - 20) + 'px';
    };
    $('#hit').onmouseleave = () => { tip.hidden = true; xh.setAttribute('opacity', 0); };
  }
  function toggleTable(on) {
    const H = D.history;
    $('#tblBtn').setAttribute('aria-pressed', on);
    $('#tbl').hidden = !on;
    $('#tbl').innerHTML = on ? `<div class="scroll" style="margin-top:.6rem"><table><thead><tr><th>Date</th>${H.series.map(s => `<th style="text-align:right">${s.name}</th>`).join('')}</tr></thead><tbody>${H.dates.map((d, i) => `<tr><td class="tick">${d}</td>${H.series.map(s => `<td class="n">${fmt(s.values[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
  }
  addEventListener('resize', () => { clearTimeout(drawChart.t); drawChart.t = setTimeout(drawChart, 120); });

  // title block (status bar) with live data-age counter
  function age() { const ms = Date.now() - snap.getTime(); if (ms < 0) return 'just now'; const h = Math.floor(ms / 36e5), mn = Math.floor(ms % 36e5 / 6e4); return h >= 48 ? Math.floor(h / 24) + 'd ' + (h % 24) + 'h' : h + 'h ' + String(mn).padStart(2, '0') + 'm'; }
  function renderStatus() {
    const stale = Date.now() - snap.getTime() > 26 * 36e5;
    $('#status').innerHTML = `
      <div class="tb"><span class="k">Sheet</span><span class="v">MKT-${D.snapshot.slice(5, 10).replace('-', '')}</span></div>
      <div class="tb"><span class="k">Snapshot</span><span class="v">${esc(snapStr)}</span></div>
      <div class="tb ${stale ? 'warn' : ''}"><span class="k">Data age</span><span class="v">${age()}${stale ? ' · stale' : ''}</span></div>
      <div class="tb"><span class="k">Sources</span><span class="v">${Object.keys(D.sources).length}</span></div>
      <div class="tb ${live.on ? '' : ''}"><span class="k">Quotes</span><span class="v">${live.on ? (live.err ? '<span style="color:var(--danger)">Live · ' + esc(live.err) + '</span>' : '<span style="color:var(--ok)">● Live · Finnhub' + (live.at ? ' · ' + live.at : '') + '</span>') : 'Snapshot'}</span></div>
      <div class="tb"><span class="k">Next refresh</span><span class="v">${esc(D.nextRefresh)}</span></div>
      <div class="tb"><span class="k">Rev</span><span class="v">Not investment advice</span></div>`;
  }
  // ---------------------------------------------------------------- refresh & live quotes
  function setSnap() {
    snap = new Date(D.snapshot);
    snapStr = snap.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
    $('#docName').textContent = `Session sheet · ${D.session}`;
    $('#snapLabel').textContent = live.on ? 'Live quotes' : `Snapshot ${snapStr}`;
    $('.save-state .dot').style.background = live.on && !live.err ? 'var(--ok)' : '';
  }
  function renderAll() {
    bySym = Object.fromEntries(D.watchlist.map(w => [w.sym, w]));
    pickSyms = D.picks.map(p => p.sym);
    if (!bySym[sel]) sel = pickSyms[0] || D.watchlist[0].sym;
    setSnap(); renderRibbon(); renderWL(); renderInsp(); renderSheet(); renderStatus();
  }

  // Pull the committed data file again every 2 minutes (the GitHub Action updates it).
  async function refreshData() {
    try {
      const nd = await loadData();
      if (nd.snapshot !== D.snapshot) { D = nd; if (live.on) applyLive(); renderAll(); }
    } catch (e) { /* offline — keep showing what we have */ }
  }
  setInterval(refreshData, 120000);

  // Optional live mode: the viewer's own Finnhub key, kept only in this browser.
  const live = { on: false, key: '', timer: null, quotes: {}, err: '', at: '', busy: false, last: 0, cursor: 0 };
  const LIVE_BATCH = 24; // symbols per minute: stays under Finnhub's 60/min alongside the GitHub updater
  try { live.key = localStorage.getItem('pm-finnhub-key') || ''; } catch (e) {}
  function liveSymbols() {
    return [...new Set([...D.indices.map(i => i.sym), ...D.watchlist.map(w => w.sym)])].filter(s => /^[A-Z.]{1,6}$/.test(s));
  }
  function applyLive() {
    for (const w of D.watchlist) {
      const q = live.quotes[w.sym]; if (!q) continue;
      w.px = q.c; w.pct = q.dp; w.chg = q.d; delete w.stale; delete w.ah; delete w.ahPct; w.src = 'finnhub-live';
    }
    for (const i of D.indices) {
      const q = live.quotes[i.sym]; if (!q) continue;
      i.last = q.c; i.chg = q.d; i.pct = q.dp; i.src = 'finnhub-live';
    }
    D.sources['finnhub-live'] = { name: 'Finnhub — live quotes (your API key)', url: 'https://finnhub.io' };
  }
  async function pollLive() {
    // Skip if a poll is still running or one finished in the last 20 s (tab switching, overlapping timers).
    if (live.busy || Date.now() - live.last < 20000) return;
    live.busy = true; live.last = Date.now();
    // The list can be longer than one minute's budget, so poll the index ETFs, picks and core
    // watchlist every time and rotate through the trending names in the remaining slots.
    const all = liveSymbols();
    const core = [...new Set([...D.indices.map(i => i.sym), ...pickSyms, ...mine, ...D.watchlist.filter(w => !w.tags.includes('social')).map(w => w.sym)])].filter(s => all.includes(s)).slice(0, LIVE_BATCH);
    const rest = all.filter(s => !core.includes(s));
    const room = LIVE_BATCH - core.length, take = [];
    for (let i = 0; i < Math.min(room, rest.length); i++) take.push(rest[(live.cursor + i) % rest.length]);
    live.cursor = rest.length ? (live.cursor + take.length) % rest.length : 0;
    const syms = [...core, ...take];
    let ok = 0;
    for (const s of syms) {
      try {
        const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s)}&token=${encodeURIComponent(live.key)}`);
        if (r.status === 401 || r.status === 403) { live.err = 'key rejected'; break; }
        if (r.status === 429) { live.err = 'rate limited, retrying next minute'; break; }
        const q = await r.json();
        if (q && q.c) { live.quotes[s] = q; ok++; }
      } catch (e) { live.err = 'network error'; break; }
    }
    if (ok) { live.err = ok < syms.length && live.err ? live.err : ''; live.at = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }); applyLive(); renderAll(); }
    else renderStatus();
    live.busy = false;
  }
  function startLive() {
    if (!live.key) return;
    live.on = true; live.err = ''; live.last = 0; pollLive();
    clearInterval(live.timer); live.timer = setInterval(pollLive, 60000); // ~19 calls/min, leaving room under the free tier's 60/min for the GitHub updater and a second tab
    $('#liveBtn').setAttribute('aria-pressed', 'true');
  }
  function stopLive() { live.on = false; clearInterval(live.timer); $('#liveBtn').setAttribute('aria-pressed', 'false'); refreshData(); setSnap(); renderStatus(); }

  const dlg = $('#liveDlg');
  $('#liveBtn').onclick = () => { $('#keyInput').value = live.key; $('#liveState').textContent = live.on ? 'Live quotes are on.' : 'Live quotes are off.'; dlg.showModal(); };
  $('#liveForm').onsubmit = e => {
    e.preventDefault();
    const act = e.submitter && e.submitter.value;
    if (act === 'off') { stopLive(); dlg.close(); return; }
    if (act === 'cancel') { dlg.close(); return; }
    live.key = $('#keyInput').value.trim();
    try { live.key ? localStorage.setItem('pm-finnhub-key', live.key) : localStorage.removeItem('pm-finnhub-key'); } catch (e) {}
    dlg.close();
    live.key ? startLive() : stopLive();
  };

  // ---------------------------------------------------------------- command center
  // Built-in commands work for everyone. "Ask AI" uses the visitor's own Claude (Anthropic) or Gemini (Google) API key,
  // kept only in this browser (like the Finnhub key). The AI can only run the site actions below.
  const AI_MODELS = { claude: 'claude-haiku-5-5', gemini: 'gemini-3.8-flash' };
  const AI_NAMES = { claude: 'Claude Haiku 5.5', gemini: 'Gemini 3.8 Flash' };
  // the key itself says which service it belongs to
  const providerOf = k => /^AIza/.test(k) ? 'gemini' : /^sk-ant-/.test(k) ? 'claude' : null;
  const SECTIONS = { picks: 'picks', ideas: 'picks', tips: 'learn', learn: 'learn', strategies: 'learn', stories: 'stories', news: 'stories',
    tape: 'tape', chart: 'tape', sentiment: 'sentiment', social: 'sentiment', reddit: 'sentiment', calendar: 'calendar', earnings: 'calendar',
    week: 'calendar', method: 'method', methodology: 'method', sources: 'sources', top: 'sheet' };
  const FILTERS = { all: 'all', everything: 'all', mine: 'mine', 'my watchlist': 'mine', watchlist: 'mine', picks: 'pick', pick: 'pick',
    ai: 'ai', chips: 'ai', 'ai & chips': 'ai', mega: 'mega', 'mega-cap': 'mega', megacap: 'mega', trending: 'social', social: 'social', etf: 'etf', etfs: 'etf' };
  const ai = { key: '', history: [], busy: false };
  try { ai.key = localStorage.getItem('pm-ai-key') || localStorage.getItem('pm-anthropic-key') || ''; } catch (e) {}
  ai.gHistory = [];
  const symsIn = text => [...new Set((String(text).toUpperCase().match(/\$?\b[A-Z][A-Z.]{0,5}\b/g) || []).map(t => t.replace('$', '')))].filter(t => bySym[t]);

  // the actions both the parser and the AI use; each returns a short line for the log
  const act = {
    add(syms) { const ok = syms.filter(s => bySym[s]), bad = syms.filter(s => !bySym[s]); const added = ok.filter(s => !inMine(s));
      if (added.length) { mine = [...mine, ...added]; saveMine(); }
      const had = ok.filter(s => !added.includes(s));
      return [added.length ? `Added ${added.join(', ')} to your watchlist.` : '', had.length ? `${had.join(', ')} ${had.length > 1 ? 'were' : 'was'} already there.` : '',
        bad.length ? `Not tracked on this site: ${bad.join(', ')}.` : ''].filter(Boolean).join(' '); },
    remove(syms) { const gone = syms.filter(inMine); if (gone.length) { mine = mine.filter(s => !gone.includes(s)); saveMine(); }
      return gone.length ? `Removed ${gone.join(', ')} from your watchlist.` : 'None of those were in your watchlist.'; },
    clear() { const n = mine.length; mine = []; saveMine(); return n ? `Cleared your watchlist (${n} removed).` : 'Your watchlist was already empty.'; },
    select(s) { if (!bySym[s]) return `${s} isn't tracked on this site.`; select(s); return `Showing ${s} in the Inspector.`; },
    filter(f) { if (!filters.some(([k]) => k === f)) return `Unknown filter "${f}".`; filt = f; try { localStorage.setItem('pm-filter', f); } catch (e) {} renderChips(); renderWL();
      return `Watchlist filter: ${filters.find(([k]) => k === f)[1]}.`; },
    go(sec) { const el = sec === 'sheet' ? $('#sheet') : document.getElementById(sec); if (!el) return `No "${sec}" section.`;
      cmdDlg.close(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return `Jumped to ${sec}.`; },
    theme(t) { if (!['light', 'dark', 'system'].includes(t)) return 'Theme must be light, dark or system.'; pref = t; try { localStorage.setItem('pm-theme', t); } catch (e) {} applyTheme(); return `Theme: ${t}.`; },
    quote(s) { const w = bySym[s]; if (!w) return `${s} isn't tracked on this site.`;
      const p = D.picks.find(x => x.sym === s);
      return `${s} (${w.name}): ${w.px == null ? 'no price' : '$' + fmt(w.px)}${w.pct == null ? '' : ', ' + move(chgOf(w), w.pct) + ' today'}${p ? ` · today's pick (${p.role})` : ''}${inMine(s) ? ' · in your watchlist' : ''}.${w.note ? ' Latest: ' + w.note : ''}`; },
    movers() { const m = D.watchlist.filter(w => w.pct != null).sort((a, b) => b.pct - a.pct); if (!m.length) return 'No price changes yet.';
      return `Top: ${m.slice(0, 3).map(w => `${w.sym} ${move(chgOf(w), w.pct)}`).join(', ')}. Bottom: ${m.slice(-3).reverse().map(w => `${w.sym} ${move(chgOf(w), w.pct)}`).join(', ')}.`; },
    picks() { return D.picks.map((p, i) => `${i + 1}. ${p.sym} (${p.role}), ${p.risk} risk`).join(' · ') + '. Not investment advice.'; },
    mylist() { return mine.length ? 'Your watchlist: ' + mine.map(s => bySym[s] && bySym[s].pct != null ? `${s} ${move(chgOf(bySym[s]), bySym[s].pct)}` : s).join(', ') + '.' : 'Your watchlist is empty. Try "add NVDA".'; },
  };
  function saveMine() { try { localStorage.setItem('pm-my-watchlist', JSON.stringify(mine)); } catch (e) {} renderChips(); renderWL(); renderInsp(); renderSheet(); }

  // plain-English parser for the built-in commands; returns null when it doesn't understand
  function runBuiltin(raw) {
    const t = raw.trim().toLowerCase().replace(/[?!.]+$/, '');
    let m;
    if (/^(help|commands|\?)$/.test(t)) return HELP;
    if (/^(welcome|tour|intro|home|go home|back to home)$/.test(t)) { cmdDlg.close(); $('#helpBtn').click(); return 'Opened the welcome screen.'; }
    if (/^(clear|empty|reset) (my )?watch ?list$/.test(t)) return act.clear();
    if ((m = t.match(/^(add|watch|save|follow|track|\+)\s+(.+)$/))) { const s = (m[2].toUpperCase().match(/[A-Z][A-Z.]*/g) || []).filter(x => x.length <= 6).filter(x => !['TO', 'MY', 'AND', 'THE', 'WATCHLIST', 'LIST'].includes(x)); return s.length ? act.add(s) : null; }
    if ((m = t.match(/^(remove|unwatch|delete|drop|unfollow|-)\s+(.+)$/))) { const s = (m[2].toUpperCase().match(/[A-Z][A-Z.]*/g) || []).filter(x => x.length <= 6).filter(x => !['FROM', 'MY', 'AND', 'THE', 'WATCHLIST', 'LIST'].includes(x)); return s.length ? act.remove(s) : null; }
    if ((m = t.match(/^(dark|light|system)( mode| theme)?$/)) || (m = t.match(/^(?:theme|mode)\s+(dark|light|system)$/))) return act.theme(m[1]);
    if (/^(live|live quotes|go live|stream( prices)?)$/.test(t)) { cmdDlg.close(); $('#liveBtn').click(); return 'Opened Live quotes.'; }
    if (/^(top )?movers$|^(best|worst|biggest movers)/.test(t)) return act.movers();
    if (/^(show |list )?(my )?watch ?list$|^what'?s in my watch ?list/.test(t)) { act.filter('mine'); return act.mylist(); }
    if (/^(today'?s )?(picks|ideas)$|^what are (today'?s|the) picks/.test(t)) return act.picks();
    if ((m = t.match(/^(?:filter|show only|only)\s+(.+)$/)) && FILTERS[m[1]]) return act.filter(FILTERS[m[1]]);
    if ((m = t.match(/^(?:go to|goto|open|show|jump to|scroll to)\s+(?:the\s+)?(.+?)(?:\s+section)?$/)) && SECTIONS[m[1]]) return act.go(SECTIONS[m[1]]);
    if (SECTIONS[t] && !bySym[t.toUpperCase()]) return act.go(SECTIONS[t]);
    if ((m = t.match(/^(?:price( of)?|quote|how is|how's|what about|check)\s+\$?([a-z.]{1,6})(?: doing)?$/)) && bySym[m[2].toUpperCase()]) return act.quote(m[2].toUpperCase());
    if ((m = t.match(/^(?:inspect|select|open|show|view)\s+\$?([a-z.]{1,6})$/)) && bySym[m[1].toUpperCase()]) { act.select(m[1].toUpperCase()); return act.quote(m[1].toUpperCase()); }
    if (/^\$?[a-z.]{1,6}$/.test(t) && bySym[t.replace('$', '').toUpperCase()]) { const s = t.replace('$', '').toUpperCase(); act.select(s); return act.quote(s); }
    return null;
  }
  const HELP = 'Try: "add NVDA AMD" · "remove TSLA" · "show my watchlist" · "how is AAPL doing" · "top movers" · "today\'s picks" · "go to stories" · "filter AI" · "dark mode" · "live quotes" · "clear my watchlist". Anything else goes to Ask AI when it\'s connected.';

  // ---- AI (Claude) with tools that map to the actions above
  const TOOLS = [
    { name: 'add_to_watchlist', description: "Add stocks to the visitor's personal watchlist.", input_schema: { type: 'object', properties: { symbols: { type: 'array', items: { type: 'string' } } }, required: ['symbols'] } },
    { name: 'remove_from_watchlist', description: "Remove stocks from the visitor's personal watchlist.", input_schema: { type: 'object', properties: { symbols: { type: 'array', items: { type: 'string' } } }, required: ['symbols'] } },
    { name: 'select_stock', description: 'Open a stock in the Inspector panel on the right.', input_schema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] } },
    { name: 'filter_watchlist', description: 'Filter the left sidebar list.', input_schema: { type: 'object', properties: { filter: { type: 'string', enum: ['all', 'mine', 'pick', 'ai', 'mega', 'social', 'etf'] } }, required: ['filter'] } },
    { name: 'go_to_section', description: 'Scroll the page to a section. This closes the command center.', input_schema: { type: 'object', properties: { section: { type: 'string', enum: ['sheet', 'picks', 'learn', 'stories', 'tape', 'sentiment', 'calendar', 'method', 'sources'] } }, required: ['section'] } },
    { name: 'set_theme', description: 'Switch the color theme.', input_schema: { type: 'object', properties: { theme: { type: 'string', enum: ['light', 'dark', 'system'] } }, required: ['theme'] } },
  ];
  function runTool(name, input) {
    const up = a => (a || []).map(s => String(s).toUpperCase().replace('$', ''));
    switch (name) {
      case 'add_to_watchlist': return act.add(up(input.symbols));
      case 'remove_from_watchlist': return act.remove(up(input.symbols));
      case 'select_stock': return act.select(up([input.symbol])[0]);
      case 'filter_watchlist': return act.filter(input.filter);
      case 'go_to_section': return act.go(input.section);
      case 'set_theme': return act.theme(input.theme);
      default: return 'Unknown action.';
    }
  }
  function siteContext() {
    const c = TIPS ? etClock() : null;
    return JSON.stringify({
      session: D.session, snapshot: snapStr, liveQuotes: live.on,
      indices: D.indices.map(i => ({ name: i.name, last: i.last, pct: i.pct })),
      fearGreed: D.fearGreed ? { score: D.fearGreed.score, rating: D.fearGreed.rating } : null,
      myWatchlist: mine, selected: sel, sidebarFilter: filt,
      stocks: D.watchlist.map(w => ({ sym: w.sym, name: w.name, px: w.px, pct: w.pct, tags: w.tags, note: w.note || undefined })),
      picks: D.picks.map(p => ({ sym: p.sym, role: p.role, risk: p.risk, thesis: p.thesis, risks: p.risks, scores: p.scores })),
      sentiment: D.sentiment.map(s => ({ platform: s.platform, tickers: s.tickers, lean: s.lean, read: s.read })),
      headlines: D.macroNotes.map(n => n.t), stories: (D.stories || []).map(s => `${s.title} (${s.outlet})`),
      calendar: D.calendar,
      tipNow: c ? TIPS.tips[c.slot % TIPS.tips.length].title : null, strategyNow: c ? TIPS.strategies[c.slot % TIPS.strategies.length].title : null,
    });
  }
  const SYSTEM = () => `You are the command center inside Partsmith Markets, a stock-tracking website. Help the visitor by running site actions with your tools and by answering questions using ONLY the site data below.
Rules:
- Be brief: 1-4 short sentences, plain text, no markdown headers.
- You can only do what the tools allow (watchlist, inspector, filters, scrolling, theme). You cannot trade, move money, look up stocks the site doesn't track, or browse the web. Say so if asked.
- Only use symbols that appear in "stocks". If a stock isn't tracked, say so.
- Never tell someone to buy or sell. You may explain the data, the picks' reasoning and risks. If asked for advice, note that this is not investment advice and they should consider their own goals or a licensed advisor.
- Prices are a snapshot from ${snapStr}${live.on ? ' with live quotes on' : ''}; mention that when quoting prices.
Site data (JSON): ${siteContext()}`;

  async function askAI(text) { return providerOf(ai.key) === 'gemini' ? askGemini(text) : askClaude(text); }

  async function askClaude(text) {
    ai.history.push({ role: 'user', content: text });
    if (ai.history.length > 16) ai.history = ai.history.slice(-16);
    while (ai.history.length && (ai.history[0].role !== 'user' || typeof ai.history[0].content !== 'string')) ai.history.shift();
    for (let step = 0; step < 6; step++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': ai.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: AI_MODELS.claude, max_tokens: 700, system: SYSTEM(), tools: TOOLS, messages: ai.history }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        ai.history.pop();
        const msg = (j.error && j.error.message) || `HTTP ${r.status}`;
        throw new Error(r.status === 401 ? 'Your API key was rejected. Check it under "AI settings".' : r.status === 429 ? 'Rate limited by Anthropic. Try again in a moment.' : msg);
      }
      ai.history.push({ role: 'assistant', content: j.content });
      const calls = j.content.filter(b => b.type === 'tool_use');
      j.content.filter(b => b.type === 'text' && b.text.trim()).forEach(b => logLine('ai', b.text));
      if (!calls.length) return;
      const results = calls.map(c => { const out = runTool(c.name, c.input || {}); logLine('act', out); return { type: 'tool_result', tool_use_id: c.id, content: out }; });
      ai.history.push({ role: 'user', content: results });
    }
  }

  // Gemini: same tools, Google's format. The model's turns go back exactly as received
  // (they can carry a "thought signature" Gemini needs for multi-step tool use).
  const gSchema = x => {
    if (Array.isArray(x)) return x.map(gSchema);
    if (!x || typeof x !== 'object') return x;
    const o = {};
    for (const [k, v] of Object.entries(x)) o[k] = k === 'type' ? String(v).toUpperCase() : gSchema(v);
    return o;
  };
  const G_TOOLS = [{ functionDeclarations: TOOLS.map(t => ({ name: t.name, description: t.description, parameters: gSchema(t.input_schema) })) }];
  async function askGemini(text) {
    const H = ai.gHistory;
    H.push({ role: 'user', parts: [{ text }] });
    while (H.length > 16) H.shift();
    while (H.length && !(H[0].role === 'user' && H[0].parts.some(p => p.text))) H.shift();
    for (let step = 0; step < 6; step++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${AI_MODELS.gemini}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': ai.key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM() }] }, contents: H, tools: G_TOOLS, generationConfig: { maxOutputTokens: 2048 } }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        H.pop();
        const msg = (j.error && j.error.message) || `HTTP ${r.status}`;
        throw new Error(/api key not valid|API_KEY_INVALID/i.test(msg) || r.status === 401 || r.status === 403
          ? 'Your Gemini API key was rejected. Check it under "AI settings".'
          : r.status === 429 ? 'Rate limited by Google (or out of free quota). Try again in a moment.' : msg);
      }
      const cand = (j.candidates || [])[0], content = cand && cand.content;
      if (!content || !content.parts) { logLine('err', cand && cand.finishReason ? `Gemini stopped (${cand.finishReason}). Try rephrasing.` : 'Gemini returned an empty answer. Try again.'); return; }
      H.push({ role: 'model', parts: content.parts });
      content.parts.filter(p => p.text && !p.thought && p.text.trim()).forEach(p => logLine('ai', p.text));
      const calls = content.parts.filter(p => p.functionCall);
      if (!calls.length) return;
      const parts = calls.map(c => { const out = runTool(c.functionCall.name, c.functionCall.args || {}); logLine('act', out);
        return { functionResponse: { name: c.functionCall.name, response: { result: out } } }; });
      H.push({ role: 'user', parts });
    }
  }

  // ---- UI
  const cmdDlg = $('#cmdDlg'), cmdLog = $('#cmdLog'), cmdIn = $('#cmdInput');
  const SUGGEST = ['add NVDA', 'show my watchlist', 'top movers', "today's picks", 'how is AAPL doing', 'go to stories', 'go to tips', 'filter AI', 'dark mode', 'help'];
  function logLine(kind, text) {
    const d = document.createElement('div'); d.className = 'cmd-line ' + kind;
    d.innerHTML = kind === 'act' ? '<span class="cmd-ok">✓</span> ' + esc(text) : esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
    cmdLog.appendChild(d); cmdLog.scrollTop = cmdLog.scrollHeight;
  }
  function renderAIState() {
    const pv = providerOf(ai.key);
    $('#aiState').innerHTML = ai.key ? `<span class="ai-on">● Ask AI on</span> · ${AI_NAMES[pv] || 'AI'}, using your API key` : 'Ask AI is off: built-in commands only.';
    $('#aiToggle').textContent = ai.key ? 'AI settings' : 'Connect AI';
  }
  function renderSuggest(filter = '') {
    const f = filter.trim().toLowerCase();
    const list = f ? SUGGEST.filter(s => s.includes(f)).slice(0, 5) : SUGGEST.slice(0, 6);
    $('#cmdSuggest').innerHTML = list.map(s => `<button type="button" class="chip" data-cmd="${esc(s)}">${esc(s)}</button>`).join('');
  }
  async function submit(text) {
    text = text.trim(); if (!text || ai.busy) return;
    cmdIn.value = ''; renderSuggest(); logLine('me', text);
    const out = runBuiltin(text);
    if (out != null) { logLine(/^(Added|Removed|Cleared|Showing|Watchlist filter|Jumped|Theme|Opened)/.test(out) ? 'act' : out.startsWith('Try:') ? 'sys' : 'ai', out); return; }
    if (!ai.key) { logLine('sys', `I didn't recognise that command. ${HELP} To ask questions in your own words, click "Connect AI".`); return; }
    ai.busy = true; cmdDlg.classList.add('busy');
    try { await askAI(text); } catch (e) { logLine('err', e.message || 'Something went wrong talking to the AI.'); }
    ai.busy = false; cmdDlg.classList.remove('busy'); cmdIn.focus();
  }
  function openCmd(prefill) {
    if (!cmdDlg.open) cmdDlg.showModal();
    if (!cmdLog.children.length) logLine('sys', 'Type a command like "add NVDA" or "go to stories". Press Enter to run it.' + (ai.key ? ' You can also ask questions in your own words.' : ''));
    renderAIState(); renderSuggest(); if (prefill) cmdIn.value = prefill; cmdIn.focus();
  }
  $('#cmdForm').onsubmit = e => { e.preventDefault(); submit(cmdIn.value); };
  cmdIn.oninput = () => renderSuggest(cmdIn.value);
  $('#cmdSuggest').onclick = e => { const b = e.target.closest('[data-cmd]'); if (b) submit(b.dataset.cmd); };
  $('#cmdBtn').onclick = () => openCmd();
  $('#cmdClose').onclick = () => cmdDlg.close();
  cmdDlg.addEventListener('click', e => { if (e.target === cmdDlg) cmdDlg.close(); });
  $('#aiToggle').onclick = () => { const p = $('#aiPanel'); p.hidden = !p.hidden; if (!p.hidden) { $('#aiKey').value = ai.key; $('#aiKey').focus(); } };
  $('#aiSave').onclick = () => {
    const k = $('#aiKey').value.trim();
    if (k && !providerOf(k)) { $('#aiKeyErr').textContent = 'That doesn\'t look like a Claude key (starts with sk-ant-) or a Gemini key (starts with AIza).'; return; }
    $('#aiKeyErr').textContent = '';
    ai.key = k; ai.history = []; ai.gHistory = [];
    try { localStorage.removeItem('pm-anthropic-key'); k ? localStorage.setItem('pm-ai-key', k) : localStorage.removeItem('pm-ai-key'); } catch (e) {}
    $('#aiPanel').hidden = true; renderAIState();
    logLine('sys', k ? `Ask AI is connected with ${AI_NAMES[providerOf(k)]}. Ask anything about today's data, or tell it what to do.` : 'Ask AI turned off. Your key was removed from this browser.'); cmdIn.focus();
  };
  $('#aiForget').onclick = () => { $('#aiKey').value = ''; $('#aiSave').click(); };
  addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); cmdDlg.open ? cmdDlg.close() : openCmd(); }
    else if (e.key === '/' && !cmdDlg.open && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { e.preventDefault(); openCmd(); }
  });
  $('#cmdKbd').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';

  renderStatus(); setInterval(renderStatus, 30000);
  // Background tabs get their timers slowed, so catch up as soon as the tab is visible again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    refreshData(); renderStatus();
    if (live.on) pollLive();
  });
  renderAll(); applyTheme();
  if (live.key) startLive();
})();
