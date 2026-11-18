/* Partsmith Markets — renders data/market.json and, when a Finnhub key is set, streams quotes. */
(async function () {
  let D;
  try {
    const r = await fetch('data/market.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    D = await r.json();
  } catch (err) {
    document.getElementById('sheet').innerHTML = `<section class="card"><div class="card-body note"><h2>Couldn't load data/market.json</h2><p>${String(err.message || err)}</p><p>Browsers block <code>fetch()</code> on pages opened straight from disk. Serve the folder instead: <code>python3 -m http.server 8000</code>, then open <code>http://localhost:8000</code>. On GitHub Pages this works automatically.</p></div></section>`;
    return;
  }
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 2) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sign = n => n > 0 ? '+' : n < 0 ? '−' : '';
  const pct = n => n == null ? '—' : sign(n) + Math.abs(n).toFixed(2) + '%';
  const cls = n => n == null ? 'flat' : n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  const src = id => { const s = D.sources[id]; if (!s) return ''; const [pub, rest] = s.name.split(' — '); const label = id.startsWith('news-') && rest ? `${pub}: ${rest.length > 34 ? rest.slice(0, 32).trim() + '…' : rest}` : pub; return `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.name)}">${esc(label)}</a>`; };
  const srcs = ids => [...new Set(ids)].map(src).join('');
  let bySym = Object.fromEntries(D.watchlist.map(w => [w.sym, w]));
  let pickSyms = D.picks.map(p => p.sym);

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
  const idx = D.indices.map(i => `<div class="readout" title="${esc(D.sources[i.src].name)}"><span class="k">${esc(i.name)}</span><span class="v">${fmt(i.last)}</span><span class="d ${cls(i.pct)}">${sign(i.chg)}${fmt(Math.abs(i.chg))} · ${pct(i.pct)}</span></div>`).join('');
  const mac = D.macro.map(m => `<div class="readout sm" title="${esc(D.sources[m.src].name)} · as of ${esc(m.asof)} ET"><span class="k">${esc(m.k)}</span><span class="v">${esc(m.v)}</span><span class="d ${m.dir > 0 ? 'up' : 'down'}">${esc(m.d)}</span></div>`).join('');
  $('#ribbon').innerHTML = `
    <div class="rb-group"><div class="rb-items">${idx}</div><div class="rb-label">Indices · close ${esc(D.session)}</div></div>
    <div class="rb-group"><div class="rb-items">${mac}</div><div class="rb-label">Rates, FX &amp; commodities</div></div>
    ${D.fearGreed ? (() => { const f = D.fearGreed, chg = f.prevClose == null ? null : f.score - f.prevClose; return `<div class="rb-group"><div class="rb-items"><a class="readout sm" href="${esc(D.sources['cnn-fg'] ? D.sources['cnn-fg'].url : 'https://www.cnn.com/markets/fear-and-greed')}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none" title="CNN Business Fear &amp; Greed Index: 0 = extreme fear, 100 = extreme greed"><span class="k">Fear &amp; Greed</span><span class="v">${f.score} <span style="font-size:.8em;font-weight:500" class="${f.score < 45 ? 'down' : f.score > 55 ? 'up' : 'flat'}">${esc(f.rating)}</span></span><span class="d ${chg == null ? 'flat' : cls(chg)}">${chg == null ? '' : (chg > 0 ? '+' : chg < 0 ? '−' : '±') + Math.abs(chg) + ' vs. prev. close'}</span></a></div><div class="rb-label">CNN mood gauge</div></div>`; })() : ''}
    <div class="rb-group"><div class="rb-items">
      <a class="rb-btn" href="#picks"><svg class="ic"><use href="#i-target"/></svg><span>Picks</span></a>
      <a class="rb-btn" href="#tape"><svg class="ic"><use href="#i-chart"/></svg><span>Tape</span></a>
      <a class="rb-btn" href="#sentiment"><svg class="ic"><use href="#i-chat"/></svg><span>Social</span></a>
      <a class="rb-btn" href="#calendar"><svg class="ic"><use href="#i-cal"/></svg><span>Week</span></a>
      <a class="rb-btn" href="#sources"><svg class="ic"><use href="#i-doc"/></svg><span>Sources</span></a>
    </div><div class="rb-label">Jump to</div></div>`;
  }
  renderRibbon();

  // watchlist
  const filters = [['all', 'All'], ['pick', 'Picks'], ['ai', 'AI & chips'], ['mega', 'Mega-cap'], ['social', 'Trending']];
  let filt = 'all', q = '', sel = pickSyms[0];
  $('#chips').innerHTML = filters.map(([k, l]) => `<button class="chip" data-f="${k}" aria-pressed="${k === filt}">${l}</button>`).join('');
  $('#chips').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; filt = b.dataset.f; $('#chips').querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c === b)); renderWL(); };
  $('#q').oninput = e => { q = e.target.value.trim().toLowerCase(); renderWL(); };
  function renderWL() {
    const rows = D.watchlist.filter(w => (filt === 'all' || (filt === 'pick' ? pickSyms.includes(w.sym) : w.tags.includes(filt))) && (!q || w.sym.toLowerCase().includes(q) || w.name.toLowerCase().includes(q)));
    $('#wlCount').textContent = rows.length + ' symbols';
    $('#wl').innerHTML = rows.map(w => `<button class="wl-row" role="option" data-s="${w.sym}" aria-selected="${w.sym === sel}">
      <span class="wl-sym">${w.sym}${pickSyms.includes(w.sym) ? '<span class="badge pk">PICK</span>' : ''}${w.stale ? '<span class="badge stale">' + esc(w.stale) + '</span>' : ''}</span>
      <span class="wl-px">${w.px == null ? '—' : '$' + fmt(w.px)}</span>
      <span class="wl-name">${esc(w.name)}</span>
      <span class="wl-chg ${cls(w.pct)}">${w.pct == null ? 'n/a' : pct(w.pct)}${w.ah ? ` <span class="${cls(w.ahPct)}" title="After hours">· AH ${pct(w.ahPct)}</span>` : ''}</span>
    </button>`).join('') || '<div class="note" style="padding:1rem;text-align:center">No symbols match.</div>';
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
      <div><div class="insp-sym">${w.sym}</div><div class="sub">${esc(w.name)}</div></div>
      <div>
        <div class="insp-px">${w.px == null ? '—' : '$' + fmt(w.px)}</div>
        <div class="${cls(w.pct)}" style="font-family:var(--font-tech);font-weight:600">${w.pct == null ? (w.stale ? 'Last verified: ' + esc(w.stale) : 'Close not captured') : pct(w.pct) + ' on the day'}</div>
        ${w.ah ? `<div class="${cls(w.ahPct)}" style="font-family:var(--font-tech)">After hours $${fmt(w.ah)} · ${pct(w.ahPct)}</div>` : ''}
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
          ${D.indices.map(i => `<div class="stat"><div class="k">${esc(i.name)}</div><div class="v">${fmt(i.last)}</div><div class="${cls(i.pct)}" style="font-family:var(--font-tech);font-size:.88rem">${pct(i.pct)}</div></div>`).join('')}
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
            <span class="role">${esc(p.role)}</span>
          </div>
          <div class="pick-px"><span class="px">${w.px == null ? '—' : '$' + fmt(w.px)}</span>
            <span class="meta ${cls(w.pct)}">${w.pct == null ? (w.stale ? esc(w.stale) : '') : pct(w.pct)}</span>
            ${w.ah ? `<span class="meta ${cls(w.ahPct)}">AH $${fmt(w.ah)} (${pct(w.ahPct)})</span>` : ''}</div>
          <ul class="thesis">${p.thesis.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
          <div>${Object.entries(p.scores).map(([k, v]) => `<div class="score"><span class="lbl">${esc(k)}</span><span class="bar"><i style="width:${v * 10}%"></i></span><span class="n">${v}</span></div>`).join('')}</div>
          <div class="risk"><b>Risk</b><span class="riskpill ${p.risk}">${p.risk === 'high' ? 'HIGH' : 'MODERATE'}</span> ${esc(p.risks)}</div>
          <div class="srcs">${srcs(p.src)}</div>
        </article>`; }).join('')}
      </div>
      <div style="padding:0 1rem 1rem"><div class="disclaimer"><b>Not investment advice.</b> These are research ideas built from public reporting, not recommendations to buy or sell. They aren't tailored to your goals, timeline or risk tolerance. Single stocks can lose a lot of value quickly. Consider position sizing and diversification, and talk to a licensed advisor before investing money you can't afford to lose.</div></div>
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
      const r = await fetch('data/market.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const nd = await r.json();
      if (nd.snapshot !== D.snapshot) { D = nd; if (live.on) applyLive(); renderAll(); }
    } catch (e) { /* offline — keep showing what we have */ }
  }
  setInterval(refreshData, 120000);

  // Optional live mode: the viewer's own Finnhub key, kept only in this browser.
  const live = { on: false, key: '', timer: null, quotes: {}, err: '', at: '', busy: false, last: 0 };
  try { live.key = localStorage.getItem('pm-finnhub-key') || ''; } catch (e) {}
  function liveSymbols() {
    return [...new Set([...D.indices.map(i => i.sym), ...D.watchlist.map(w => w.sym)])].filter(s => /^[A-Z.]{1,6}$/.test(s));
  }
  function applyLive() {
    for (const w of D.watchlist) {
      const q = live.quotes[w.sym]; if (!q) continue;
      w.px = q.c; w.pct = q.dp; delete w.stale; delete w.ah; delete w.ahPct; w.src = 'finnhub-live';
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
    const syms = liveSymbols();
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
