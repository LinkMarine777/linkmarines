// The token page's TOKEN INFO, for every coin: the radar score (the same formula as New launches, from the last 24 h of
// trading), Jupiter's Token Info tiles, who funded the top 100 holders and the clusters one private wallet funded (scanned
// here, live from Jupiter's data API, each cluster's funder checked on chain so app and exchange wallets aren't counted as
// links), the 🫧 bubble map, and BEFORE YOU BUY above the swap. The score sits with CLOBr's and Compound's in the scores box.
// A launch the radar scored in its first 24 h (terminal/launches.json) adds its VRFD request and fees per trade.
(() => {
  const CA = ((new URLSearchParams(location.search).get('ca') || '').trim().match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/) || ['F8Sc8HoZvJcMrTY6vBsetTqGPv6XQmM2XgVAZo1sSTNK'])[0];
  const SRC = ['https://raw.githubusercontent.com/LinkMarine777/linkmarines/data/terminal/launches.json', 'https://war-room-bot.linkmarine777.workers.dev/data/terminal/launches.json'];
  const DAPI = 'https://datapi.jup.ag/v1';
  const P = document.getElementById('radarP'); if (!P || !window.LRS) return;
  const { esc, num, bundOf } = LRS;
  const ago = t => { const s = Date.now() / 1000 - t; return s < 3600 ? Math.max(1, Math.floor(s / 60)) + 'm' : s < 172800 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };
  const stat = (label, v, cls = '', tip = '') => `<div${tip ? ` title="${tip}"` : ''}><label>${label}</label><b class="${cls}">${v}</b></div>`;
  const getJ = async u => { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return r.json(); };
  const WHY = { REAL: 'the fees, buyers and holders back the volume', FARM: 'volume the fees don\'t back', WATCH: 'some of it checks out', THIN: 'not much real trading in the last 24 h' };

  // what holders were paid in the last 24 h, from the page's own payouts data (a reward coin): fee-backed = paid ÷ tax ÷ volume
  const paid24 = () => new Promise(res => {
    let n = 0; const t = setInterval(() => {
      let r = null; try { r = typeof rewards !== 'undefined' ? rewards : null; } catch (e) {}
      if (r || document.body.classList.contains('norew') || ++n > 40) { clearInterval(t); res(r); }   // norew: no holder rewards
    }, 250);
  });
  function fbOf(r, vol) {
    const w = r && r.window24h, tax = r && r.transferTaxBps;
    if (!w || !w.complete || !tax || !vol || !(r.distributedTokens > 0)) return null;
    return +(w.tokens * (r.distributedUsd / r.distributedTokens) / (tax / 1e4) / vol).toFixed(2);
  }
  // Jupiter's asset + our scan (+ a scored launch's radar row) → the row scan.js draws, scored live
  function rowOf(a, sc, L, rw, PA) {
    const au = a.audit || {}, bs = au.bundlerStats || {}, st = a.stats24h || {};
    const dn = Math.max(0, (au.devMints || 1) - 1), dg = Math.max(0, (au.devMigrations || 0) - (a.graduatedPool ? 1 : 0));
    const jv = (st.buyVolume || 0) + (st.sellVolume || 0), ov = (st.buyOrganicVolume || 0) + (st.sellOrganicVolume || 0);
    const r = { ...(L || {}), m: CA, top: au.topHoldersPercentage == null ? null : +au.topHoldersPercentage.toFixed(2), bpk: +(bs.holdingPctATH || 0).toFixed(1),
      bh: +(bs.holdingPct || 0).toFixed(1), bot: +(au.botHoldersPercentage || 0).toFixed(1), fees: a.fees == null ? null : +a.fees.toFixed(2),
      os: +(a.organicScore || 0).toFixed(1), ob: st.numOrganicBuyers || 0, h: a.holderCount || 0, dn, dg,
      scan: sc && { ...sc, sn: +(au.sniperPct || 0).toFixed(2), in: +(au.insiderPct || 0).toFixed(2) } };
    r.fb = fbOf(rw, jv); if (r.fb == null && L) r.fb = L.fb;   // a launch's first 24 h: the radar's own figure
    // the drop from the peak: a launch's peak from stonkfun (the radar), today's market cap from Jupiter
    // what the price did: a launch's from the radar (5-minute candles), any other coin's from its whole price history
    if (a.mcap) r.mc = a.mcap;
    const pa = (L && L.pa) || PA || null; r.pa = pa; if (!L && pa) r.pk = pa.pk;
    const dd = pa ? pa.dd : r.pk ? Math.max(0, 1 - r.mc / r.pk) : 0;
    const s = LRS.score({ ob: r.ob, fb: r.fb, jv, ov, bund: bundOf(r), dn, dg, audit: !!a.audit, h: r.h, top: r.top, fpt: L ? L.fpt : null, vol: jv, dd, pa, pk: r.pk || 0, bpk: r.bpk, bh: r.bh });
    return Object.assign(r, s);
  }
  // the score in the scores box (with CLOBr's and Compound's); a click opens TOKEN INFO
  function score(r) {
    const el = document.getElementById('radarStat'); if (!el) return;
    const b = document.getElementById('sRadar'); b.className = 'v-' + r.vd; b.textContent = r.score;
    const m = document.getElementById('sRadarMsg'); m.innerHTML = `<i class="v-${esc(r.vd)}">${esc(r.vd)}</i>`; m.title = WHY[r.vd];
    el.style.display = ''; if (window.syncScores) syncScores();
    el.onclick = () => { if (window.rtab) rtab('info'); P.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  }
  function render(r, L, checking) {
    const bund = bundOf(r), fbc = r.fb == null ? '' : r.fb >= 0.6 ? 'up' : r.fb >= 0.45 ? 'am' : 'dn';
    const dev = stat('Dev', r.dn > 2000 ? 'launch tool' : r.dn ? '👑 ' + num(r.dg) + ' of ' + num(r.dn) : 'first coin', r.dn && r.dn <= 2000 ? (r.dg / r.dn >= 0.2 ? 'up' : r.dn >= 5 && r.dg / r.dn < 0.05 ? 'dn' : '') : '');
    const sc = r.scan, chk = checking ? ' · checking funders…' : sc && sc.apps ? ` · ${sc.apps} app / exchange wallet${sc.apps === 1 ? '' : 's'} not counted` : '';
    document.getElementById('radarMeta').textContent = (L ? 'launched ' + ago(L.c) + ' ago' : 'last 24 h · live from Jupiter') + chk;
    document.getElementById('radarBody').innerHTML = `<div class="lrscan">
      <div class="rtop">${LRS.vd(r)}<span class="dim">${r.pnd ? 'a pump and dump: up fast after launch, half of it gone within the hour' : r.dumped ? `the trading was real, but it's down ${Math.round((r.pa ? r.pa.dd : 1 - r.mc / r.pk) * 100)}% from its peak` : WHY[r.vd]}</span></div>
      <div class="rstats">
        ${r.fb != null ? stat('Fee-backed', r.fb.toFixed(2), fbc, 'what holders were paid in 24 h ÷ the tax ÷ the 24 h volume: real trading comes out near 1.0') : stat('Organic volume', r.org == null ? '—' : r.org + '%', r.org >= 8 ? 'up' : r.org < 2 ? 'dn' : '', 'Jupiter\'s organic share of the 24 h volume (no payouts to check)')}
        ${stat('Org buyers 24h', num(r.ob), r.ob >= 40 ? 'up' : r.ob < 5 ? 'dn' : '')}
        ${stat('Bundled / linked', bund.toFixed(1) + '%', bund >= 20 ? 'dn' : bund >= 10 ? 'am' : 'up')}${dev}
        ${r.vr ? stat('Jupiter VRFD', (r.vr.lane === 'express' ? '⚡ ' : '') + esc(r.vr.st), r.vr.st === 'verified' ? 'up' : r.vr.st === 'rejected' ? 'dn' : 'am') : ''}
      </div>
      <h3>TOKEN INFO</h3>${LRS.tiles(r)}${LRS.funding(r)}
      ${checking ? '<p class="dim note">checking each cluster\'s funder on chain: app and exchange wallets (Fomo, pump.fun, onramps) fund thousands of wallets and don\'t count as links…</p>' : ''}
      <p class="dim note">Scored ${L ? 'from the coin\'s first 24 h and' : ''} from the last 24 h of trading, the same way as <a href="/launches/">New launches ↗</a>. Not financial advice.</p></div>`;
    // BEFORE YOU BUY, right above Jupiter's swap
    const sw = document.getElementById('jupSwap'); let bb = document.getElementById('radarBfb');
    if (sw) { if (!bb) { bb = document.createElement('div'); bb.id = 'radarBfb'; bb.className = 'lrscan'; sw.before(bb); } bb.innerHTML = LRS.beforeBuy(r); }
    P.style.display = ''; if (window.rtabs) rtabs();
    score(r);
  }
  let DATA = null;
  (async () => {
    const radar = (async () => { for (const u of SRC) { try { const r = await fetch(u + '?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (e) {} } return null; })();
    const [asset, holders] = await Promise.all([
      getJ(`${DAPI}/assets/search?query=${CA}`).then(L => (L || []).find(x => x.id === CA) || null).catch(() => null),
      getJ(`${DAPI}/holders/${CA}`).then(d => d.holders || null).catch(() => null)]);
    DATA = await radar;
    const L = DATA && (DATA.launches || []).find(x => x.m === CA) || null;
    if (!asset) { if (L) render(L, L); return; }   // Jupiter didn't answer: a scored launch still shows the radar's copy
    const created = asset.createdAt ? Date.parse(asset.createdAt) / 1000 : (L && L.c) || 0;
    window.LRS_CEX = DATA && DATA.cex; window.LRS_SVC = DATA && DATA.svc;
    let sc = LRS.scanHolders(holders, asset.circSupply || asset.totalSupply, created, window.LRS_CEX, window.LRS_SVC) || null;
    let rw = null; try { rw = typeof rewards !== 'undefined' ? rewards : null; } catch (e) {}
    let PA = null;
    // its whole life, at a resolution that fits its age: 5-minute candles under 2 days, hourly under 30, daily back to launch
    const age = Date.now() / 1000 - (created || 0), [iv, n] = age < 2 * 86400 ? ['5_MINUTE', 600] : age < 30 * 86400 ? ['1_HOUR', 720] : ['1_DAY', 1000];
    if (!(L && L.pa)) PA = await getJ(`https://datapi.jup.ag/v2/charts/${CA}?interval=${iv}&to=${Date.now()}&candles=${n}&type=mcap&quote=usd`)
      .then(d => LRS.priceAction(d.candles, created)).catch(() => null);
    const show = (s, checking) => { (window.LRS_SCANS = window.LRS_SCANS || {})[CA] = s; render(rowOf(asset, s, L, rw, PA), L, checking); };
    show(sc, !!(sc && sc.cl.length));
    // then again with the payouts (when they land) and app / exchange wallets taken out of the links
    const [v, r2] = await Promise.all([sc && sc.cl.length ? LRS.vetFunders(sc) : sc, rw ? rw : paid24()]);
    rw = r2; show(v, false);
  })();
})();
