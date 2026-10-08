// BUBBLE MAP: the top 100 holders of a coin as bubbles (size = share of the supply), tied to the wallet that first funded
// them. A linked cluster (one private wallet funded 2+ holders) is a web around its funder; exchanges and services that fund
// wallets everywhere are hubs too, in green; independent wallets float free. Tap a bubble or a funder for who it is and its
// X-Ray. Opens from the 🫧 BUBBLE MAP button in WHO FUNDED THE TOP HOLDERS (launches/scan.js), on the token page and New launches.
// Jupiter doesn't name the bundlers' wallets, so bundles show only as far as they're linked by a funder.
(() => {
  const L = window.LRS; if (!L) return;
  const DAPI = 'https://datapi.jup.ag/v1', NS = 'http://www.w3.org/2000/svg';
  // the four biggest clusters get their own colour (validated on the panel's dark surface: dataviz validate_palette), the
  // rest are hollow red rings; blue independent, green exchanges and services, grey no funding info
  const CC = ['#e5405c', '#a85ee0', '#c0841a', '#00a698'], IND = '#4673f5', EXC = '#6a9f30', UNK = '#4a5578', OTH = '#e5405c';
  const css = `#bm{position:fixed;inset:0;z-index:210;background:rgba(2,3,10,.82);display:flex;align-items:center;justify-content:center;padding:16px}
  #bm .bx{width:min(980px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;background:var(--panel,#0a0f1f);border:1px solid var(--line,#1a2444);border-top:3px solid var(--blue2,#4a7aff);font:12px/1.45 'IBM Plex Mono',monospace;color:var(--txt,#c9d3ee)}
  #bm .hd{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line,#1a2444)}#bm .hd b{color:#fff;letter-spacing:1.5px;font-size:12px}#bm .hd span{color:var(--dim,#5d6a8f);margin-right:auto}
  #bm .x{background:none;border:1px solid var(--line,#1a2444);color:var(--dim,#5d6a8f);width:30px;height:30px;cursor:pointer;font:inherit}#bm .x:hover{color:#fff}
  #bm .lg{display:flex;flex-wrap:wrap;gap:6px 14px;padding:8px 14px;color:var(--dim,#5d6a8f);font-size:11px}#bm .lg i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:-1px}
  #bm .lg button{background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:2px 0}#bm .lg button:hover,#bm .lg button.on{color:#fff}
  #bm .cv{flex:1;min-height:0;display:flex}#bm svg{display:block;width:100%;flex:1;min-height:300px;max-height:72vh;touch-action:none;cursor:grab}#bm svg.drag{cursor:grabbing}
  #bm .nd{cursor:pointer;transition:opacity .15s}#bm .dim .nd:not(.hi),#bm .dim line:not(.hi){opacity:.12}
  #bm text{font:10px 'IBM Plex Mono',monospace;fill:#c9d3ee;pointer-events:none}
  #bm .info{min-height:44px;padding:9px 14px;border-top:1px solid var(--line,#1a2444);font-size:12px}#bm .info a{color:var(--blue2,#4a7aff)}#bm .info b{color:#fff}
  #bm .ld{padding:60px 0;text-align:center;color:var(--dim,#5d6a8f)}
  @media (max-width:760px){#bm{padding:0;align-items:stretch}#bm .bx{max-height:none;height:100%;border-left:0;border-right:0}#bm .hd span{display:none}#bm .hd b{margin-right:auto}#bm .cv{flex:1;display:flex}#bm svg{height:100%}}`;
  const pc = v => (v < 0.01 ? '<0.01' : v.toFixed(2)) + '%', sh = L.short;
  const el = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };

  // the graph: holder bubbles + funder hubs, laid out by a small force simulation (repel, springs to the funder, pull to centre)
  function build(sc) {
    const clIx = {}; (sc.cl || []).forEach((c, i) => clIx[c[0]] = i);
    const N = [], E = [], hubs = {};
    const hub = (f, kind, label) => hubs[f] || (hubs[f] = (N.push({ id: f, hub: true, k: kind, label, p: 0, n: 0, r: 6 }), N[N.length - 1]));
    for (const [a, p, k, f, name] of sc.w) {
      const n = { id: a, p, k, f, r: Math.max(3.5, Math.sqrt(p) * 9) };
      if (k === 'c') { const i = clIx[f]; n.col = i < CC.length ? CC[i] : OTH; n.ring = !(i < CC.length); n.cl = i; }
      else n.col = k === 'i' ? IND : k === 'u' ? UNK : EXC;
      N.push(n);
      if (k === 'c' || k === 'x' || k === 's') {
        const h = hub(f, k, k === 'c' ? null : name); h.p += p; h.n++; if (k === 'c') { h.col = n.col; h.ring = n.ring; h.cl = n.cl; } else h.col = EXC;
        E.push([h, n]);
      }
    }
    N.filter(n => n.hub).forEach(h => h.r = 5 + Math.min(6, h.n));
    // start: hubs on a ring, their holders around them, free wallets scattered
    const H = N.filter(n => n.hub);
    H.forEach((h, i) => { const a = i / H.length * Math.PI * 2; h.x = Math.cos(a) * 220; h.y = Math.sin(a) * 160; });
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
    N.forEach(n => { if (n.hub) return; const h = n.f && hubs[n.f]; n.x = (h ? h.x : 0) + rnd() * (h ? 60 : 420); n.y = (h ? h.y : 0) + rnd() * (h ? 60 : 320); });
    for (let it = 0, alpha = 1; it < 320; it++, alpha *= 0.985) {
      for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
        const a = N[i], b = N[j]; let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy || 0.01, d = Math.sqrt(d2);
        const min = a.r + b.r + 3, f = (380 / d2 + (d < min ? (min - d) * 0.5 : 0)) * alpha;
        dx /= d; dy /= d; a.x -= dx * f; a.y -= dy * f; b.x += dx * f; b.y += dy * f;
      }
      for (const [h, n] of E) {
        const dx = n.x - h.x, dy = n.y - h.y, d = Math.hypot(dx, dy) || 0.01, want = h.r + n.r + 14, f = (d - want) * 0.08 * alpha;
        n.x -= dx / d * f; n.y -= dy / d * f; h.x += dx / d * f * 0.3; h.y += dy / d * f * 0.3;
      }
      N.forEach(n => { n.x *= 1 - 0.012 * alpha; n.y *= 1 - 0.012 * alpha; });
    }
    return { N, E, hubs };
  }

  function draw(box, sc, mint) {
    const { N, E } = build(sc);
    const pad = 20, x0 = Math.min(...N.map(n => n.x - n.r)) - pad, y0 = Math.min(...N.map(n => n.y - n.r)) - pad,
      x1 = Math.max(...N.map(n => n.x + n.r)) + pad, y1 = Math.max(...N.map(n => n.y + n.r)) + pad;
    const svg = el('svg', { viewBox: `${x0} ${y0} ${x1 - x0} ${y1 - y0}`, role: 'img', 'aria-label': 'Bubble map of the top holders and who funded them' });
    const g = el('g', {}); svg.appendChild(g);
    E.forEach(([h, n]) => { const l = el('line', { x1: h.x, y1: h.y, x2: n.x, y2: n.y, stroke: n.col, 'stroke-opacity': .45, 'stroke-width': 1 }); l._e = [h, n]; g.appendChild(l); });
    N.forEach(n => {
      const c = n.hub ? el('rect', { x: n.x - n.r, y: n.y - n.r, width: n.r * 2, height: n.r * 2, rx: 2, fill: '#0a0f1f', stroke: n.col, 'stroke-width': 2, transform: `rotate(45 ${n.x} ${n.y})` })
        : el('circle', { cx: n.x, cy: n.y, r: n.r, fill: n.ring ? 'none' : n.col, 'fill-opacity': .85, stroke: n.ring ? OTH : '#0a0f1f', 'stroke-width': n.ring ? 1.5 : 1 });
      c.classList.add('nd'); c._n = n; g.appendChild(c);
      if (n.hub && n.k === 'c' && n.cl < CC.length) { const t = el('text', { x: n.x + n.r + 4, y: n.y + 3 }); t.textContent = pc(n.p); g.appendChild(t); }
      if (n.hub && n.k === 'x') { const t = el('text', { x: n.x + n.r + 4, y: n.y + 3 }); t.textContent = n.label; g.appendChild(t); }   // named exchanges only: services show on a tap
    });
    box.querySelector('.cv').replaceChildren(svg);
    const fit = () => { const v = svg.viewBox.baseVal, k = Math.max(v.width / (svg.clientWidth || 1), v.height / (svg.clientHeight || 1)); svg.querySelectorAll('text').forEach(t => t.style.fontSize = (10.5 * k) + 'px'); };   // labels stay 10.5px on screen
    fit(); svg.addEventListener('wheel', () => requestAnimationFrame(fit));
    const info = box.querySelector('.info'), S = L.SITE;
    const xr = a => `<a href="${S}/wallet/${L.esc(a)}">X-Ray ↗</a>`;
    const focus = (pred, html) => {
      svg.classList.toggle('dim', !!pred);
      svg.querySelectorAll('.nd').forEach(c => c.classList.toggle('hi', !!pred && pred(c._n)));
      svg.querySelectorAll('line').forEach(l => l.classList.toggle('hi', !!pred && pred(l._e[1])));
      info.innerHTML = html || 'Tap a bubble (a holder) or a ◆ (the wallet that funded it).';
    };
    svg.addEventListener('click', e => {
      if (moved) return;
      const n = e.target._n; if (!n) return focus(null);
      if (n.hub) {
        const what = n.k === 'c' ? `<b>linked cluster</b>: this private wallet first funded <b>${n.n}</b> of the top holders, together <b>${pc(n.p)}</b> of the supply`
          : `<b>${L.esc(n.label)}</b>: funded ${n.n} of the top holders (${pc(n.p)}). It funds wallets across many coins, so it doesn't link them`;
        focus(x => x === n || x.f === n.id, `◆ <b>${sh(n.id)}</b> · ${what} · ${xr(n.id)}`);
      } else {
        const by = n.k === 'c' ? `funded by <b>${sh(n.f)}</b>, a private wallet that funded ${E.filter(([h]) => h.id === n.f).length} of the top holders`
          : n.k === 'x' || n.k === 's' ? `funded from <b>${L.esc(N.find(x => x.id === n.f)?.label || 'an exchange')}</b>` : n.k === 'i' ? 'funded by a wallet that funded no other top holder' : 'no funding info from Jupiter';
        focus(x => x === n || (n.f && (x.id === n.f || x.f === n.f) && n.k !== 'i'), `<b>${sh(n.id)}</b> holds <b>${pc(n.p)}</b> · ${by} · ${xr(n.id)}`);
      }
    });
    // drag to pan, wheel / pinch-less zoom with the wheel; on phones a one-finger pan
    let vb = svg.viewBox.baseVal, start = null, moved = false;
    svg.addEventListener('pointerdown', e => { start = [e.clientX, e.clientY, vb.x, vb.y, e.pointerId]; moved = false; });
    svg.addEventListener('pointermove', e => { if (!start) return; const k = vb.width / svg.clientWidth, dx = e.clientX - start[0], dy = e.clientY - start[1];
      if (!moved && Math.abs(dx) + Math.abs(dy) > 4) { moved = true; svg.classList.add('drag'); svg.setPointerCapture(start[4]); } if (moved) { vb.x = start[2] - dx * k; vb.y = start[3] - dy * k; } });
    svg.addEventListener('pointerup', () => { start = null; svg.classList.remove('drag'); setTimeout(() => moved = false, 0); });
    svg.addEventListener('wheel', e => { e.preventDefault(); const f = e.deltaY > 0 ? 1.12 : 1 / 1.12, r = svg.getBoundingClientRect(),
      px = vb.x + (e.clientX - r.left) / r.width * vb.width, py = vb.y + (e.clientY - r.top) / r.height * vb.height;
      vb.x = px - (px - vb.x) * f; vb.y = py - (py - vb.y) * f; vb.width *= f; vb.height *= f; }, { passive: false });
    // the legend: tap one to show only that group
    const groups = [...(sc.cl || []).slice(0, CC.length).map((c, i) => [CC[i], `cluster ${i + 1} · ${pc(c[2])}`, n => n.f === c[0]]),
      ...((sc.cl || []).length > CC.length ? [['ring', `${sc.cl.length - CC.length} smaller clusters`, n => n.k === 'c' && n.cl >= CC.length]] : []),
      [EXC, 'exchanges / services', n => n.k === 'x' || n.k === 's'], [IND, 'independent', n => n.k === 'i'], [UNK, 'no funding info', n => n.k === 'u']];
    const lg = box.querySelector('.lg');
    lg.innerHTML = groups.map(([c, t], i) => `<button type="button" data-i="${i}"><i style="${c === 'ring' ? 'border:1.5px solid ' + OTH : 'background:' + c}"></i>${t}</button>`).join('');
    lg.onclick = e => { const b = e.target.closest('button'); if (!b) return; const on = !b.classList.contains('on'); lg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      if (on) { b.classList.add('on'); const [, t, pred] = groups[+b.dataset.i]; focus(n => !n.hub ? pred(n) : N.some(x => !x.hub && x.f === n.id && pred(x)), `showing <b>${t}</b>`); } else focus(null); };
    focus(null);
  }

  async function open(mint, sc) {
    if (document.getElementById('bm')) return;
    if (!document.getElementById('bmCss')) { const st = document.createElement('style'); st.id = 'bmCss'; st.textContent = css; document.head.appendChild(st); }
    const w = document.createElement('div'); w.id = 'bm'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); w.setAttribute('aria-label', 'Bubble map');
    w.innerHTML = `<div class="bx"><div class="hd"><b>🫧 BUBBLE MAP</b><span>top holders · bubble size = share of the supply · ◆ = the wallet that funded them</span><button class="x" type="button" aria-label="Close">✕</button></div>
      <div class="lg"></div><div class="cv"><div class="ld">scanning the top holders…</div></div><div class="info"></div></div>`;
    document.body.appendChild(w);
    const close = () => { w.remove(); removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') close(); };
    addEventListener('keydown', esc);
    w.addEventListener('click', e => { if (e.target === w || e.target.closest('.x')) close(); });
    try {
      if (!sc || !sc.w) {   // a scan without the holders (the radar's): scan them now
        const [A, H] = await Promise.all([fetch(`${DAPI}/assets/search?query=${mint}`).then(r => r.json()), fetch(`${DAPI}/holders/${mint}`).then(r => r.json())]);
        const a = (A || []).find(x => x.id === mint) || {};
        sc = L.scanHolders(H.holders, a.circSupply || a.totalSupply, a.createdAt ? Date.parse(a.createdAt) / 1000 : 0, window.LRS_CEX, window.LRS_SVC);
        sc = await L.vetFunders(sc);   // app / exchange wallets aren't links
      }
      if (!sc || !sc.w || !sc.w.length) throw new Error('no holders');
      draw(w.querySelector('.bx'), sc, mint);
    } catch (e) { w.querySelector('.cv').innerHTML = '<div class="ld">couldn\'t load the holders from Jupiter: try again in a bit</div>'; }
  }
  L.openMap = open;
  // the 🫧 button in WHO FUNDED THE TOP HOLDERS, wherever it's drawn; the page's scan (with the holders) if it has one
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-bm]'); if (!b) return; e.preventDefault(); e.stopPropagation();
    open(b.dataset.bm, (window.LRS_SCANS || {})[b.dataset.bm]);
  });
})();
