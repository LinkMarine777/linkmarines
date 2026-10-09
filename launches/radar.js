// NEW LAUNCHES: every stonkfun launch of the last 24 h, REAL or FARM, with its bundle scan and Jupiter's swap.
// Shown inside the trending page (the TRENDING | NEW LAUNCHES switch); /launches/ opens the same page on this view.
// Data: terminal/launches.json on the data branch, written by intel/launches.py every ~5 min.
// Everything here lives under #lr (and the coin's panel, #lr-dr): its own ids and classes, so it never meets trending's.
(() => {
const ROOT = document.getElementById('lr'); if (!ROOT || window.LR || !window.LRS) return;
const { SITE, bundOf, short } = LRS;
const SRC = ['https://war-room-bot.linkmarine777.workers.dev/data/terminal/launches.json', 'https://raw.githubusercontent.com/LinkMarine777/linkmarines/data/terminal/launches.json'];
const $ = id => document.getElementById('lr-' + id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const compact = n => n == null ? '—' : '$' + (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : Math.round(n));
const num = n => n == null ? '—' : Number(n).toLocaleString('en-US');
const ago = t => { const s = Date.now() / 1000 - t; return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };
const sy = s => '$' + esc(String(s ?? '').replace(/^\$+/, ''));   // tickers that already start with $ keep one
const tok = m => SITE + '/terminal/token?ca=' + m;
const pic = u => u ? `<img src="${esc(u)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph0'}))">` : '<span class="ph0"></span>';
// VRFD's own pills: • Pending, ✓ Verified, Rejected, Needs info; ⚡ Express for the paid lane
const stPill = s => s === 'verified' ? '<span class="pill ok">✓ Verified</span>' : s === 'rejected' ? '<span class="pill no">Rejected</span>' : s === 'needs_info' ? '<span class="pill info">! Needs info</span>' : '<span class="pill wait">• Pending</span>';
const lanePill = l => l === 'express' ? '<span class="pill ex">⚡ Express</span>' : '';

// sorting: tap a column's label; first tap the way it usually reads (biggest first; BUNDLED least first, AGE newest first,
// COIN / PAIR A-Z), a second tap turns it around
const DIR = { score: -1, c: -1, bund: 1, v: -1, fb: -1, ob: -1, h: -1, mc: -1, fees: -1, dg: -1, s: 1 };
let D = null, vf = 'REAL', sk = 'score', sd = -1, pq = null, hk = 'real', hd = -1;   // pq: the pair the launches are filtered to
try { pq = new URLSearchParams(location.search).get('pair') || null; if (pq && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pq)) pq = null; } catch (e) {}
try { vf = localStorage.getItem('lrTab') || 'REAL'; const s = JSON.parse(localStorage.getItem('lrSort') || 'null'); if (s && s[0] in DIR) [sk, sd] = s; } catch (e) {}

ROOT.innerHTML = `
  <section class="lr-hero">
    <div class="intro"><h1>Real or farm?</h1>
      <p>Every stonkfun launch of the last 24 h checked against the <b>fees it actually paid</b>, Jupiter's organic buyers, bundles, the dev's record and <b>who funded its top holders</b>. Tap a coin for its terminal, TOKEN INFO ↗ for its bundle scan.</p></div>
    <div><label>Launched 24h</label><b id="lr-kL">…</b><span class="lr-s" id="lr-kG"></span></div>
    <div><label>Real</label><b class="up" id="lr-kR">…</b><span class="lr-s">score 60+, not bundled or dumped</span></div>
    <div><label>Farms</label><b class="dn" id="lr-kF">…</b><span class="lr-s">volume the fees don't back</span></div>
    <div><label>Bundled</label><b class="am" id="lr-kB">…</b><span class="lr-s">20%+ in bundles or linked wallets</span></div>
  </section>
  <section class="lr-panel">
    <div class="lr-ph"><h2>LAUNCHES · LAST 24H</h2><span class="n" id="lr-nRows"></span>
      <div class="lr-tabs" id="lr-tabs">${['REAL', 'WATCH', 'FARM', 'BUNDLED', 'THIN', 'ALL'].map(v => `<button type="button" data-v="${v}">${v}</button>`).join('')}</div>
      <span class="hint">tap a coin for its terminal · <span id="lr-upd"></span></span></div>
    <div class="lr-tw"><table><thead><tr>
      <th class="l" data-k="score">SCORE</th><th class="l" data-k="s">COIN</th><th class="l lr-pth" id="lr-pth" aria-haspopup="listbox" title="search every stonkfun pair and show its launches">PAIR<b id="lr-ppN"></b><span class="car">▾</span></th><th data-k="c">AGE</th>
      <th data-k="mc">MC</th><th data-k="v">24H VOL</th><th data-k="fees" title="priority fees + tips traders paid (Jupiter's Fees Paid), and per trade">FEES PAID</th>
      <th data-k="fb" title="what the coin paid its holders ÷ its tax rate, against the volume it reports: real trading lands near 1.0">FEE-BACKED</th>
      <th data-k="ob">ORG BUYERS</th><th data-k="h">HOLDERS</th><th data-k="bund" title="held now: the bigger of what bundlers hold (Jupiter's Bundlers H.) and holders linked by one private funder">BUNDLED</th>
      <th data-k="dg" title="the dev's other coins: 👑 graduated · launched (Jupiter)">DEV</th><th></th>
    </tr></thead><tbody id="lr-rows"><tr><td class="l dim" colspan="13">loading…</td></tr></tbody></table></div>
    <div class="lr-ppd" id="lr-ppD" hidden>
      <input id="lr-ppQ" type="search" autocomplete="off" placeholder="Search every stonkfun pair: symbol, name, category"><div class="lr-ppL" id="lr-ppL" role="listbox"></div></div>
  </section>
  <section class="lr-panel">
    <div class="lr-ph"><h2>WHERE THE REAL LAUNCHES ARE · PAIRS</h2><span class="hint">tap a pair to see its launches</span></div>
    <div class="lr-tw"><table><thead><tr><th class="l">PAIR</th><th data-hk="n">LAUNCHES</th><th data-hk="v">24H VOL</th><th data-hk="real">REAL</th><th class="l">BEST LAUNCH</th></tr></thead>
      <tbody id="lr-hot"></tbody></table></div>
  </section>
  <section class="pipe">
    <div class="lr-panel"><div class="lr-ph"><h2>STONKFUN COINS IN JUPITER VRFD</h2><span class="hint">⚡ express = paid 1,000 JUP</span></div>
      <div class="list" id="lr-vrfd"><div class="empty">loading…</div></div></div>
    <div class="lr-panel"><div class="lr-ph"><h2>NEXT PAIRS</h2><span class="hint" id="lr-sunHint"></span></div>
      <div class="list" id="lr-next"><div class="empty">loading…</div></div></div>
    <div class="lr-panel"><div class="lr-ph"><h2>NEW STONKFUN PAIRS</h2><span class="hint" id="lr-pairsN"></span></div>
      <div class="list" id="lr-pairs"><div class="empty">loading…</div></div></div>
  </section>
  <section class="lr-panel"><details class="how"><summary>HOW THE SCORE WORKS</summary>
    <p>Every launch of the last 24 h that trades ($2,500+ volume, or graduated) gets a score out of 100:</p>
    <ul>
      <li><b>Organic buyers (25)</b>: distinct wallets Jupiter counts as organic buyers in 24 h. Bots and wash wallets are filtered out.</li>
      <li><b>Fee-backed volume (20)</b>: what the coin paid its holders, divided by its tax rate, against the volume it reports. Every taxed trade pays, so real trading comes out near <code>1.0</code>. Washed volume comes out far below: farms measure 0.15–0.45.</li>
      <li><b>Bundles (15)</b>: what's held <b>now</b>, the bigger of the bundlers' share of the supply (Jupiter's Bundlers H.) and <b>linked holders</b>: top-100 holders funded by one private wallet. An exchange (Binance, Coinbase, OKX, Bybit, MEXC) or any service that funds holders across many coins doesn't count as a link.</li>
      <li><b>Dev (15)</b>: the deployer's other coins, 👑 graduated out of launched (Jupiter). 1 in 5 graduated gives the full 15. A serial launcher (5+ coins, under 1 in 20 graduated) gets 0. A wallet with 2,000+ coins is a launch tool shared by many people, so it counts as neutral.</li>
      <li><b>Holders (10)</b>, <b>top 10 holders' share (5)</b>, <b>organic share of volume (5)</b>.</li>
      <li><b>The price (−40 to +5)</b>: how far it fell from its peak and <b>how fast</b>: up to −30, nothing until 40% off, all of it at 90% off; losing half within an hour of the peak counts in full, a fade over 12 h or more 60%. <b>Pump and dump (−10)</b>: peaked within an hour of launch and lost half within the next hour, ending 70%+ down. <b>Steady (+5)</b>: climbed over hours without ever losing half of its peak. <b>Sold bundles (−10)</b>: bundlers held 10%+ at their peak and have sold most of it, into the pump.</li>
      <li><b>Fees per trade (5)</b>: priority fees and tips traders paid per trade (Jupiter's Fees Paid). Farm bots pay to land their bundles: farms measured 2.3–5 mSOL a trade, real coins 0.7–2.7.</li>
    </ul>
    <p><span class="v-REAL">REAL</span> 60+, not bundled (20%+ bundled or linked caps it at WATCH) and not dumped (85%+ below a $20K+ peak, tagged DUMPED, caps it too) · <span class="v-WATCH">WATCH</span> 35+ · <span class="v-FARM">FARM</span> $20,000+ volume the fees don't back up, with few organic buyers or holders · <span class="v-THIN">THIN</span> the rest.</p>
    <p>VRFD: Jupiter's verification desk. Standard requests are free. ⚡ Express costs 1,000 JUP and is reviewed first. Next pairs: the stock issuers stonkfun pairs with (Sunrise, xStocks, PreStocks, Tessera) and their verified stocks that no stonkfun pair trades yet, in any wrapper. xStocks only when one trades, is new or went to VRFD: stonkfun pairs only its busiest. A new stock and a Sunrise VRFD request each pop an alert. Not financial advice: a score reads what already happened on chain.</p>
  </details></section>
  <div class="lr-foot">updated <span id="lr-upd2">…</span> · a pass every ~5 min · data: stonkfun, Jupiter, Jupiter VRFD</div>`;
// the coin's panel covers the whole page, so it lives on <body>
const DR = document.createElement('div'); DR.id = 'lr-dr'; DR.innerHTML = '<div class="box" id="lr-drBox"></div>'; document.body.appendChild(DR);

async function load() {
  for (const u of SRC) { try { const r = await fetch(u + '?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' }); if (!r.ok) continue; D = await r.json(); window.LRS_CEX = D.cex; window.LRS_SVC = D.svc; render(); return; } catch (e) {} }
  if (!D) $('rows').innerHTML = '<tr><td class="l dim" colspan="13">the radar hasn\'t written its first pass yet: back in a few minutes</td></tr>';
}
function render() {
  const s = D.stats || {}; $('kL').textContent = num(s.launches); $('kG').textContent = num(s.graduated) + ' graduated';
  $('kR').textContent = num(s.real); $('kF').textContent = num(s.farm); $('kB').textContent = num(s.bundled);
  const up = 'updated ' + ago(D.at) + ' ago' + (Date.now() / 1000 - D.at > 1200 ? ' (delayed)' : ''); $('upd').textContent = up; $('upd2').textContent = ago(D.at) + ' ago';
  // stonkfun coins in VRFD (rows like VRFD's own list)
  // a row opens the coin's terminal; VRFD ↗ its request on Jupiter's verification dashboard
  const V = D.vrfd || []; $('vrfd').innerHTML = V.length ? V.map(v => `<div class="it go" data-go="${tok(v.m)}">${pic(v.i)}
    <span class="lr-nm"><a href="${tok(v.m)}"><b>${sy(v.s)}</b></a><small>${esc(short(v.m))} · ${ago(v.t)} · MC ${compact(v.mc)}</small></span>
    <span class="pills">${stPill(v.st)}${lanePill(v.lane)}<a class="vdl" href="https://verified.jup.ag/dashboard/${esc(v.m)}" target="_blank" rel="noopener" title="its request on Jupiter's verification dashboard">VRFD ↗</a></span></div>`).join('') : '<div class="empty">no stonkfun coin has asked VRFD in the last 2 weeks</div>';
  // next pairs: the stocks of every issuer stonkfun pairs with (Sunrise, xStock, PreStock, Tessera) that no pair trades yet
  const IL = D.issListed || (D.sunListed ? { Sunrise: D.sunListed } : null);
  $('sunHint').textContent = IL ? Object.entries(IL).map(([k, v]) => k + ' ' + v[0] + '/' + v[1]).join(' · ') + ' paired' : '';
  $('sunHint').title = 'stonkfun pairs out of each issuer\'s verified stocks';
  const N = D.next || []; $('next').innerHTML = N.length ? N.map(p => `<div class="it go" data-go="${tok(p.m)}">${pic(p.i)}
    <span class="lr-nm"><a href="${tok(p.m)}"><b>${sy(p.s)}</b></a><span class="lr-tag">${esc(p.iss || 'Sunrise')}</span>${p.new ? '<span class="lr-tag new">NEW</span>' : ''}<small>${esc(p.n)}${p.v ? ' · vol ' + compact(p.v) : ''}${p.liq ? ' · liq ' + compact(p.liq) : ' · no market yet'}</small></span>
    <span class="pills">${p.ver ? stPill('verified') : p.st ? stPill(p.st) : ''}${lanePill(p.lane)}</span></div>`).join('') : '<div class="empty">every stock these issuers put on chain has a stonkfun pair. The next one pops here and as an alert.</div>';
  // new pairs
  const P = D.newPairs || []; $('pairsN').textContent = 'watching ' + num(D.pairs) + ' pairs';
  $('pairs').innerHTML = P.length ? P.map(p => `<div class="it go" data-go="${tok(p.m)}">${pic(p.i)}
    <span class="lr-nm"><a href="${tok(p.m)}"><b>${sy(p.s)}</b></a><span class="lr-tag">${esc(p.cat || '')}</span><small>${esc(p.n)} · added ${ago(p.t)} ago</small></span>
    <button type="button" class="lr-lb" data-pair="${esc(p.m)}" title="its launches in the table above">LAUNCHES ↓</button></div>`).join('') : '<div class="empty">no new pair since the radar started. The next one pops here and as an alert on every page.</div>';
  renderRows(); renderHot();
}
const cmp = (k, d) => (a, b) => { const x = a[k], y = b[k]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * d; };   // no value: last, either way
function renderHot() {
  const H = (D.hot || []).slice().sort(cmp(hk, hd));
  ROOT.querySelectorAll('th[data-hk]').forEach(t => { t.classList.toggle('on', t.dataset.hk === hk); t.classList.toggle('asc', t.dataset.hk === hk && hd > 0); });
  $('hot').innerHTML = H.map(h => `<tr data-q="${esc(h.qm)}" class="${h.qm === pq ? 'on' : ''}"><td class="l"><b style="color:#fff">${sy(h.q)}</b> <span class="lr-tag">${esc(h.qc || '')}</span>${h.new && Date.now() / 1000 - h.new < 7 * 86400 ? '<span class="lr-tag new">NEW PAIR</span>' : ''}</td>
    <td>${num(h.n)}</td><td>${compact(h.v)}</td><td class="${h.real ? 'up' : 'dim'}">${num(h.real)}</td><td class="l">${h.best ? `<a href="${tok(h.best[2])}">${sy(h.best[0])}</a> <span class="dim">${h.best[1]}</span>` : '<span class="dim">—</span>'}</td></tr>`).join('');
}
function fbCell(r) {
  if (r.fb == null) return '<span class="dim" title="no holder payouts to check (standard mode)">—</span>';
  const c = r.fb >= 0.6 ? '' : r.fb >= 0.45 ? ' mid' : ' lo'; return `${r.fb.toFixed(2)}<span class="bar${c}"><s style="width:${Math.min(100, r.fb * 100)}%"></s></span>`;
}
const devCell = r => r.dn > 2000 ? `<span class="dim" title="a launch tool's wallet: ${num(r.dn)} coins">tool</span>` : r.dn ? `<span class="${r.dg / r.dn >= 0.2 ? 'up' : r.dn >= 5 && r.dg / r.dn < 0.05 ? 'dn' : ''}">👑 ${num(r.dg)}</span><small class="dim" style="display:block;font-size:10px">of ${num(r.dn)}</small>` : '<span class="dim">first coin</span>';
function renderRows() {
  let L = (D.launches || []).map(r => (r.bund = bundOf(r), r)).filter(r => (!pq || r.qm === pq) && (vf === 'ALL' || (vf === 'BUNDLED' ? r.flags && r.flags.includes('BUNDLED') : r.vd === vf)));
  const ph = pq && (D.hot || []).find(h => h.qm === pq);
  $('ppN').textContent = pq ? ' ' + pairName(pq, ph) : ''; $('pth').classList.toggle('pick', !!pq);
  ROOT.querySelectorAll('#lr-hot tr[data-q]').forEach(t => t.classList.toggle('on', t.dataset.q === pq));
  L = L.slice().sort(cmp(sk, sd));
  ROOT.querySelectorAll('#lr-tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === vf));
  ROOT.querySelectorAll('th[data-k]').forEach(t => { t.classList.toggle('on', t.dataset.k === sk); t.classList.toggle('asc', t.dataset.k === sk && sd > 0); });
  $('nRows').textContent = L.length;
  $('rows').innerHTML = L.length ? L.map(r => `<tr data-m="${esc(r.m)}">
    <td class="l"><span class="vd v-${r.vd}"><i>${r.score}</i>${r.vd}</span></td>
    <td class="l"><div class="coin">${pic(r.i)}<div><b>${sy(r.s)}</b><button type="button" class="infob" data-coin="${esc(r.m)}" title="its score, bundle scan and who funded its holders, without leaving the page">TOKEN INFO ↗</button>${r.st === 'graduated' ? '<span class="chip ok">GRAD</span>' : ''}${(r.flags || []).includes('BUNDLED') ? '<span class="chip bad">BUNDLED</span>' : ''}${(r.flags || []).includes('PUMP & DUMP') ? `<span class="chip bad" title="peaked ${r.pa ? r.pa.up : '?'} min after launch, lost half within ${r.pa ? r.pa.half : '?'} min">PUMP &amp; DUMP</span>` : (r.flags || []).includes('DUMPED') ? `<span class="chip bad" title="down ${Math.round((r.pa ? r.pa.dd : 1 - r.mc / r.pk) * 100)}% from its peak">DUMPED</span>` : ''}${r.vr && r.vr.st === 'verified' ? `<span class="chip ok" title="Verified on Jupiter VRFD (${esc(r.vr.lane)} lane)">${r.vr.lane === 'express' ? '⚡ ' : ''}VRFD</span>` : ''}<small>${esc(r.n)}</small></div></div></td>
    <td class="l">${sy(r.q)}${r.qc ? `<span class="lr-tag">${esc(r.qc)}</span>` : ''}</td>
    <td class="dim">${ago(r.c)}</td>
    <td>${compact(r.mc)}<small class="dim" style="display:block;font-size:10px">peak ${compact(r.pk)}</small></td>
    <td>${compact(r.v)}</td>
    <td>${r.fees != null ? `<span class="sol">◎${r.fees}</span><small class="dim" style="display:block;font-size:10px">${r.fpt != null ? r.fpt + ' mSOL/trade' : ''}</small>` : '<span class="dim">—</span>'}</td>
    <td>${fbCell(r)}</td>
    <td class="${r.ob >= 40 ? 'up' : r.ob < 5 ? 'dn' : ''}">${num(r.ob)}</td>
    <td>${num(r.h)}</td>
    <td class="${r.bund >= 20 ? 'dn' : r.bund >= 10 ? 'am' : ''}">${r.bund ? r.bund.toFixed(1) + '%' : '0%'}<small class="dim" style="display:block;font-size:10px">${r.bn ? r.bn + ' bundles' : ''}${r.scan && r.scan.cl && r.scan.cl.length ? (r.bn ? ' · ' : '') + r.scan.cl.length + ' linked' : ''}</small></td>
    <td>${devCell(r)}</td>
    <td><a class="openb" href="${tok(r.m)}" title="open ${sy(r.s)} in the terminal">OPEN ↗</a></td>
  </tr>`).join('') : `<tr><td class="l dim" colspan="13">no ${vf} launches${pq ? ' on this pair' : ''} right now${pq && vf !== 'ALL' ? ' · <a href="#" data-act="all">see ALL</a>' : ''}</td></tr>`;
}
function setSort(k) { sd = sk === k ? -sd : (DIR[k] ?? -1); sk = k; try { localStorage.setItem('lrSort', JSON.stringify([sk, sd])); } catch (e) {} if (D) renderRows(); }

// the coin's panel: Token Info (like jup.ag's), who funded its top 100 holders, BEFORE YOU BUY, Jupiter's swap
function openCoin(m) {
  const r = (D.launches || []).find(x => x.m === m); if (!r) return;
  let h = `<div class="top">${pic(r.i)}<div><b>${sy(r.s)}</b><small>${esc(r.n)} · ${sy(r.q)} pair · ${ago(r.c)} old</small></div><button class="x" type="button" data-act="close">✕</button></div>
    <div class="lrscan"><div style="margin-top:10px">${LRS.vd(r)}<button class="buyb" type="button" data-act="tobuy">BUY ↓</button></div>
    <h3>TOKEN INFO</h3>${LRS.tiles(r)}${LRS.funding(r)}
    <h3>BUY ${sy(r.s)}</h3>${LRS.beforeBuy(r)}</div><div id="lr-swap"><div class="ld">Loading Jupiter…</div></div>
    <div class="lr-acts"><a class="btn primary" href="${tok(r.m)}">OPEN IN TERMINAL</a><a class="btn" href="https://jup.ag/tokens/${esc(r.m)}" target="_blank" rel="noopener">OPEN ON JUPITER</a>${r.vr ? `<a class="btn" href="https://verified.jup.ag/dashboard/${esc(r.m)}" target="_blank" rel="noopener">VRFD</a>` : ''}</div>`;
  $('drBox').innerHTML = h; DR.classList.add('on'); swap(r.m);
}
// ---------- BUY: Jupiter's swap widget in the panel, locked to the coin, SOL in (the same widget as the terminal's) ----------
const SOL_MINT = 'So11111111111111111111111111111111111111112';
function swap(m) {
  const go = () => { try { const box = $('swap'); if (!box) return; box.innerHTML = ''; window.Jupiter.init({ displayMode: 'integrated', integratedTargetId: 'lr-swap', formProps: { initialInputMint: SOL_MINT, initialOutputMint: m, fixedMint: m } }); styleSwap(); } catch (e) { fail(); } },
    fail = () => { const b = $('swap'); if (b) b.innerHTML = `<div class="ld">Jupiter's swap didn't load. <a href="https://jup.ag/tokens/${esc(m)}" target="_blank" rel="noopener">Buy on jup.ag ↗</a></div>`; };
  if (window.Jupiter) return go();
  if (swap.loading) return swap.loading.push(go); swap.loading = [go];
  const sc = document.createElement('script'); sc.src = 'https://plugin.jup.ag/plugin-v1.js'; sc.onerror = () => { swap.loading = null; fail(); };
  sc.onload = () => { const q = swap.loading; swap.loading = null; q[q.length - 1](); }; document.head.appendChild(sc);   // the latest coin opened wins
}
// Jupiter draws a fixed 360×550 card in its own shadow DOM: let it fill the panel's width and shrink to its content (as on the token page)
const SW_CSS = `.max-w-\\[360px\\]{max-width:none!important;background:transparent!important;border-radius:0!important}
  .h-\\[550px\\]{height:auto!important;min-height:330px}
  .h-\\[550px\\]:has(input[placeholder='Search']){height:550px!important}
  #jupiter-plugin .rounded-xl,#jupiter-plugin .rounded-lg,#jupiter-plugin .rounded-2xl{border-radius:2px!important}`;
function styleSwap(n = 0) {
  const h = [...document.querySelectorAll('#lr-swap *')].find(e => e.shadowRoot);
  if (!h || !h.shadowRoot.getElementById('jupiter-plugin')) { if (n < 100) setTimeout(() => styleSwap(n + 1), 100); return; }
  if (h.shadowRoot.getElementById('swCss')) return;
  const st = document.createElement('style'); st.id = 'swCss'; st.textContent = SW_CSS; h.shadowRoot.appendChild(st);
}
function closeCoin() { DR.classList.remove('on'); }
// a pair: the launches show just its coins (the pair is many coins), scrolled into view; its best launch opens that coin's panel
function setPair(q, scroll = true) {
  pq = q; closePP(); if (D) { renderRows(); renderHot(); }
  try { const u = new URL(location.href); q ? u.searchParams.set('pair', q) : u.searchParams.delete('pair'); history.replaceState(history.state, '', u); } catch (e) {}   // a link to this pair's launches
  if (q && scroll) $('tabs').closest('section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// the pair picker: every stonkfun pair (its public list, all categories), searched by symbol, name, category or mint; the
// ones with launches in the last 24 h first
const SF = 'https://www.stonkfun.xyz';
let PL = null;
async function pairs() {
  if (PL) return PL;
  try { const d = await fetch(SF + '/api/public/v1/pairs').then(r => r.json());
    PL = d.data.pairs.map(p => ({ m: p.mint, s: p.symbol, n: p.name, c: p.categoryLabel || p.category || '', i: p.logoUrl ? (/^https?:/.test(p.logoUrl) ? p.logoUrl : SF + p.logoUrl) : null })); }
  catch (e) { PL = (D && D.hot || []).map(h => ({ m: h.qm, s: h.q, n: '', c: h.qc || '', i: null })); }   // stonkfun's list didn't load: the pairs with launches
  return PL;
}
function pairName(m, ph) { const p = (PL || []).find(x => x.m === m); return p ? sy(p.s).replace(/&amp;/g, '&') : ph ? '$' + String(ph.q).replace(/^\$+/, '') : short(m); }
function renderPP() {
  const q = $('ppQ').value.trim().toLowerCase(), cnt = {};
  (D && D.launches || []).forEach(r => { cnt[r.qm] = (cnt[r.qm] || 0) + 1; });
  const L = (PL || []).filter(p => !q || [p.s, p.n, p.c, p.m].some(v => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => (cnt[b.m] || 0) - (cnt[a.m] || 0) || String(a.s).localeCompare(String(b.s)));
  const show = L.slice(0, 120);
  $('ppL').innerHTML = (q ? '' : `<button type="button" class="it pp${pq ? '' : ' on'}" data-pp=""><span class="ph0"></span><span class="lr-nm"><b>All pairs</b><small>${num(PL ? PL.length : 0)} pairs</small></span><span></span></button>`)
    + show.map(p => `<button type="button" class="it pp${p.m === pq ? ' on' : ''}" data-pp="${esc(p.m)}" role="option">${pic(p.i)}<span class="lr-nm"><b>${sy(p.s)}</b>${p.c ? `<span class="lr-tag">${esc(p.c)}</span>` : ''}<small>${esc(p.n)}</small></span><span class="lr-ct${cnt[p.m] ? '' : ' dim'}">${cnt[p.m] ? num(cnt[p.m]) + ' launch' + (cnt[p.m] === 1 ? '' : 'es') : '—'}</span></button>`).join('')
    + (L.length > show.length ? `<div class="empty">${num(L.length - show.length)} more: type to narrow it down</div>` : '') + (L.length ? '' : '<div class="empty">no pair matches</div>');
}
async function openPP() {
  const th = $('pth'), pn = th.closest('.lr-panel'), a = th.getBoundingClientRect(), b = pn.getBoundingClientRect(), d = $('ppD');
  d.style.left = Math.max(8, Math.min(a.left - b.left, b.width - Math.min(380, b.width - 16) - 8)) + 'px'; d.style.top = (a.bottom - b.top + 4) + 'px';
  d.hidden = false; th.setAttribute('aria-expanded', 'true'); $('ppL').innerHTML = '<div class="empty">loading pairs…</div>'; await pairs(); renderPP(); $('ppQ').focus(); }
function closePP() { const d = $('ppD'); if (d && !d.hidden) { d.hidden = true; $('pth').setAttribute('aria-expanded', 'false'); $('ppQ').value = ''; } }

DR.addEventListener('click', e => {
  if (e.target === DR) return closeCoin(); const a = e.target.closest('[data-act]'); if (!a) return;
  if (a.dataset.act === 'close') closeCoin(); else if (a.dataset.act === 'tobuy') $('swap').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
addEventListener('keydown', e => { if (e.key === 'Escape') { closePP(); closeCoin(); } });
document.addEventListener('click', e => { if (!e.target.closest('#lr-ppD,#lr-pth')) closePP(); });
$('ppQ').addEventListener('input', renderPP);
$('ppQ').addEventListener('keydown', e => { if (e.key === 'Enter') { const f = $('ppL').querySelector('[data-pp]:not([data-pp=""])'); if (f) setPair(f.dataset.pp, false); } });
if (pq) pairs().then(() => { if (D) renderRows(); });   // a ?pair= link: its name in the picker
ROOT.addEventListener('click', e => {
  const act = e.target.closest('[data-act]');
  if (act) { e.preventDefault(); if (act.dataset.act === 'unpair') setPair(null); else if (act.dataset.act === 'all') { vf = 'ALL'; renderRows(); } return; }
  if (e.target.closest('#lr-pth')) return $('ppD').hidden ? openPP() : closePP();
  const pp = e.target.closest('[data-pp]'); if (pp) return setPair(pp.dataset.pp || null, false);
  if (e.target.closest('#lr-ppD')) return;
  const lb = e.target.closest('[data-pair]'); if (lb) return setPair(lb.dataset.pair);
  const coin = e.target.closest('[data-coin]'); if (coin) { e.preventDefault(); return openCoin(coin.dataset.coin); }
  const tab = e.target.closest('#lr-tabs button'); if (tab) { vf = tab.dataset.v; try { localStorage.setItem('lrTab', vf); } catch (x) {} if (D) renderRows(); return; }
  const so = e.target.closest('th[data-k]'); if (so) return setSort(so.dataset.k);
  const hs = e.target.closest('th[data-hk]'); if (hs) { const k = hs.dataset.hk; hd = hk === k ? -hd : -1; hk = k; if (D) renderHot(); return; }
  const pr = e.target.closest('#lr-hot tr[data-q]'); if (pr) return setPair(pr.dataset.q === pq ? null : pr.dataset.q);
  if (e.target.closest('a')) return;
  const go = e.target.closest('[data-go]'); if (go) { if (e.metaKey || e.ctrlKey) open(go.dataset.go, '_blank', 'noopener'); else location.href = go.dataset.go; return; }
  // a coin's row opens its terminal (like OPEN ↗; ⌘ / ctrl-click: a new tab); MORE INFO opens its panel here
  const tr = e.target.closest('#lr-rows tr[data-m]');
  if (tr) { const u = tok(tr.dataset.m); if (e.metaKey || e.ctrlKey) open(u, '_blank', 'noopener'); else location.href = u; }
});

// the data: read a few seconds after the trending page opens, so the first switch to this view is instant; then fresh
// every minute while the view is showing (and on every switch to it, if it's a minute old)
let at = 0; const fresh = () => { at = Date.now(); return load(); };
const LR = window.LR = {
  shown: false,
  show() { this.shown = true; if (D) render(); if (Date.now() - at > 60e3) fresh(); },
  hide() { this.shown = false; closeCoin(); },
};
setInterval(() => { if (LR.shown && !document.hidden) fresh(); }, 60e3);
if (!ROOT.hidden) LR.show(); else setTimeout(() => { if (!at) fresh(); }, 3000);
})();
