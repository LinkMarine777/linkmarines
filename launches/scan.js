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
  const tile = (v, label, bad, tip) => `<div class="tile"${tip ? ` title="${tip}"` : ''}><b class="${bad == null ? '' : bad ? 'r' : 'g'}">${v}</b><span>${label}</span></div>`;
  const pc = v => v == null ? '—' : (+v).toFixed(2) + '%';
  function tiles(r) {
    const sc = r.scan;
    return `<div class="tiles">
      ${tile(pc(r.top), 'Top 10 H.', r.top > 30)}${tile(sc ? pc(sc.sn) : '—', 'Snipers H.', sc ? sc.sn > 5 : null)}${tile(sc ? pc(sc.in) : '—', 'Insiders H.', sc ? sc.in > 5 : null)}
      ${tile(pc(bnow(r)), 'Bundlers H.', bnow(r) >= 5, 'What bundlers hold now' + (r.bpk ? ' (' + r.bpk + '% at their peak)' : ''))}${tile(sc ? pc(sc.lk) : '—', 'Linked H.', sc ? sc.lk >= 10 : null)}${tile(r.bot + '%', 'Bot H.', null)}
      ${tile('◎' + (r.fees ?? '—'), 'Fees Paid', null)}${tile(r.os, 'Org Score', r.os < 30)}${tile(sc ? sc.fresh + ' / ' + sc.n : '—', 'Fresh wallets', sc ? sc.fresh / Math.max(sc.n, 1) > 0.3 : null)}
    </div>`;
  }
  // who funded the top holders, and the clusters one private wallet funded
  function funding(r) {
    const sc = r.scan;
    if (!sc) return '<p class="dim note">bundle scan pending: it runs on coins with $10K+ volume, a few each pass</p>';
    const tot = Object.values(sc.src).reduce((a, b) => a + b, 0) || 1, ind = k => k === 'independent' || k === 'own wallet';
    let h = `<h3>WHO FUNDED THE TOP ${sc.n} HOLDERS</h3><div class="lr-src">${Object.entries(sc.src).map(([k, v]) => `<span>${esc(k === 'linked' ? 'linked (one private funder)' : ind(k) ? 'independent wallets' : k === 'unknown' ? 'no funding info' : k)}</span><i>${v}</i><div class="sbar ${k === 'linked' ? 'lk' : ind(k) || k === 'unknown' ? '' : 'ex'}"><s style="width:${v / tot * 100}%"></s></div>`).join('')}</div>`;
    h += sc.cl && sc.cl.length ? `<h3>LINKED CLUSTERS</h3>${sc.cl.map(c => `<div class="cl"><a href="${SITE}/wallet/${esc(c[0])}">${esc(short(c[0]))}</a><span>${c[1]} wallets</span><b class="${c[2] >= 10 ? 'dn' : ''}">${c[2]}%</b></div>`).join('')}<p class="dim note">holders first funded by the same wallet, which isn't an exchange or a service that funds wallets across many coins</p>` : '<h3>LINKED CLUSTERS</h3><p class="dim note">none: no private wallet funded two of the top holders</p>';
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
  function scanHolders(H, supply, created, cex = CEX, svc = []) {
    if (!supply || !H) return null;
    cex = { ...CEX, ...(cex || {}) }; const S = new Set(svc || []), pct = x => x.amount / supply * 100, t = s => s ? Date.parse(s) / 1000 : 0;
    H = H.filter(x => !(x.tags || []).some(g => /Pool|Bonding Curve|Vault/.test(g.id || '')));
    const since = created > Date.now() / 1000 - 3 * 86400 ? created - 2 * 86400 : Date.now() / 1000 - 7 * 86400;
    const byF = {}, src = {}; let fresh = 0;
    for (const x of H) {
      const f = x.addressInfo && x.addressInfo.fundingAddress;
      if (!f) { src.unknown = (src.unknown || 0) + 1; continue; }
      if (t(x.addressInfo.fundingBlockTime) >= since) fresh++;
      (byF[f] = byF[f] || []).push(x);
    }
    const cl = [];
    for (const [f, xs] of Object.entries(byF)) {
      const name = cex[f] || (S.has(f) ? 'exchange / service' : null);
      if (name) { src[name] = (src[name] || 0) + xs.length; continue; }
      if (xs.length >= 2) cl.push([f, xs.length, +xs.reduce((a, x) => a + pct(x), 0).toFixed(2)]); else src.independent = (src.independent || 0) + 1;
    }
    cl.sort((a, b) => b[2] - a[2]); src.linked = cl.reduce((a, c) => a + c[1], 0);
    return { lk: +cl.reduce((a, c) => a + c[2], 0).toFixed(2), cl: cl.slice(0, 5), fresh, n: H.length,
      src: Object.fromEntries(Object.entries(src).filter(([, v]) => v).sort((a, b) => b[1] - a[1])) };
  }
  return { esc, num, short, SITE, bnow, bundOf, scanHolders, vd, tiles, funding, beforeBuy };
})();
