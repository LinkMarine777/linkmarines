// The token page's launch radar: for a stonkfun launch from the last 24 h that the radar scored (terminal/launches.json),
// its score with CLOBr's and Compound's, a LAUNCH RADAR panel (the numbers behind the score, Token Info tiles, who funded the top
// holders) and BEFORE YOU BUY above the swap. Any other coin: nothing shows. The pieces come from launches/scan.js.
(() => {
  const CA = ((new URLSearchParams(location.search).get('ca') || '').trim().match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/) || ['F8Sc8HoZvJcMrTY6vBsetTqGPv6XQmM2XgVAZo1sSTNK'])[0];
  const SRC = ['https://raw.githubusercontent.com/LinkMarine777/linkmarines/data/terminal/launches.json', 'https://war-room-bot.linkmarine777.workers.dev/data/terminal/launches.json'];
  const P = document.getElementById('radarP'); if (!P || !window.LRS) return;
  const { esc, num, bundOf } = LRS;
  const ago = t => { const s = Date.now() / 1000 - t; return s < 3600 ? Math.max(1, Math.floor(s / 60)) + 'm' : Math.floor(s / 3600) + 'h'; };
  const stat = (label, v, cls = '') => `<div><label>${label}</label><b class="${cls}">${v}</b></div>`;
  let row = null;

  // the score, with CLOBr's and Compound's (the page's scores box); a click opens the panel
  function score() {
    const r = row, el = document.getElementById('radarStat'); if (!el) return;
    const b = document.getElementById('sRadar'); b.className = 'v-' + r.vd; b.textContent = r.score + ' ' + r.vd;
    document.getElementById('sRadarMsg').textContent = r.vd === 'REAL' ? 'fees + buyers back it' : r.vd === 'FARM' ? 'farmed volume' : r.vd === 'WATCH' ? 'partly backed' : 'thin';
    el.style.display = ''; if (window.syncScores) syncScores();
    el.onclick = () => { P.classList.remove('shut'); P.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  }
  function render() {
    const r = row, fbc = r.fb == null ? '' : r.fb >= 0.6 ? 'up' : r.fb >= 0.45 ? 'am' : 'dn', bund = bundOf(r);
    document.getElementById('radarMeta').textContent = 'launched ' + ago(r.c) + ' ago · updated ' + ago(DATA.at) + ' ago';
    document.getElementById('radarBody').innerHTML = `<div class="lrscan">
      <div class="rtop">${LRS.vd(r)}<span class="dim">${r.vd === 'REAL' ? 'the fees, buyers and holders back the volume' : r.vd === 'FARM' ? 'volume the fees don\'t back' : r.vd === 'WATCH' ? 'some of it checks out' : 'not much trading yet'}</span></div>
      <div class="rstats">
        ${stat('Fee-backed', r.fb == null ? '—' : r.fb.toFixed(2), fbc)}
        ${stat('Org buyers 24h', num(r.ob), r.ob >= 40 ? 'up' : r.ob < 5 ? 'dn' : '')}
        ${stat('Bundled / linked', bund.toFixed(1) + '%', bund >= 20 ? 'dn' : bund >= 10 ? 'am' : 'up')}
        ${stat('Dev', r.dn > 2000 ? 'launch tool' : r.dn ? '👑 ' + num(r.dg) + ' of ' + num(r.dn) : 'first coin', r.dn && r.dn <= 2000 ? (r.dg / r.dn >= 0.2 ? 'up' : r.dn >= 5 && r.dg / r.dn < 0.05 ? 'dn' : '') : '')}
        ${r.vr ? stat('Jupiter VRFD', (r.vr.lane === 'express' ? '⚡ ' : '') + esc(r.vr.st), r.vr.st === 'verified' ? 'up' : r.vr.st === 'rejected' ? 'dn' : 'am') : ''}
      </div>
      <h3>TOKEN INFO</h3>${LRS.tiles(r)}${LRS.funding(r)}
      <p class="dim note">Scored from the coin's first 24 h: Jupiter's data, what it paid its holders, who funded its holders. <a href="/launches/">All new launches ↗</a></p></div>`;
    // BEFORE YOU BUY, right above Jupiter's swap
    const sw = document.getElementById('jupSwap'); let bb = document.getElementById('radarBfb');
    if (sw) { if (!bb) { bb = document.createElement('div'); bb.id = 'radarBfb'; bb.className = 'lrscan'; sw.before(bb); } bb.innerHTML = LRS.beforeBuy(r); }
    P.style.display = ''; score();
  }
  let DATA = null;
  (async () => {
    for (const u of SRC) {
      try { const res = await fetch(u + '?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' }); if (!res.ok) continue;
        DATA = await res.json(); row = (DATA.launches || []).find(x => x.m === CA) || null; break; } catch (e) {}
    }
    if (!row) return;   // not a scored launch from the last 24 h: the page stays as it was
    render();
  })();
})();
