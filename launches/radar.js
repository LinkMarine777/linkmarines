// NEW LAUNCHES: every stonkfun launch of the last 24 h, REAL or FARM, with its bundle scan and Jupiter's swap.
// Shown inside the trending page (the TRENDING | NEW LAUNCHES switch); /launches/ opens the same page on this view.
// Data: terminal/launches.json on the data branch, written by intel/launches.py every ~5 min.
// Everything here lives under #lr (and the coin's panel, #lr-dr): its own ids and classes, so it never meets trending's.
(() => {
const ROOT = document.getElementById('lr'); if (!ROOT || window.LR) return;
const SRC = ['https://raw.githubusercontent.com/LinkMarine777/linkmarines/data/terminal/launches.json', 'https://war-room-bot.linkmarine777.workers.dev/data/terminal/launches.json'];
const $ = id => document.getElementById('lr-' + id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const compact = n => n == null ? '—' : '$' + (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : Math.round(n));
const num = n => n == null ? '—' : Number(n).toLocaleString('en-US');
const ago = t => { const s = Date.now() / 1000 - t; return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };
const sy = s => '$' + esc(String(s ?? '').replace(/^\$+/, ''));   // tickers that already start with $ keep one
const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
// the site's own pages: relative on its domains, the live site's from anywhere else (a test copy)
const SITE = /(^|\.)(terminal7\.xyz|themarines\.link|workers\.dev)$|^localhost/.test(location.hostname) ? '' : 'https://terminal7.xyz';
const tok = m => SITE + '/terminal/token?ca=' + m;
const pic = u => u ? `<img src="${esc(u)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph0'}))">` : '<span class="ph0"></span>';
// VRFD's own pills: • Pending, ✓ Verified, Rejected, Needs info; ⚡ Express for the paid lane
const stPill = s => s === 'verified' ? '<span class="pill ok">✓ Verified</span>' : s === 'rejected' ? '<span class="pill no">Rejected</span>' : s === 'needs_info' ? '<span class="pill info">! Needs info</span>' : '<span class="pill wait">• Pending</span>';
const lanePill = l => l === 'express' ? '<span class="pill ex">⚡ Express</span>' : '';
const bundOf = r => Math.max(r.bpk || 0, (r.scan && r.scan.lk) || 0);

// the sorts, each with the way it usually reads (-1: biggest first; BUNDLED and AGE: least / newest first)
const SORTS = [['score', 'SCORE', -1], ['c', 'NEWEST', -1], ['bund', 'BUNDLED', 1], ['v', 'VOLUME', -1], ['fb', 'FEE-BACKED', -1],
  ['ob', 'ORG BUYERS', -1], ['h', 'HOLDERS', -1], ['mc', 'MC', -1], ['fees', 'FEES PAID', -1]];
const DIR = Object.fromEntries(SORTS.map(([k, , d]) => [k, d]));
let D = null, vf = 'REAL', sk = 'score', sd = -1, pq = null, hk = 'real', hd = -1;   // pq: the pair the launches are filtered to
try { vf = localStorage.getItem('lrTab') || 'REAL'; const s = JSON.parse(localStorage.getItem('lrSort') || 'null'); if (s && s[0] in DIR) [sk, sd] = s; } catch (e) {}

ROOT.innerHTML = `
  <section class="lr-hero">
    <div class="intro"><h1>Real or farm?</h1>
      <p>Every stonkfun launch of the last 24 h checked against the <b>fees it actually paid</b>, Jupiter's organic buyers, bundles, the dev's record and <b>who funded its top holders</b>. Tap a coin for its bundle scan.</p></div>
    <div><label>Launched 24h</label><b id="lr-kL">…</b><span class="lr-s" id="lr-kG"></span></div>
    <div><label>Real</label><b class="up" id="lr-kR">…</b><span class="lr-s">score 60+, not bundled</span></div>
    <div><label>Farms</label><b class="dn" id="lr-kF">…</b><span class="lr-s">volume the fees don't back</span></div>
    <div><label>Bundled</label><b class="am" id="lr-kB">…</b><span class="lr-s">20%+ in bundles or linked wallets</span></div>
  </section>
  <section class="lr-panel">
    <div class="lr-ph"><h2>LAUNCHES · LAST 24H</h2><span class="n" id="lr-nRows"></span>
      <div class="lr-tabs" id="lr-tabs">${['REAL', 'WATCH', 'FARM', 'BUNDLED', 'THIN', 'ALL'].map(v => `<button type="button" data-v="${v}">${v}</button>`).join('')}</div>
      <span id="lr-pf"></span><span class="hint">tap a coin for its bundle scan · <span id="lr-upd"></span></span></div>
    <div class="lr-sort" id="lr-sort"><span>SORT</span>${SORTS.map(([k, n]) => `<button type="button" data-k="${k}">${n}</button>`).join('')}</div>
    <div class="lr-tw"><table><thead><tr>
      <th class="l" data-k="score">SCORE</th><th class="l" data-k="s">COIN</th><th class="l" data-k="q">PAIR</th><th data-k="c">AGE</th>
      <th data-k="mc">MC</th><th data-k="v">24H VOL</th><th data-k="fees" title="priority fees + tips traders paid (Jupiter's Fees Paid), and per trade">FEES PAID</th>
      <th data-k="fb" title="what the coin paid its holders ÷ its tax rate, against the volume it reports: real trading lands near 1.0">FEE-BACKED</th>
      <th data-k="ob">ORG BUYERS</th><th data-k="h">HOLDERS</th><th data-k="bund" title="the bigger of bundlers' peak share (Jupiter) and holders linked by one private funder">BUNDLED</th>
      <th data-k="dg" title="the dev's other coins: 👑 graduated · launched (Jupiter)">DEV</th><th></th>
    </tr></thead><tbody id="lr-rows"><tr><td class="l dim" colspan="13">loading…</td></tr></tbody></table></div>
  </section>
  <section class="lr-panel">
    <div class="lr-ph"><h2>WHERE THE REAL LAUNCHES ARE · PAIRS</h2><span class="hint">tap a pair to see its launches</span></div>
    <div class="lr-tw"><table><thead><tr><th class="l">PAIR</th><th data-hk="n">LAUNCHES</th><th data-hk="v">24H VOL</th><th data-hk="real">REAL</th><th class="l">BEST LAUNCH</th></tr></thead>
      <tbody id="lr-hot"></tbody></table></div>
  </section>
  <section class="pipe">
    <div class="lr-panel"><div class="lr-ph"><h2>STONKFUN COINS IN JUPITER VRFD</h2><span class="hint">⚡ express = paid 1,000 JUP</span></div>
      <div class="list" id="lr-vrfd"><div class="empty">loading…</div></div></div>
    <div class="lr-panel"><div class="lr-ph"><h2>NEXT PAIRS · SUNRISE</h2><span class="hint" id="lr-sunHint"></span></div>
      <div class="list" id="lr-next"><div class="empty">loading…</div></div></div>
    <div class="lr-panel"><div class="lr-ph"><h2>NEW STONKFUN PAIRS</h2><span class="hint" id="lr-pairsN"></span></div>
      <div class="list" id="lr-pairs"><div class="empty">loading…</div></div></div>
  </section>
  <section class="lr-panel"><details class="how"><summary>HOW THE SCORE WORKS</summary>
    <p>Every launch of the last 24 h that trades ($2,500+ volume, or graduated) gets a score out of 100:</p>
    <ul>
      <li><b>Organic buyers (25)</b>: distinct wallets Jupiter counts as organic buyers in 24 h. Bots and wash wallets are filtered out.</li>
      <li><b>Fee-backed volume (20)</b>: what the coin paid its holders, divided by its tax rate, against the volume it reports. Every taxed trade pays, so real trading comes out near <code>1.0</code>. Washed volume comes out far below: farms measure 0.15–0.45.</li>
      <li><b>Bundles (15)</b>: the bigger of the bundlers' peak share of the supply (Jupiter) and <b>linked holders</b>: top-100 holders funded by one private wallet. An exchange (Binance, Coinbase, OKX, Bybit, MEXC) or any service that funds holders across many coins doesn't count as a link.</li>
      <li><b>Dev (15)</b>: the deployer's other coins, 👑 graduated out of launched (Jupiter). 1 in 5 graduated gives the full 15. A serial launcher (5+ coins, under 1 in 20 graduated) gets 0. A wallet with 2,000+ coins is a launch tool shared by many people, so it counts as neutral.</li>
      <li><b>Holders (10)</b>, <b>top 10 holders' share (5)</b>, <b>organic share of volume (5)</b>.</li>
      <li><b>Fees per trade (5)</b>: priority fees and tips traders paid per trade (Jupiter's Fees Paid). Farm bots pay to land their bundles: farms measured 2.3–5 mSOL a trade, real coins 0.7–2.7.</li>
    </ul>
    <p><span class="v-REAL">REAL</span> 60+ and not bundled (20%+ bundled or linked caps it at WATCH) · <span class="v-WATCH">WATCH</span> 35+ · <span class="v-FARM">FARM</span> $20,000+ volume the fees don't back up, with few organic buyers or holders · <span class="v-THIN">THIN</span> the rest.</p>
    <p>VRFD: Jupiter's verification desk. Standard requests are free. ⚡ Express costs 1,000 JUP and is reviewed first. Next pairs: stonkfun lists Sunrise's stocks as pairs, so a verified Sunrise stock with no pair for that stock yet (no xStock or PreStock of it) is the next one in line. Not financial advice: a score reads what already happened on chain.</p>
  </details></section>
  <div class="lr-foot">updated <span id="lr-upd2">…</span> · a pass every ~5 min · data: stonkfun, Jupiter, Jupiter VRFD</div>`;
// the coin's panel covers the whole page, so it lives on <body>
const DR = document.createElement('div'); DR.id = 'lr-dr'; DR.innerHTML = '<div class="box" id="lr-drBox"></div>'; document.body.appendChild(DR);

async function load() {
  for (const u of SRC) { try { const r = await fetch(u + '?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' }); if (!r.ok) continue; D = await r.json(); render(); return; } catch (e) {} }
  if (!D) $('rows').innerHTML = '<tr><td class="l dim" colspan="13">the radar hasn\'t written its first pass yet: back in a few minutes</td></tr>';
}
function render() {
  const s = D.stats || {}; $('kL').textContent = num(s.launches); $('kG').textContent = num(s.graduated) + ' graduated';
  $('kR').textContent = num(s.real); $('kF').textContent = num(s.farm); $('kB').textContent = num(s.bundled);
  const up = 'updated ' + ago(D.at) + ' ago' + (Date.now() / 1000 - D.at > 1200 ? ' (delayed)' : ''); $('upd').textContent = up; $('upd2').textContent = ago(D.at) + ' ago';
  // stonkfun coins in VRFD (rows like VRFD's own list)
  const V = D.vrfd || []; $('vrfd').innerHTML = V.length ? V.map(v => `<a class="it" href="https://verified.jup.ag/dashboard/${esc(v.m)}" target="_blank" rel="noopener">${pic(v.i)}
    <span class="lr-nm"><b>${sy(v.s)}</b><small>${esc(short(v.m))} · ${ago(v.t)} · MC ${compact(v.mc)}</small></span>
    <span class="pills">${stPill(v.st)}${lanePill(v.lane)}</span></a>`).join('') : '<div class="empty">no stonkfun coin has asked VRFD in the last 2 weeks</div>';
  // next pairs: Sunrise
  const SL = D.sunListed; $('sunHint').textContent = SL ? SL[0] + ' of ' + SL[1] + ' Sunrise stocks are pairs' : '';
  const N = D.next || []; $('next').innerHTML = N.length ? N.map(p => `<a class="it" href="https://jup.ag/tokens/${esc(p.m)}" target="_blank" rel="noopener">${pic(p.i)}
    <span class="lr-nm"><b>${sy(p.s)}</b><small>${esc(p.n)}${p.liq ? ' · liq ' + compact(p.liq) : ' · no market yet'}</small></span>
    <span class="pills">${p.ver ? stPill('verified') : p.st ? stPill(p.st) : ''}${lanePill(p.lane)}</span></a>`).join('') : '<div class="empty">every verified Sunrise stock has a pair (or an xStock / PreStock of it does). The next one pops here and as an alert.</div>';
  // new pairs
  const P = D.newPairs || []; $('pairsN').textContent = 'watching ' + num(D.pairs) + ' pairs';
  $('pairs').innerHTML = P.length ? P.map(p => `<a class="it" href="https://jup.ag/tokens/${esc(p.m)}" target="_blank" rel="noopener">${pic(p.i)}
    <span class="lr-nm"><b>${sy(p.s)}</b><span class="lr-tag">${esc(p.cat || '')}</span><small>${esc(p.n)}</small></span>
    <span class="lr-rt"><b>${ago(p.t)}</b>ago</span></a>`).join('') : '<div class="empty">no new pair since the radar started. The next one pops here and as an alert on every page.</div>';
  renderRows(); renderHot();
}
const cmp = (k, d) => (a, b) => { const x = a[k], y = b[k]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * d; };   // no value: last, either way
function renderHot() {
  const H = (D.hot || []).slice().sort(cmp(hk, hd));
  ROOT.querySelectorAll('th[data-hk]').forEach(t => { t.classList.toggle('on', t.dataset.hk === hk); t.classList.toggle('asc', t.dataset.hk === hk && hd > 0); });
  $('hot').innerHTML = H.map(h => `<tr data-q="${esc(h.qm)}" class="${h.qm === pq ? 'on' : ''}"><td class="l"><b style="color:#fff">${sy(h.q)}</b> <span class="lr-tag">${esc(h.qc || '')}</span>${h.new && Date.now() / 1000 - h.new < 7 * 86400 ? '<span class="lr-tag new">NEW PAIR</span>' : ''}</td>
    <td>${num(h.n)}</td><td>${compact(h.v)}</td><td class="${h.real ? 'up' : 'dim'}">${num(h.real)}</td><td class="l">${h.best ? `<a href="#" data-coin="${esc(h.best[2])}">${sy(h.best[0])}</a> <span class="dim">${h.best[1]}</span>` : '<span class="dim">—</span>'}</td></tr>`).join('');
}
function fbCell(r) {
  if (r.fb == null) return '<span class="dim" title="no holder payouts to check (standard mode)">—</span>';
  const c = r.fb >= 0.6 ? '' : r.fb >= 0.45 ? ' mid' : ' lo'; return `${r.fb.toFixed(2)}<span class="bar${c}"><s style="width:${Math.min(100, r.fb * 100)}%"></s></span>`;
}
const devCell = r => r.dn > 2000 ? `<span class="dim" title="a launch tool's wallet: ${num(r.dn)} coins">tool</span>` : r.dn ? `<span class="${r.dg / r.dn >= 0.2 ? 'up' : r.dn >= 5 && r.dg / r.dn < 0.05 ? 'dn' : ''}">👑 ${num(r.dg)}</span><small class="dim" style="display:block;font-size:10px">of ${num(r.dn)}</small>` : '<span class="dim">first coin</span>';
function renderRows() {
  let L = (D.launches || []).map(r => (r.bund = bundOf(r), r)).filter(r => (!pq || r.qm === pq) && (vf === 'ALL' || (vf === 'BUNDLED' ? r.flags && r.flags.includes('BUNDLED') : r.vd === vf)));
  const ph = pq && (D.hot || []).find(h => h.qm === pq);
  $('pf').innerHTML = pq ? `<span class="pfc">${ph ? sy(ph.q) : 'one'} pair<button type="button" title="all pairs" data-act="unpair">✕</button></span>` : '';
  ROOT.querySelectorAll('#lr-hot tr[data-q]').forEach(t => t.classList.toggle('on', t.dataset.q === pq));
  L = L.slice().sort(cmp(sk, sd));
  ROOT.querySelectorAll('#lr-tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === vf));
  ROOT.querySelectorAll('#lr-sort button, th[data-k]').forEach(t => { t.classList.toggle('on', t.dataset.k === sk); t.classList.toggle('asc', t.dataset.k === sk && sd > 0); });
  $('nRows').textContent = L.length;
  $('rows').innerHTML = L.length ? L.map(r => `<tr data-m="${esc(r.m)}">
    <td class="l"><span class="vd v-${r.vd}"><i>${r.score}</i>${r.vd}</span></td>
    <td class="l"><div class="coin">${pic(r.i)}<div><b>${sy(r.s)}</b>${r.st === 'graduated' ? '<span class="chip ok">GRAD</span>' : ''}${(r.flags || []).includes('BUNDLED') ? '<span class="chip bad">BUNDLED</span>' : ''}${r.vr ? `<span class="chip ${r.vr.st === 'verified' ? 'ok' : 'warn'}" title="Jupiter VRFD: ${esc(r.vr.st)} (${esc(r.vr.lane)} lane)">${r.vr.lane === 'express' ? '⚡ ' : ''}VRFD</span>` : ''}<small>${esc(r.n)}</small></div></div></td>
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
function setSort(k) { sd = sk === k ? -sd : (DIR[k] ?? (k === 's' || k === 'q' ? 1 : -1)); sk = k; try { localStorage.setItem('lrSort', JSON.stringify([sk, sd])); } catch (e) {} if (D) renderRows(); }

// the coin's Token Info (like jup.ag's) and its bundle scan: who funded the top 100 holders
function tile(v, label, bad) { return `<div class="tile"><b class="${bad == null ? '' : bad ? 'r' : 'g'}">${v}</b><span>${label}</span></div>`; }
function openCoin(m) {
  const r = (D.launches || []).find(x => x.m === m); if (!r) return; const sc = r.scan;
  const pc = v => v == null ? '—' : (+v).toFixed(2) + '%';
  let h = `<div class="top">${pic(r.i)}<div><b>${sy(r.s)}</b><small>${esc(r.n)} · ${sy(r.q)} pair · ${ago(r.c)} old</small></div><button class="x" type="button" data-act="close">✕</button></div>
    <div style="margin-top:10px"><span class="vd v-${r.vd}"><i>${r.score}</i>${r.vd}</span><button class="buyb" type="button" data-act="tobuy">BUY ↓</button></div>
    <h3>TOKEN INFO</h3><div class="tiles">
      ${tile(pc(r.top), 'Top 10 H.', r.top > 30)}${tile(sc ? pc(sc.sn) : '—', 'Snipers H.', sc ? sc.sn > 5 : null)}${tile(sc ? pc(sc.in) : '—', 'Insiders H.', sc ? sc.in > 5 : null)}
      ${tile(r.bpk + '%', 'Bundlers H. (peak)', r.bpk >= 10)}${tile(sc ? pc(sc.lk) : '—', 'Linked H.', sc ? sc.lk >= 10 : null)}${tile(r.bot + '%', 'Bot H.', null)}
      ${tile('◎' + (r.fees ?? '—'), 'Fees Paid', null)}${tile(r.os, 'Org Score', r.os < 30)}${tile(sc ? sc.fresh + ' / ' + sc.n : '—', 'Fresh wallets', sc ? sc.fresh / Math.max(sc.n, 1) > 0.3 : null)}
    </div>`;
  if (sc) {
    const tot = Object.values(sc.src).reduce((a, b) => a + b, 0) || 1, ind = k => k === 'independent' || k === 'own wallet';
    h += `<h3>WHO FUNDED THE TOP ${sc.n} HOLDERS</h3><div class="lr-src">${Object.entries(sc.src).map(([k, v]) => `<span>${esc(k === 'linked' ? 'linked (one private funder)' : ind(k) ? 'independent wallets' : k === 'unknown' ? 'no funding info' : k)}</span><i>${v}</i><div class="sbar ${k === 'linked' ? 'lk' : ind(k) || k === 'unknown' ? '' : 'ex'}"><s style="width:${v / tot * 100}%"></s></div>`).join('')}</div>`;
    h += sc.cl && sc.cl.length ? `<h3>LINKED CLUSTERS</h3>${sc.cl.map(c => `<div class="cl"><a href="${SITE}/wallet/${esc(c[0])}">${esc(short(c[0]))}</a><span>${c[1]} wallets</span><b class="${c[2] >= 10 ? 'dn' : ''}">${c[2]}%</b></div>`).join('')}<p class="dim" style="font-size:11px;margin-top:6px">holders first funded by the same wallet, which isn't an exchange or a service that funds wallets across many coins</p>` : '<h3>LINKED CLUSTERS</h3><p class="dim">none: no private wallet funded two of the top holders</p>';
  } else h += '<p class="dim" style="margin-top:12px">bundle scan pending: it runs on coins with $10K+ volume, a few each pass</p>';
  h += `<h3>BUY ${sy(r.s)}</h3>${beforeBuy(r)}<div id="lr-swap"><div class="ld">Loading Jupiter…</div></div>
    <div class="lr-acts"><a class="btn primary" href="${tok(r.m)}">OPEN IN TERMINAL</a><a class="btn" href="https://jup.ag/tokens/${esc(r.m)}" target="_blank" rel="noopener">OPEN ON JUPITER</a>${r.vr ? `<a class="btn" href="https://verified.jup.ag/dashboard/${esc(r.m)}" target="_blank" rel="noopener">VRFD</a>` : ''}</div>`;
  $('drBox').innerHTML = h; DR.classList.add('on'); swap(r.m);
}
// right above the swap: what the data says against this coin, so nobody buys it without seeing it (every swap still needs the wallet's approval: no quick buy)
function beforeBuy(r) {
  const sc = r.scan || {}, F = [], bund = bundOf(r);
  if (r.vd === 'FARM') F.push(['r', 'farm volume: its fees back only ' + (r.fb ?? '—') + ' of the volume it reports']);
  else if (r.fb != null && r.fb < 0.45) F.push(['a', 'fees back only ' + r.fb + ' of the reported volume']);
  if (bund >= 20) F.push(['r', bund.toFixed(1) + '% of the supply bundled or held by linked wallets']); else if (bund >= 10) F.push(['a', bund.toFixed(1) + '% bundled or linked']);
  if (sc.sn > 5) F.push(['a', 'snipers hold ' + sc.sn.toFixed(1) + '%']); if (sc.in > 5) F.push(['a', 'insiders hold ' + sc.in.toFixed(1) + '%']);
  if (r.top > 30) F.push(['a', 'top 10 holders hold ' + r.top + '%']);
  if (r.dn >= 5 && r.dn <= 2000 && r.dg / r.dn < 0.05) F.push(['r', 'serial launcher: ' + num(r.dg) + ' of ' + num(r.dn) + ' other coins graduated']);
  if (r.vr && r.vr.st === 'rejected') F.push(['r', 'Jupiter VRFD rejected its verification']);
  if (r.ob < 5) F.push(['a', 'only ' + num(r.ob) + ' organic buyers in 24 h']);
  return `<div class="bfb"><b>BEFORE YOU BUY</b><ul>${F.length ? F.map(([c, t]) => `<li class="${c}">${t}</li>`).join('') : '<li class="g">no red flags in the data above (not a guarantee)</li>'}</ul></div>`;
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
function setPair(q) { pq = q; if (D) renderRows(); if (q) $('tabs').closest('section').scrollIntoView({ behavior: 'smooth', block: 'start' }); }

DR.addEventListener('click', e => {
  if (e.target === DR) return closeCoin(); const a = e.target.closest('[data-act]'); if (!a) return;
  if (a.dataset.act === 'close') closeCoin(); else if (a.dataset.act === 'tobuy') $('swap').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
addEventListener('keydown', e => { if (e.key === 'Escape') closeCoin(); });
ROOT.addEventListener('click', e => {
  const act = e.target.closest('[data-act]');
  if (act) { e.preventDefault(); if (act.dataset.act === 'unpair') setPair(null); else if (act.dataset.act === 'all') { vf = 'ALL'; renderRows(); } return; }
  const coin = e.target.closest('[data-coin]'); if (coin) { e.preventDefault(); return openCoin(coin.dataset.coin); }
  const tab = e.target.closest('#lr-tabs button'); if (tab) { vf = tab.dataset.v; try { localStorage.setItem('lrTab', vf); } catch (x) {} if (D) renderRows(); return; }
  const so = e.target.closest('#lr-sort button, th[data-k]'); if (so) return setSort(so.dataset.k);
  const hs = e.target.closest('th[data-hk]'); if (hs) { const k = hs.dataset.hk; hd = hk === k ? -hd : -1; hk = k; if (D) renderHot(); return; }
  const pr = e.target.closest('#lr-hot tr[data-q]'); if (pr) return setPair(pr.dataset.q === pq ? null : pr.dataset.q);
  if (e.target.closest('a')) return;   // OPEN ↗ goes to the terminal; the rest of a row opens the coin's panel
  const tr = e.target.closest('#lr-rows tr[data-m]'); if (tr) openCoin(tr.dataset.m);
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
