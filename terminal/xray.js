// Wallet X-Ray: one wallet across stonkfun (the bot's /wallet: coins held now + per-coin rewards, trades, P&L, score) and its
// share card. Shared by the token page's wallet window and the full page at /wallet/<address> (terminal/wallet.html).
// Xray.mount(box, {page}) draws the shell into box; Xray.open(w) loads a wallet. Also the who's who lookups (Xray.KOL / kolGet),
// which the token page's holder list and tape use too.
(() => {
  const BOT = 'https://war-room-bot.linkmarine777.workers.dev';
  const WRE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const j = async u => { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return r.json(); };
  const compact = n => { const a = Math.abs(n); return '$' + (a >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : (n / 1e3).toFixed(1) + 'K'); };
  const usd = n => (n < 0 ? '−' : '') + (Math.abs(n) >= 1000 ? compact(Math.abs(n)) : '$' + Math.round(Math.abs(n)));
  const TAGC = { Compounder: 'var(--green)', Partial: 'var(--blue2)', Collector: 'var(--dim)', Trader: 'var(--amber)', Seller: 'var(--red)' };
  const link = w => 'https://terminal7.xyz/wallet/' + w;   // the wallet's own page: what COPY LINK and the tweet share

  // who's who: wallets KOLlector (dethective.com/kollector) ties to known traders, through the bot (kept a week there)
  const KOL = {};
  async function kolGet(ws) {
    const need = ws.filter(w => !(w in KOL)).slice(0, 25);
    if (need.length) try { const d = await j(BOT + '/kol?w=' + need.join(',')), p = new Set(d && d._p || []); need.forEach(w => { if (!p.has(w)) KOL[w] = d && d[w] || null; }); } catch (e) {}   // (_p: not looked up yet, asked again later)
    return ws.filter(w => KOL[w]);
  }
  const kolUrl = k => k.x ? 'https://x.com/' + encodeURIComponent(k.x) : k.p ? 'https://pump.fun/profile/' + encodeURIComponent(k.p) : 'https://dethective.com/kollector/';
  const kolFol = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);

  const CSS = `
.xr .wk{font-size:10px;letter-spacing:2px;color:var(--dim)}
.xr{min-width:0;overflow-wrap:anywhere}.xr h3{font-family:'VT323';font-weight:400;font-size:34px;color:#fff;margin:0;line-height:1}
.xr .wl{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;font-size:11px;margin-top:2px}.xr .wl a{color:var(--blue2)}
#walKpi{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:14px 0 4px}
#walKpi>div{background:var(--panel);border:1px solid var(--line);padding:9px 10px;min-width:0}
#walKpi b{display:block;font-family:'VT323';font-weight:400;font-size:30px;line-height:1;color:#fff}
#walKpi span{display:block;font-size:9.5px;letter-spacing:1px;color:var(--dim);margin-top:3px}#walKpi i{display:block;font-style:normal;font-size:10px;color:var(--txt);margin-top:3px;cursor:help}
.xr .sec{font-size:10.5px;letter-spacing:2px;color:#fff;margin:16px 0 6px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.xr .sec .dim{letter-spacing:0;font-size:10px}
.xr table{width:100%;border-collapse:collapse;font-size:12px}
.xr td,.xr th{padding:6px 5px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
.xr th{font-size:9.5px;letter-spacing:1px;color:var(--dim);font-weight:400}
.xr th[data-k]{cursor:pointer;user-select:none}.xr th[data-k]:hover,.xr th.on{color:#fff}
.xr .r{text-align:right}
.xr td a{color:#fff;text-decoration:none;display:inline-flex;align-items:center;gap:6px}.xr td a:hover{color:var(--blue2)}
.xr td img{width:18px;height:18px;border-radius:50%;object-fit:cover;background:var(--line)}
.xr .wsc{display:inline-block;min-width:30px;text-align:center;border:1px solid;padding:0 4px;font-family:'VT323';font-size:18px}
.xr .wtw{overflow-x:auto}.xr .wsy{max-width:120px;overflow:hidden;text-overflow:ellipsis}
.xr .wtg{display:inline-block;width:84px;text-align:left;font-size:9px;letter-spacing:1px;margin-left:6px;vertical-align:middle}.xr .wsc{vertical-align:middle}.xr .whd{font-size:8.5px;letter-spacing:1px;margin:1px 0 0 24px}.xr .wam{font-size:9.5px;color:var(--dim);margin-top:1px}
.xr tr.wcr{cursor:pointer}.xr tr.wcr:hover td{background:rgba(42,90,218,.06)}
.xr .wsum{font-size:10.5px;color:var(--dim);margin:2px 0 6px;white-space:normal;line-height:1.5}.xr .wsum b{color:var(--txt);font-weight:500}
.xr .wtl{display:grid;gap:1px;background:var(--line);border:1px solid var(--line);max-height:220px;overflow-y:auto}
.xr .wtl a{display:grid;grid-template-columns:70px 44px 1fr 1fr;gap:8px;padding:5px 8px;background:#0b1122;font-size:11px;color:var(--txt)}.xr .wtl a:hover{background:#141f36}.xr .wtl a span:last-child{text-align:right}
.xr .wctl{display:flex;flex-direction:column;gap:5px;margin-bottom:6px}
.xr .wchips{display:flex;gap:4px;flex-wrap:wrap;align-items:center}
.xr .wchips button{font:inherit;font-size:10px;letter-spacing:1px;padding:3px 7px;background:#050914;border:1px solid var(--line);color:var(--dim);cursor:pointer}
.xr .wchips button:hover{color:#fff;border-color:var(--blue2)}.xr .wchips button.on{color:#fff;border-color:var(--blue2);background:rgba(74,122,255,.16)}
.xr .wchips button i{font-style:normal;opacity:.7;margin-left:4px}
#walCard{display:block;width:100%;aspect-ratio:1200/630;border:1px solid var(--line);background:var(--panel)}
.xr .acts{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:6px;margin-top:8px}.xr .acts .btn{text-align:center;text-decoration:none;font-size:11.5px;letter-spacing:1px;padding:9px 4px;white-space:nowrap}
.xr .foot{font-size:10px;color:var(--dim);margin-top:10px;line-height:1.5}
@media (max-width:560px){#walKpi{grid-template-columns:repeat(2,1fr)}.xr .acts{grid-template-columns:1fr 1fr}.xr .wtg{display:none}.xr .wtl a{grid-template-columns:52px 38px 1fr 1fr;gap:6px}.xr .hs2{display:none}.xr table{font-size:11px}.xr td,.xr th{padding:6px 3px}.xr .wsy{max-width:76px}.xr .whd{margin-left:0;white-space:normal;max-width:110px}.xr td img{width:16px;height:16px}.xr td a{gap:4px}}`;

  const SHELL = page => `
  <div class="wk">STONKFUN WALLET</div><h3 id="walAddr"></h3><div id="walKol"></div>
  <div class="wl"><a id="walScan" target="_blank" rel="noopener">SOLSCAN ↗</a><a href="#" id="walCa">COPY ADDRESS</a>${page ? '' : '<a id="walPage" title="this wallet on its own page">FULL PAGE ↗</a>'}</div>
  <div id="walKpi"></div>
  <div class="sec">COINS <span class="dim" id="walSt"></span></div><div id="walCtl" class="wctl"></div><div id="walCoins"></div>
  <div class="sec">SHARE</div><img id="walCard" alt="" onerror="this.onerror=null;this.src='/share-terminal7-v3.png'">
  <div class="acts"><a class="btn primary" id="walTweet" target="_blank" rel="noopener">SHARE AS TWEET</a><button class="btn" id="walImg" type="button">COPY IMAGE</button>
    <button class="btn" id="walSave" type="button">SAVE IMAGE</button><button class="btn" id="walCopy" type="button">COPY LINK</button></div>
  <div class="foot">Every stonkfun coin this wallet holds now or has traded or earned from, in one list: tap a column to sort by it (again to flip it), or
    show only what it holds now or has exited. Rewards, buys, sells and P&amp;L are read from the chain trade by trade: every swap valued at that hour's price, every payout
    credited to the coins held at the time. P&amp;L = value now + sold + rewards − bought; tokens moved in from another wallet aren't counted
    as bought (* = some at an estimated price). Scores: each coin's compound score from this wallet's own history (the site's formula), or the
    compounding tracker's until the history has been read; overall score = each coin's score weighted by the rewards it paid. Fees paid =
    each coin's transfer tax on its trades + Solana network fees. Tap a coin for its totals and recent trades.</div>`;

  // the coins list: sort (column, direction) and filters, remembered on this browser
  const SORTS = [['v', 'VALUE'], ['pnl', 'P&L'], ['R', 'REWARDS'], ['N', 'NET BOUGHT'], ['score', 'SCORE'], ['p', '% HELD']];   // (the columns that sort)
  let view = { k: 'v', dir: -1, st: '' };   // sort column + direction, held / exited
  try { const s = JSON.parse(localStorage.getItem('xrView') || 'null');
    if (s && SORTS.some(x => x[0] === s.k)) view = { k: s.k, dir: s.dir === 1 ? 1 : -1, st: ['held', 'exited'].includes(s.st) ? s.st : '' }; } catch (e) {}
  const keep = () => { try { localStorage.setItem('xrView', JSON.stringify(view)); } catch (e) {} };

  let cur = null, all = false, last = null, isPage = false;

  // one row per coin: what it holds now (value, amount) joined to its history (rewards, trades, P&L, score)
  function rows(d) {
    const hold = {}; for (const h of d.holdings || []) hold[h.m] = h;
    const out = (d.coins || []).map(c => { const h = hold[c.m]; return { ...c, i: c.i || h?.i, v: h ? h.usd || 0 : (c.held ? null : 0), amt: h?.amt, held: h ? true : c.held }; });
    const seen = new Set(out.map(c => c.m));
    for (const h of d.holdings || []) if (!seen.has(h.m)) out.push({ m: h.m, s: h.s, i: h.i, v: h.usd || 0, amt: h.amt, held: true, p: null, R: 0, N: null, pnl: null, score: null, tag: null, n: 0, tr: [] });
    return out;
  }
  const stOf = c => c.held === false ? 'exited' : 'held';
  const pick = list => list.filter(c => !view.st || stOf(c) === view.st);
  function order(list) {
    const k = view.k, dir = view.dir;
    return list.slice().sort((a, b) => { const x = a[k], y = b[k];
      if (x == null && y == null) return (b.v || 0) - (a.v || 0); if (x == null) return 1; if (y == null) return -1;   // no number: always last
      return dir * (x - y) || (b.v || 0) - (a.v || 0); });
  }

  function mount(box, opts = {}) {
    isPage = !!opts.page;
    if (!$('xrCss')) { const st = document.createElement('style'); st.id = 'xrCss'; st.textContent = CSS; document.head.appendChild(st); }
    box.classList.add('xr'); box.insertAdjacentHTML('beforeend', SHELL(isPage));
    $('walCa').onclick = e => { e.preventDefault(); navigator.clipboard?.writeText(cur || '').then(() => { $('walCa').textContent = 'COPIED'; }).catch(() => {}); };
  }

  async function open(w) {
    if (!WRE.test(w || '')) return false;
    cur = w; all = false; last = null;
    const short = w.slice(0, 4) + '…' + w.slice(-4);
    $('walKol').innerHTML = '';
    kolGet([w]).then(() => { const k = KOL[w]; if (!k || cur !== w) return; $('walAddr').textContent = k.name;
      if (isPage) document.title = k.name + ' · Wallet X-Ray · Terminal 7';
      $('walKol').innerHTML = `<span class="dim">${esc(short)} · <a href="${kolUrl(k)}" target="_blank" rel="noopener">${k.x ? '@' + esc(k.x) : k.p ? 'pump.fun' : 'KOLlector'}</a>${k.f ? ` · ${kolFol(k.f)} followers` : ''} · <span title="${esc(k.how)}">name via <a href="https://dethective.com/kollector/" target="_blank" rel="noopener">KOLlector</a></span></span>`; });
    $('walAddr').textContent = short; $('walScan').href = 'https://solscan.io/account/' + w; $('walCa').textContent = 'COPY ADDRESS';
    if ($('walPage')) $('walPage').href = '/wallet/' + w;
    if (isPage) document.title = 'Wallet ' + short + ' · Wallet X-Ray · Terminal 7';
    $('walCard').src = BOT + '/card/wallet/' + w + '.png';
    $('walKpi').innerHTML = ''; $('walCtl').innerHTML = ''; $('walCoins').innerHTML = '<div class="dim" style="font-size:11px">loading…</div>';
    $('walSt').textContent = '';
    let d = null; try { d = await j(BOT + '/wallet/' + w); } catch (e) {}
    if (cur !== w) return true;
    if (d && !d.error) render(w, d);
    // then its whole history read from the chain, trade by trade (seconds the first time, saved after that)
    $('walSt').textContent = 'reading its full history from the chain, trade by trade…';
    // a wallet with a long history takes several reads (~20 s each): keep asking while it's open, up to 30 rounds
    for (let k = 0; k < 30; k++) {
      let f = null; try { f = await j(BOT + '/wallet/' + w + '?full=1'); } catch (e) {}
      if (cur !== w) return true;
      if (f && !f.error) { render(w, f); d = f; }
      const h = f && f.hist; if (!h || h.done || h.paused || h.stale || h.capped) break;
      $('walSt').textContent = `reading its full history from the chain · ${h.txs.toLocaleString('en-US')} transactions so far…`;
    }
    // the share card opened before the history read finished: draw it again with the whole history (the bot keeps an unfinished one a minute)
    if (d && d.hist && d.hist.done) $('walCard').src = BOT + '/card/wallet/' + w + '.png?h=' + d.hist.txs;
    if (!d || d.error) { $('walSt').textContent = ''; $('walCoins').innerHTML = '<div class="dim" style="font-size:11px">couldn\'t load this wallet right now · try again in a minute</div>'; return true; }
    const h = d.hist; $('walSt').textContent = !h ? 'full history unavailable right now · showing the compounding tracker' : h.stale ? `couldn't reach the chain just now · showing the ${h.txs.toLocaleString('en-US')} transactions read before` : h.done ? `full history from the chain · ${h.txs.toLocaleString('en-US')} transactions` :
      h.paused ? 'full history paused for today (daily reading limit)' : h.bot === 'app' ? `an app / exchange wallet (${(h.rate || 0).toLocaleString('en-US')} transactions an hour, signed by its users): not one person's history, not read` : h.bot ? `a trading bot (${(h.rate || 0).toLocaleString('en-US')} transactions an hour): its history isn't read` : h.capped ? `a bot-sized wallet: showing its newest ${h.txs.toLocaleString('en-US')} trades, not read further` : `read its newest ${h.txs.toLocaleString('en-US')} transactions so far · the rest next time it's opened`;
    return true;
  }
  function close() { cur = null; }

  function render(w, d) {
    last = d;
    const sc = d.score, col = sc == null ? 'var(--dim)' : sc >= 40 ? 'var(--green)' : sc >= 20 ? 'var(--amber)' : 'var(--red)', lbl = sc == null ? 'no rewards yet' : sc >= 60 ? 'Strong' : sc >= 40 ? 'Healthy' : sc >= 20 ? 'Mixed' : 'Weak';
    const earning = d.coins.filter(c => c.R > 0);
    const T = d.totals || {}, pc = v => v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--txt)';
    $('walKpi').innerHTML = `<div style="border-color:${col}"><b style="color:${col}">${sc ?? '—'}</b><span>COMPOUND SCORE · ${lbl.toUpperCase()}</span></div>
    <div><b style="color:var(--green)">${usd(d.rewards || 0)}</b><span>TOTAL REWARDS</span>${d.rewardsNow != null && d.rewards > 0 ? `<i title="each payout's reward tokens valued at today's price (how stonkfun shows rewards); the big number values each payout at its own day's price${d.rewardsNowAll ? '' : '. Coins whose history is still being read count as paid'}">${d.rewardsNowAll ? '' : '≈ '}${usd(d.rewardsNow)} at today's prices</i>` : ''}</div>
    <div><b style="color:${pc(T.pnl)}">${T.pnl != null ? (T.pnl > 0 ? '+' : '') + usd(T.pnl) + (T.est ? '*' : '') : '—'}</b><span>TOTAL P&amp;L</span></div>
    <div><b>${usd(d.value || 0)}</b><span>STONKFUN HOLDINGS</span></div>
    <div><b>${T.tax != null || T.fees != null ? usd((T.tax || 0) + (T.fees || 0)) : '—'}</b><span title="transfer tax on its trades + Solana network fees">FEES PAID</span></div>
    <div><b>${earning.length}</b><span>COINS EARNING</span></div>`;
    drawCoins(d);
    share(w, d, sc, lbl, earning);
  }

  function drawCoins(d) {
    const list = rows(d);
    if (!list.length) { $('walCtl').innerHTML = ''; $('walCoins').innerHTML = `<div class="dim" style="font-size:11px">${d.live === false ? 'Holdings unavailable right now (the chain read failed) · try again in a minute' : 'No stonkfun coins, trades or rewards found for this wallet.'}</div>`; return; }
    // ALL / HOLDING / EXITED (the column headers sort)
    const n = st => list.filter(c => stOf(c) === st).length;
    $('walCtl').innerHTML = `<div class="wchips">${[['', 'ALL', list.length], ['held', 'HOLDING', n('held')], ['exited', 'EXITED', n('exited')]]
      .map(([k, t, c]) => `<button type="button" data-st="${k}" class="${view.st === k ? 'on' : ''}">${t}<i>${c}</i></button>`).join('')}</div>`;
    $('walCtl').querySelectorAll('button[data-st]').forEach(b => b.onclick = () => { view.st = b.dataset.st; all = false; keep(); drawCoins(last); });

    const shown = order(pick(list));
    // every coin gets a logo: its own, else the Stonk Board's copy, else the helmet
    const shr = v => v >= 10 ? v.toFixed(1) + '%' : v >= 0.01 ? v.toFixed(2) + '%' : '<0.01%';
    const coin = (m, s, i) => `<a href="/terminal/token?ca=${esc(m)}"><img src="${esc(i || '/helmet.png')}" alt="" loading="lazy" data-sb="https://thestonkboard.com/api/logos/${esc(m)}" onerror="if(this.dataset.sb&&this.src!==this.dataset.sb){this.src=this.dataset.sb;this.dataset.sb=''}else{this.onerror=null;this.src='/helmet.png'}"><span class="wsy" title="$${esc(String(s || '?').replace(/^\$/, ''))}">$${esc(String(s || '?').replace(/^\$/, ''))}</span></a>`;
    const amt = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n >= 1 ? n.toFixed(0) : n.toPrecision(2);
    const pnlc = v => v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--dim)', dt = t => new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const dash = '<span class="dim">—</span>';
    const th = (k, t, cls = '', tip = '') => `<th class="r ${cls}${view.k === k ? ' on' : ''}" data-k="${k}"${tip ? ` title="${tip}"` : ''}>${t}${view.k === k ? (view.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`;
    const val = c => c.v == null ? dash : c.v === 0 ? (c.held === false ? '<span class="dim">$0</span>' : dash) : c.v < 1 ? '<span class="dim" title="dust: worth under $1">&lt;$1</span>' : usd(c.v);
    $('walCoins').innerHTML = shown.length ? `<div class="wtw"><table><thead><tr><th>COIN</th>${th('v', 'VALUE')}${th('R', 'REWARDS')}${th('pnl', 'P&amp;L', '', "value now + sold + rewards − bought, over the coin's full history")}${th('N', 'NET BOUGHT', 'hs2')}${th('p', '% HELD', 'hs2', "share of the coin's supply")}${th('score', 'SCORE')}</tr></thead><tbody>${shown.slice(0, all ? 999 : 25).map(c => `<tr class="${c.tr && c.tr.length ? 'wcr' : ''}"><td>${coin(c.m, c.s, c.i)}<div class="whd" style="color:${c.held ? 'var(--green)' : 'var(--dim)'}">${c.held == null ? '' : c.held ? 'HOLDING' : 'EXITED'}${c.n ? ` · ${c.n} trade${c.n === 1 ? '' : 's'} ▾` : ''}</div></td>
      <td class="r">${val(c)}${c.amt ? `<div class="wam">${amt(c.amt)}</div>` : ''}</td>
      <td class="r">${c.R > 0 ? usd(c.R) : dash}${c.share != null && c.R > 0 ? `<div class="wam" title="this wallet's share of all the rewards $${esc(String(c.s || '').replace(/^\$/, ''))} has paid out">${shr(c.share)} of all</div>` : ''}</td>
      <td class="r" style="color:${pnlc(c.pnl)}" title="${c.est ? 'some trades valued at an estimated price' : ''}">${c.pnl == null ? '—' : (c.pnl > 0 ? '+' : '') + usd(c.pnl)}${c.est ? '*' : ''}</td>
      <td class="r hs2" style="color:${pnlc(c.N)}">${c.N != null ? (c.N > 0 ? '+' : '') + usd(c.N) : '—'}</td>
      <td class="r hs2">${c.p != null ? c.p.toFixed(2) + '%' : dash}</td>
      <td class="r">${c.score != null ? `<span class="wsc" style="color:${TAGC[c.tag]};border-color:${TAGC[c.tag]}">${c.score}</span><span class="wtg" style="color:${TAGC[c.tag]}">${esc(c.tag).toUpperCase()}</span>` : `<span class="dim" style="font-size:9.5px;letter-spacing:1px" title="scores cover each coin's biggest holders">${c.tracked ? 'NO REWARD YET' : 'NOT SCORED'}</span>`}</td></tr>
      ${c.tr && c.tr.length ? `<tr class="wtr" style="display:none"><td colspan="7"><div class="wsum">bought <b>${usd(c.B || 0)}</b> · sold <b>${usd(c.S || 0)}</b> · rewards <b>${usd(c.R || 0)}</b>${c.Rn != null && Math.abs(c.Rn - c.R) >= 1 ? ` (${usd(c.Rn)} at today's prices)` : ''}${c.share != null ? ` (${shr(c.share)} of all $${esc(String(c.s || '').replace(/^\$/, ''))} rewards paid${c.paid ? ' · ' + c.paid.toLocaleString('en-US') + ' wallets paid' : ''})` : ''} · tax paid <b>${(c.tax || 0) < 1 ? '$' + (c.tax || 0).toFixed(2) : usd(c.tax)}</b> · network fees <b>${(c.fees || 0) < 1 ? '$' + (c.fees || 0).toFixed(2) : usd(c.fees)}</b></div><div class="wtl">${c.tr.map(x => `<a href="https://solscan.io/tx/${esc(x[4])}" target="_blank" rel="noopener" title="opens the transaction (first 20 characters of its signature)"><span>${dt(x[0])}</span><b style="color:${x[1] === 'b' ? 'var(--green)' : 'var(--red)'}">${x[1] === 'b' ? 'BUY' : 'SELL'}</b><span>${amt(x[2])}</span><span>${usd(x[3])}</span></a>`).join('')}</div></td></tr>` : ''}`).join('')}</tbody></table></div>
      ${shown.length > 25 ? `<button class="btn" id="walMore" style="margin-top:6px;font-size:11px">${all ? 'SHOW TOP 25' : 'SHOW ALL ' + shown.length}</button>` : ''}`
      : '<div class="dim" style="font-size:11px">No coins match these filters.</div>';
    $('walCoins').querySelectorAll('th[data-k]').forEach(t => t.onclick = () => sortBy(t.dataset.k));
    $('walCoins').querySelectorAll('tr.wcr').forEach(tr => tr.onclick = e => { if (e.target.closest('a')) return; const n = tr.nextElementSibling; if (n && n.classList.contains('wtr')) n.style.display = n.style.display === 'none' ? '' : 'none'; });
    const mb = $('walMore'); if (mb) mb.onclick = () => { all = !all; drawCoins(last); };
  }
  // the same column again flips the direction; a new one starts high to low
  function sortBy(k) { view = { ...view, dir: view.k === k ? -view.dir : -1, k }; keep(); drawCoins(last); }

  function share(w, d, sc, lbl, earning) {
    const url = link(w);
    const txt = `${KOL[w] ? KOL[w].name + (KOL[w].x ? ' (@' + KOL[w].x + ')' : '') : 'Wallet ' + w.slice(0, 4) + '…' + w.slice(-4)} on stonkfun: compound score ${sc ?? '—'}${sc != null ? ' (' + lbl + ')' : ''} · ${usd(d.rewards || 0)} in rewards from ${earning.length} coin${earning.length === 1 ? '' : 's'}`;
    $('walTweet').href = 'https://x.com/intent/tweet?text=' + encodeURIComponent(txt) + '&url=' + encodeURIComponent(url);
    // the card as a file: COPY IMAGE puts it on the clipboard; SAVE IMAGE uses the phone's share sheet (Save to Photos) or downloads it
    const cardFile = async () => { const r = await fetch($('walCard').src.startsWith(BOT) ? $('walCard').src : BOT + '/card/wallet/' + w + '.png'); if (!r.ok) throw new Error(r.status); return new File([await r.blob()], 'terminal7-wallet-' + w.slice(0, 4) + '.png', { type: 'image/png' }); };
    const say = (id, t, back) => { $(id).textContent = t; setTimeout(() => $(id).textContent = back, 1800); };
    $('walImg').onclick = async () => { try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': cardFile().then(f => f) })]); say('walImg', 'COPIED', 'COPY IMAGE'); }
      catch (e) { say('walImg', matchMedia('(pointer:coarse)').matches ? 'HOLD THE IMAGE' : 'USE SAVE IMAGE', 'COPY IMAGE'); } };
    $('walSave').onclick = async () => { let f; try { f = await cardFile(); } catch (e) { say('walSave', 'TRY AGAIN', 'SAVE IMAGE'); return; }
      if (matchMedia('(pointer:coarse)').matches && navigator.canShare?.({ files: [f] })) { try { await navigator.share({ files: [f] }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      const u = URL.createObjectURL(f), a = document.createElement('a'); a.href = u; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); say('walSave', 'SAVED', 'SAVE IMAGE'); };
    $('walCopy').onclick = () => { navigator.clipboard?.writeText(url).then(() => { $('walCopy').textContent = 'COPIED'; setTimeout(() => $('walCopy').textContent = 'COPY LINK', 1500); }).catch(() => {}); };
  }

  window.Xray = { mount, open, close, KOL, kolGet, kolUrl, kolFol, WRE, link, get w() { return cur; } };
})();
