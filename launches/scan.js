// The launch radar's pieces, shared by New launches (launches/radar.js, the coin's panel) and the token page
// (launches/token-radar.js): the verdict, the Token Info tiles (as on jup.ag), who funded the top holders, BEFORE YOU BUY.
// Markup only: styles in launches/scan.css (everything under .lrscan). One row of terminal/launches.json in, HTML out.
window.LRS = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => n == null ? '—' : Number(n).toLocaleString('en-US');
  const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
  // the site's own pages: relative on its domains, the live site's from anywhere else (a test copy)
  const SITE = /(^|\.)(terminal7\.xyz|themarines\.link|workers\.dev)$|^localhost/.test(location.hostname) ? '' : 'https://terminal7.xyz';
  // bundled now: the bigger of what bundlers hold (Jupiter's Bundlers H.) and linked holders, as on jup.ag: not the peak
  const bnow = r => r.bh ?? r.bpk ?? 0;   // rows from before bh was collected: the peak
  const bundOf = r => Math.max(bnow(r), (r.scan && r.scan.lk) || 0);
  const vd = r => `<span class="vd v-${esc(r.vd)}"><i>${r.score}</i>${esc(r.vd)}</span>`;
  const tile = (v, label, bad, tip, bm) => `<div class="tile${bm ? ' bmt' : ''}"${tip ? ` title="${tip}"` : ''}${bm ? ` data-bm="${esc(bm)}" role="button" tabindex="0"` : ''}><b class="${bad == null ? '' : bad ? 'r' : 'g'}">${v}</b><span>${label}</span></div>`;
  const pc = v => v == null ? '—' : (+v).toFixed(2) + '%';
  function tiles(r) {
    const sc = r.scan;
    return `<div class="tiles">
      ${tile(pc(r.top), 'Top 10 H.', r.top > 30)}${tile(sc ? pc(sc.sn) : '—', 'Snipers H.', sc ? sc.sn > 5 : null)}${tile(sc ? pc(sc.in) : '—', 'Insiders H.', sc ? sc.in > 5 : null)}
      ${tile(pc(bnow(r)), 'Bundlers H.', bnow(r) >= 5, 'What bundlers hold now' + (r.bpk ? ' (' + r.bpk + '% at their peak)' : ''))}${tile(sc ? pc(sc.lk) : '—', 'Linked H.', sc ? sc.lk >= 10 : null, 'Held by top holders one private wallet funded. Tap for the bubble map', sc && r.m)}${tile(r.bot + '%', 'Bot H.', null)}
      ${tile('◎' + (r.fees ?? '—'), 'Fees Paid', null)}${tile(r.os, 'Org Score', r.os < 30)}${tile(sc ? sc.fresh + ' / ' + sc.n : '—', 'Fresh wallets', sc ? sc.fresh / Math.max(sc.n, 1) > 0.3 : null)}
    </div>`;
  }
  // who funded the top holders: each source's wallets and their share of the supply; then every linked cluster (one private
  // wallet funded 2+ of the top holders), the biggest first, adding up to Linked H.
  const pc2 = v => v == null ? '' : (v < 0.01 && v > 0 ? '<0.01' : v.toFixed(2)) + '%';
  function funding(r) {
    const sc = r.scan;
    if (!sc) return '<p class="dim note">bundle scan pending: it runs on coins with $10K+ volume, a few each pass</p>';
    const tot = Object.values(sc.src).reduce((a, b) => a + b, 0) || 1, ind = k => k === 'independent' || k === 'own wallet', sp = sc.sp || {};
    const map = r.m && window.LRS_MAP !== false ? `<button type="button" class="bmb" data-bm="${esc(r.m)}">🫧 BUBBLE MAP</button>` : '';
    let h = `<h3 class="bmh">WHO FUNDED THE TOP ${sc.n} HOLDERS${map}</h3><p class="dim note" style="margin:-4px 0 8px">wallets${sc.sp ? ' · their share of the supply' : ''}</p><div class="lr-src">${Object.entries(sc.src).map(([k, v]) => `<span>${esc(k === 'linked' ? 'linked (one private funder)' : ind(k) ? 'independent wallets' : k === 'unknown' ? 'no funding info' : k)}</span><i>${v}${sp[k] != null ? ' · ' + pc2(sp[k]) : ''}</i><div class="sbar ${k === 'linked' ? 'lk' : ind(k) || k === 'unknown' ? '' : 'ex'}"><s style="width:${v / tot * 100}%"></s></div>`).join('')}</div>`;
    const cl = sc.cl || [], nc = sc.nc || cl.length, show = cl.slice(0, 6), rest = cl.slice(6), restP = rest.reduce((a, c) => a + c[2], 0);
    const wl = cl.reduce((a, c) => a + c[1], 0) || (sc.src && sc.src.linked) || 0;
    h += cl.length ? `<h3>LINKED CLUSTERS</h3><p class="dim note" style="margin:-4px 0 6px">${nc} cluster${nc === 1 ? '' : 's'} · ${wl} wallets · ${pc2(sc.lk)} of the supply (Linked H.)</p>${show.map(c => `<div class="cl"><a href="${SITE}/wallet/${esc(c[0])}" title="the funder: open its X-Ray">${esc(short(c[0]))}</a><span>funded ${c[1]} holders</span><b class="${c[2] >= 10 ? 'dn' : ''}">${pc2(c[2])}</b></div>`).join('')}${rest.length ? `<div class="cl dim"><span>+${rest.length} smaller cluster${rest.length === 1 ? '' : 's'}</span><span></span><b>${pc2(restP)}</b></div>` : nc > cl.length ? `<div class="cl dim"><span>+${nc - cl.length} smaller</span><span></span><b>${pc2(sc.lk - cl.reduce((a, c) => a + c[2], 0))}</b></div>` : ''}<p class="dim note">holders first funded by the same wallet, which isn't an exchange or a service that funds wallets across many coins</p>` : '<h3>LINKED CLUSTERS</h3><p class="dim note">none: no private wallet funded two of the top holders</p>';
    return h;
  }
  // right above a swap: what the data says against the coin, so nobody buys it without seeing it (every swap still needs the
  // wallet's approval: no quick buy)
  function beforeBuy(r) {
    const sc = r.scan || {}, F = [], bund = bundOf(r);
    if (r.vd === 'FARM') F.push(['r', 'farm volume: its fees back only ' + (r.fb ?? '—') + ' of the volume it reports']);
    else if (r.fb != null && r.fb < 0.45) F.push(['a', 'fees back only ' + r.fb + ' of the reported volume']);
    if (bund >= 20) F.push(['r', bund.toFixed(1) + '% of the supply held by bundlers or linked wallets']); else if (bund >= 10) F.push(['a', bund.toFixed(1) + '% held by bundlers or linked wallets']);
    if (sc.sn > 5) F.push(['a', 'snipers hold ' + sc.sn.toFixed(1) + '%']); if (sc.in > 5) F.push(['a', 'insiders hold ' + sc.in.toFixed(1) + '%']);
    if (r.top > 30) F.push(['a', 'top 10 holders hold ' + r.top + '%']);
    const dd = r.pk ? 1 - r.mc / r.pk : 0;
    const pa = r.pa, tm = m => m < 90 ? m + ' min' : Math.round(m / 60) + ' h';
    if (r.pnd || (r.flags || []).includes('PUMP & DUMP')) F.push(['r', `pump and dump: peaked ${tm(pa ? pa.up : 0)} after launch and lost half of it within ${tm(pa && pa.half != null ? pa.half : 0)}`]);
    if (dd >= 0.5 && r.pk >= 20000) F.push([dd >= 0.85 ? 'r' : 'a', 'down ' + Math.round(dd * 100) + '% from its $' + (r.pk >= 1e6 ? (r.pk / 1e6).toFixed(2) + 'M' : Math.round(r.pk / 1e3) + 'K') + ' peak' + (pa && pa.half != null && !r.pnd ? ', half of it gone ' + tm(pa.half) + ' after the peak' : '')]);
    if (r.bpk >= 10 && (r.bh || 0) < r.bpk / 2) F.push(['a', 'bundlers held ' + r.bpk + '% at their peak and have sold']);
    if (r.dn >= 5 && r.dn <= 2000 && r.dg / r.dn < 0.05) F.push(['r', 'serial launcher: ' + num(r.dg) + ' of ' + num(r.dn) + ' other coins graduated']);
    if (r.vr && r.vr.st === 'rejected') F.push(['r', 'Jupiter VRFD rejected its verification']);
    if (r.ob < 5) F.push(['a', 'only ' + num(r.ob) + ' organic buyers in 24 h']);
    return `<div class="bfb"><b>BEFORE YOU BUY</b><ul>${F.length ? F.map(([c, t]) => `<li class="${c}">${t}</li>`).join('') : '<li class="g">no red flags in the data above (not a guarantee)</li>'}</ul></div>`;
  }
  // the bundle scan of any coin, in the browser, as intel/launches.py's holder_scan does it: Jupiter's top 100 holders (pools
  // left out), who first funded each, the clusters one private wallet funded. cex / svc: the radar's exchanges and the
  // funders it saw behind 4+ coins (services, not links). Fresh: a wallet first funded since 2 days before a launch, for an
  // older coin in the last 7 days.
  const CEX = { '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9': 'Binance', 'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS': 'Coinbase', 'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE': 'Coinbase', '5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD': 'OKX', 'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2': 'Bybit', 'ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ': 'MEXC' };   // intel/launches.py's EXCHANGES
  // w: one row per top holder [address, % of the supply, kind, funder, funder's name]; kind c linked, x exchange, s service,
  // i independent, u no funding info. summarize() turns them into the source counts, supply shares and clusters.
  function summarize(w, fresh, n) {
    const src = {}, sp = {}, by = {};
    const add = (k, p) => { src[k] = (src[k] || 0) + 1; sp[k] = (sp[k] || 0) + p; };
    for (const [a, p, k, f, name] of w) {
      if (k === 'c') { add('linked', p); (by[f] = by[f] || [f, 0, 0])[1]++; by[f][2] += p; }
      else add(k === 'u' ? 'unknown' : k === 'i' ? 'independent' : name, p);
    }
    const cl = Object.values(by).map(c => [c[0], c[1], +c[2].toFixed(2)]).sort((a, b) => b[2] - a[2]);
    for (const k in sp) sp[k] = +sp[k].toFixed(2);
    return { lk: +cl.reduce((a, c) => a + c[2], 0).toFixed(2), cl, nc: cl.length, fresh, n, w, sp,
      src: Object.fromEntries(Object.entries(src).filter(([, v]) => v).sort((a, b) => b[1] - a[1])) };
  }
  function scanHolders(H, supply, created, cex = CEX, svc = []) {
    if (!supply || !H) return null;
    cex = { ...CEX, ...(cex || {}) }; const S = new Set(svc || []), pct = x => x.amount / supply * 100, t = s => s ? Date.parse(s) / 1000 : 0;
    H = H.filter(x => !(x.tags || []).some(g => /Pool|Bonding Curve|Vault/.test(g.id || '')));
    const since = created > Date.now() / 1000 - 3 * 86400 ? created - 2 * 86400 : Date.now() / 1000 - 7 * 86400;
    const byF = {}, w = []; let fresh = 0;
    for (const x of H) {
      const f = x.addressInfo && x.addressInfo.fundingAddress;
      if (!f) { w.push([x.address, pct(x), 'u', null]); continue; }
      if (t(x.addressInfo.fundingBlockTime) >= since) fresh++;
      (byF[f] = byF[f] || []).push(x);
    }
    for (const [f, xs] of Object.entries(byF)) {
      const name = cex[f] || (S.has(f) ? 'exchange / service' : null);
      for (const x of xs) w.push([x.address, pct(x), name ? (cex[f] ? 'x' : 's') : xs.length >= 2 ? 'c' : 'i', f, name]);
    }
    return summarize(w, fresh, H.length);
  }
  // a "linked" funder that's really an app or exchange wallet (Fomo, pump.fun, onramps, hot wallets) funds thousands of
  // strangers: its last 100 transactions span hours, a private bundler's span days or weeks. Each cluster's funder is checked
  // on chain (public RPC, remembered a day in this browser); a busy one becomes a service, not a link.
  const RPC = 'https://solana-rpc.publicnode.com';
  async function busy(f) {
    const K = 'lrsBusy:' + f; try { const c = JSON.parse(localStorage.getItem(K) || 'null'); if (c && Date.now() - c[1] < 86400e3) return c[0]; } catch (e) {}
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [f, { limit: 100 }] }) }).then(r => r.json());
    const sg = r.result || []; if (!r.result) throw new Error('rpc');
    const b = sg.length >= 100 && (sg[0].blockTime - sg[sg.length - 1].blockTime) < 2 * 86400;   // 100 txs inside 2 days
    try { localStorage.setItem(K, JSON.stringify([b, Date.now()])); } catch (e) {}
    return b;
  }
  async function vetFunders(sc) {
    if (!sc || !sc.w || !sc.cl.length) return sc;
    const out = new Set();
    for (const [f] of sc.cl.slice(0, 15)) { try { if (await busy(f)) out.add(f); } catch (e) {} }
    if (!out.size) return { ...sc, vetted: sc.cl.length };
    const w = sc.w.map(x => x[2] === 'c' && out.has(x[3]) ? [x[0], x[1], 's', x[3], 'app / exchange wallet'] : x);
    // a cluster left with one holder isn't a cluster
    const cnt = {}; w.forEach(x => { if (x[2] === 'c') cnt[x[3]] = (cnt[x[3]] || 0) + 1; });
    const w2 = w.map(x => x[2] === 'c' && cnt[x[3]] < 2 ? [x[0], x[1], 'i', x[3]] : x);
    return { ...summarize(w2, sc.fresh, sc.n), vetted: sc.cl.length, apps: out.size };
  }
  // the radar's score (intel/launches.py), for any coin: 25 organic buyers, 20 fee-backed volume (or the organic share when
  // there are no payouts to check), 15 bundles, 15 dev, 10 holders, 5 top 10, 5 organic share, 5 fees per trade; minus up
  // to 40 for what the price did (priceScore) and 10 for bundles sold into the pump
  // the shape of the move (intel/launches.py price_action / price_score), from market-cap candles: minutes from launch to the
  // peak (up), from the peak to the first close under half of it (half; null if it never lost half), the close now below
  // the peak (dd). Score -40 to +5: the drop weighted by how fast it fell, -10 for a pump and dump, +5 for a steady climb.
  function priceAction(C, created) {
    C = (C || []).filter(c => c.close); if (C.length < 3) return null;
    const held = C.slice(0, -1).map((c, k) => Math.min(c.close, C[k + 1].close));   // a peak held two candles: one bad tick isn't one
    let i = 0; held.forEach((v, k) => { if (v > held[i]) i = k; });
    const pc = held[i], tp = C[i].time, h = C.slice(i + 1).find(c => c.close < pc / 2);
    return { pk: Math.round(pc), up: Math.round(Math.max(0, tp - created) / 60), half: h ? Math.round((h.time - tp) / 60) : null, dd: +Math.max(0, 1 - C[C.length - 1].close / pc).toFixed(3) };
  }
  function priceScore(dd, pa) {
    const cap = v => Math.max(0, Math.min(1, v)), half = pa ? pa.half : null, up = pa ? pa.up : null;
    const sp = !pa ? 0.8 : half == null ? 0.6 : 1 - 0.4 * cap(Math.log(Math.max(half, 60) / 60) / Math.log(12));
    const crash = 30 * cap((dd - 0.4) / 0.5) * sp, spike = pa && up <= 60 && half != null && half <= 60 && dd >= 0.7 ? 10 : 0;
    const steady = pa && half == null && dd < 0.4 ? 5 * Math.min(1, up / 360) : 0;
    return [steady - crash - spike, !!spike];
  }
  function score(x) {
    const lg = Math.log10, cap = v => Math.max(0, Math.min(1, v)), org = x.jv ? x.ov / x.jv : 0;
    const s = 25 * Math.min(1, lg(1 + x.ob) / 2) + (x.fb != null ? 20 * Math.min(1, x.fb / 0.7) : 12 * Math.min(1, org / 0.08))
      + 15 * Math.max(0, 1 - x.bund / 25)
      + (x.dn < 1 || x.dn > 2000 || !x.audit ? 7 : x.dg / x.dn >= 0.2 ? 15 : x.dn >= 5 && x.dg / x.dn < 0.05 ? 0 : 7)
      + 10 * Math.min(1, lg(1 + x.h) / 3) + (x.top != null ? 5 * cap((80 - x.top) / 50) : 2.5) + 5 * Math.min(1, org / 0.08)
      + (x.fpt != null ? 5 * cap((4 - x.fpt) / 2.5) : 2.5)
      + priceScore(x.dd || 0, x.pa)[0]   // what the price did
      - (x.bpk >= 10 && (x.bh || 0) < x.bpk / 2 ? 10 * Math.min(1, x.bpk / 25) : 0);   // bundlers who sold into the pump
    const pnd = priceScore(x.dd || 0, x.pa)[1], dumped = (x.dd || 0) >= 0.85 && x.pk >= 20000;
    const sc = Math.max(0, Math.min(100, Math.round(s))), farm = x.vol >= 20000 && (x.fb != null ? x.fb < 0.45 && (x.ob < 20 || x.h < 60) : x.ob < 5);
    return { score: sc, dumped, pnd, vd: farm ? 'FARM' : sc >= 60 && x.bund < 20 && !dumped ? 'REAL' : sc >= 35 ? 'WATCH' : 'THIN', org: x.jv ? +(org * 100).toFixed(1) : null };
  }
  return { esc, num, short, SITE, bnow, bundOf, scanHolders, summarize, vetFunders, score, priceAction, priceScore, vd, tiles, funding, beforeBuy };
})();
