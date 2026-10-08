// The token page's TOKEN INFO, for every coin: Jupiter's Token Info tiles (as on jup.ag), who funded the top 100 holders and
// the clusters one private wallet funded (scanned here, live from Jupiter's data API), and BEFORE YOU BUY above the swap.
// A stonkfun launch the radar scored in its first 24 h (terminal/launches.json) also gets its radar score, with CLOBr's and
// Compound's in the scores box, and the numbers behind it. The pieces come from launches/scan.js.
(() => {
  const CA = ((new URLSearchParams(location.search).get('ca') || '').trim().match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/) || ['F8Sc8HoZvJcMrTY6vBsetTqGPv6XQmM2XgVAZo1sSTNK'])[0];
  const SRC = ['https://raw.githubusercontent.com/LinkMarine777/linkmarines/data/terminal/launches.json', 'https://war-room-bot.linkmarine777.workers.dev/data/terminal/launches.json'];
  const DAPI = 'https://datapi.jup.ag/v1';
  const P = document.getElementById('radarP'); if (!P || !window.LRS) return;
  const { esc, num, bundOf } = LRS;
  const ago = t => { const s = Date.now() / 1000 - t; return s < 3600 ? Math.max(1, Math.floor(s / 60)) + 'm' : s < 172800 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };
  const stat = (label, v, cls = '') => `<div><label>${label}</label><b class="${cls}">${v}</b></div>`;
  const getJ = async u => { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return r.json(); };

  // the radar's score in the scores box (with CLOBr's and Compound's); a click opens TOKEN INFO
  function score(r) {
    const el = document.getElementById('radarStat'); if (!el) return;
    const b = document.getElementById('sRadar'); b.className = 'v-' + r.vd; b.textContent = r.score;
    const m = document.getElementById('sRadarMsg'); m.innerHTML = `<i class="v-${esc(r.vd)}">${esc(r.vd)}</i>`;
    m.title = r.vd === 'REAL' ? 'fees + buyers back it' : r.vd === 'FARM' ? 'farmed volume' : r.vd === 'WATCH' ? 'partly backed' : 'thin';
    el.style.display = ''; if (window.syncScores) syncScores();
    el.onclick = () => { if (window.rtab) rtab('info'); P.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  }
  // Jupiter's asset (audit, stats, fees) + our scan → the row scan.js draws; a scored launch's own numbers on top
  function rowOf(a, sc, L) {
    const au = a.audit || {}, bs = au.bundlerStats || {}, st = a.stats24h || {};
    const dn = Math.max(0, (au.devMints || 1) - 1), dg = Math.max(0, (au.devMigrations || 0) - (a.graduatedPool ? 1 : 0));
    const live = { m: CA, top: au.topHoldersPercentage == null ? null : +au.topHoldersPercentage.toFixed(2), bpk: +(bs.holdingPctATH || 0).toFixed(1),
      bh: +(bs.holdingPct || 0).toFixed(1), bot: +(au.botHoldersPercentage || 0).toFixed(1), fees: a.fees == null ? null : +a.fees.toFixed(2),
      os: +(a.organicScore || 0).toFixed(1), ob: st.numOrganicBuyers || 0, h: a.holderCount || 0, dn, dg,
      scan: sc && { ...sc, sn: +(au.sniperPct || 0).toFixed(2), in: +(au.insiderPct || 0).toFixed(2) } };
    return L ? { ...L, ...Object.fromEntries(Object.entries(live).filter(([, v]) => v != null)), score: L.score, vd: L.vd, fb: L.fb, vr: L.vr } : live;
  }
  function render(r, a, launch) {
    const bund = bundOf(r), fbc = r.fb == null ? '' : r.fb >= 0.6 ? 'up' : r.fb >= 0.45 ? 'am' : 'dn';
    const dev = stat('Dev', r.dn > 2000 ? 'launch tool' : r.dn ? '👑 ' + num(r.dg) + ' of ' + num(r.dn) : 'first coin', r.dn && r.dn <= 2000 ? (r.dg / r.dn >= 0.2 ? 'up' : r.dn >= 5 && r.dg / r.dn < 0.05 ? 'dn' : '') : '');
    const bl = stat('Bundled / linked', bund.toFixed(1) + '%', bund >= 20 ? 'dn' : bund >= 10 ? 'am' : 'up');
    document.getElementById('radarMeta').textContent = launch ? 'launched ' + ago(launch.c) + ' ago · radar ' + ago(DATA.at) + ' ago' : 'live from Jupiter';
    document.getElementById('radarBody').innerHTML = `<div class="lrscan">
      ${launch ? `<div class="rtop">${LRS.vd(r)}<span class="dim">${r.vd === 'REAL' ? 'the fees, buyers and holders back the volume' : r.vd === 'FARM' ? 'volume the fees don\'t back' : r.vd === 'WATCH' ? 'some of it checks out' : 'not much trading yet'}</span></div>` : ''}
      <div class="rstats">
        ${launch ? stat('Fee-backed', r.fb == null ? '—' : r.fb.toFixed(2), fbc) : stat('Holders', num(r.h))}
        ${stat('Org buyers 24h', num(r.ob), r.ob >= 40 ? 'up' : r.ob < 5 ? 'dn' : '')}
        ${bl}${dev}
        ${r.vr ? stat('Jupiter VRFD', (r.vr.lane === 'express' ? '⚡ ' : '') + esc(r.vr.st), r.vr.st === 'verified' ? 'up' : r.vr.st === 'rejected' ? 'dn' : 'am') : ''}
      </div>
      <h3>TOKEN INFO</h3>${LRS.tiles(r)}${LRS.funding(r)}
      <p class="dim note">${launch ? 'Scored from the coin\'s first 24 h: Jupiter\'s data, what it paid its holders, who funded its holders. ' : 'Jupiter\'s data, and who first funded each of the top 100 holders. '}<a href="/launches/">New launches ↗</a></p></div>`;
    // BEFORE YOU BUY, right above Jupiter's swap
    const sw = document.getElementById('jupSwap'); let bb = document.getElementById('radarBfb');
    if (sw) { if (!bb) { bb = document.createElement('div'); bb.id = 'radarBfb'; bb.className = 'lrscan'; sw.before(bb); } bb.innerHTML = LRS.beforeBuy(r); }
    P.style.display = ''; if (window.rtabs) rtabs();
    if (launch) score(r);
  }
  let DATA = null;
  (async () => {
    const radar = (async () => { for (const u of SRC) { try { const r = await fetch(u + '?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (e) {} } return null; })();
    const [asset, holders] = await Promise.all([
      getJ(`${DAPI}/assets/search?query=${CA}`).then(L => (L || []).find(x => x.id === CA) || null).catch(() => null),
      getJ(`${DAPI}/holders/${CA}`).then(d => d.holders || null).catch(() => null)]);
    DATA = await radar;
    const L = DATA && (DATA.launches || []).find(x => x.m === CA) || null;
    if (!asset) { if (L) render(L, null, L); return; }   // Jupiter didn't answer: a scored launch still shows the radar's copy
    const created = asset.createdAt ? Date.parse(asset.createdAt) / 1000 : (L && L.c) || 0;
    const sc = LRS.scanHolders(holders, asset.circSupply || asset.totalSupply, created, DATA && DATA.cex, DATA && DATA.svc) || (L && L.scan) || null;
    render(rowOf(asset, sc, L), asset, L);
  })();
})();
