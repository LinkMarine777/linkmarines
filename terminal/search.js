// Token search for the terminal's search box (#caIn in #caForm): paste a CA as before, or type a $TICKER / name.
// Names come from Jupiter's token search, stonkfun launches only (launchpad "stonkfun"), Jupiter-verified first, then by
// market cap. Enter opens the top match; arrows + Enter or a click pick another. A pasted CA is left to the page's own handler.
(() => {
  const form = document.getElementById('caForm'), inp = document.getElementById('caIn'); if (!form || !inp) return;
  const CA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, open = m => { location.href = '/terminal/token?ca=' + encodeURIComponent(m); };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mc = v => !v ? '' : '$' + (v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v.toFixed(0));
  const st = document.createElement('style');
  st.textContent = `#t7s{position:absolute;left:0;right:0;top:100%;margin-top:3px;z-index:80;display:none;background:var(--panel2,#0d1428);border:1px solid var(--line,#1a2444);box-shadow:0 12px 30px rgba(0,0,0,.6);max-height:min(60vh,420px);overflow:auto}
#t7s.open{display:block}#t7s a{display:flex;align-items:center;gap:9px;padding:7px 10px;color:var(--txt,#c9d3ee);text-decoration:none;font-size:12px;border-bottom:1px solid rgba(26,36,68,.6)}
#t7s a:last-child{border-bottom:0}#t7s a.on,#t7s a:hover{background:rgba(74,122,255,.14);color:#fff}#t7s img{width:22px;height:22px;border-radius:50%;background:#111;flex:none;object-fit:cover}
#t7s b{color:#fff;font-weight:600}#t7s .n{color:var(--dim,#5d6a8f);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}#t7s .v{color:var(--green,#39ff6a);font-size:11px}
#t7s .m{color:var(--txt,#c9d3ee);font-size:11px;flex:none}
.t7w{position:relative;flex:1;min-width:120px;display:flex}.t7w input{flex:1;min-width:0}
#caForm .t7p{position:absolute;top:50%;bottom:auto;left:auto;width:28px;height:28px;display:grid;place-items:center;transform:translateY(-50%);z-index:2;border:0;border-radius:6px;background:none;color:var(--dim,#5d6a8f);padding:0;cursor:pointer}#caForm .t7p svg{width:16px;height:16px;fill:currentColor}#caForm .t7p:hover{color:#fff;background:rgba(74,122,255,.14)}#caForm .t7p:hover{color:#fff;border-color:var(--blue2,#4a7aff)}#t7s .x{padding:9px 10px;color:var(--dim,#5d6a8f);font-size:12px}`;
  document.head.appendChild(st);
  const box = document.createElement('div'); box.id = 't7s'; box.setAttribute('role', 'listbox');
  inp.placeholder = 'Search';   // a $TICKER, a name, or a pasted CA
  // PASTE: a CA opens straight away, anything else is searched. The box starts empty (and again on Back) for the next search
  const wrap = inp.parentElement.classList.contains('srch') ? inp.parentElement : (() => {
    const w = document.createElement('span'); w.className = 't7w'; inp.parentNode.insertBefore(w, inp); w.appendChild(inp); return w; })();
  const pb = document.createElement('button'); pb.type = 'button'; pb.className = 't7p'; pb.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 2h-4.18C14.4.84 13.3 0 12 0S9.6.84 9.18 2H5a2 2 0 00-2 2v16a2 2 0 002 2h14a2 2 0 002-2V4a2 2 0 00-2-2zm-7 0a1 1 0 110 2 1 1 0 010-2zm7 18H5V4h2v3h10V4h2z"/></svg>'; pb.title = 'Paste a CA or ticker'; pb.setAttribute('aria-label', 'Paste');
  pb.style.right = wrap.querySelector('button[type="submit"]') ? '34px' : '4px'; inp.style.setProperty('padding-right', (parseInt(pb.style.right) + 32) + 'px', 'important');
  wrap.appendChild(pb); wrap.appendChild(box);
  pb.addEventListener('click', async () => {
    let v = ''; try { v = (await navigator.clipboard.readText() || '').trim(); } catch (e) {}
    if (!v) { inp.focus(); const m = document.getElementById('tkMsg'); if (m) m.textContent = 'long-press the box and paste'; return; }
    if (CA.test(v)) return open(v);
    inp.value = v.slice(0, 60); inp.focus(); inp.dispatchEvent(new Event('input'));
  });
  window.addEventListener('pageshow', () => { inp.value = ''; list = []; show(''); });
  let list = [], sel = 0, seq = 0, timer = null;
  const show = html => { box.innerHTML = html; box.classList.toggle('open', !!html); };
  const draw = () => show(list.length ? list.map((t, i) => `<a href="/terminal/token?ca=${encodeURIComponent(t.id)}" data-i="${i}" class="${i === sel ? 'on' : ''}" role="option">` +
    `<img src="${esc(t.icon || '/helmet.png')}" alt="" loading="lazy" onerror="this.src='/helmet.png'"><b>$${esc(t.symbol)}</b>${t.isVerified ? '<span class="v" title="Verified on Jupiter">✓</span>' : ''}` +
    `<span class="n">${esc(t.name)}</span><span class="m">${mc(t.mcap)}</span></a>`).join('') : '<div class="x">no stonkfun token matches</div>');
  // the stonkfun tokens the site already tracks (Stonk Board top 100 + stonkfun's top 30): tickers match instantly and still
  // work when Jupiter is slow or busy; Jupiter adds names, the verified tick and anything newer
  const DATA = 'https://war-room-bot.linkmarine777.workers.dev/data/terminal/';
  let local = null;
  const loadLocal = () => local || (local = Promise.allSettled([fetch(DATA + 'board.json').then(r => r.json()), fetch(DATA + 'tokens.json').then(r => r.json())]).then(([bd, tk]) => {
    const m = new Map();
    for (const [id, t] of Object.entries(bd.value?.tokens || {})) m.set(id, { id, symbol: t.symbol, name: '', mcap: t.mcap, icon: 'https://thestonkboard.com/api/logos/' + id });
    for (const t of tk.value?.tokens || []) m.set(t.mint, { ...(m.get(t.mint) || {}), id: t.mint, symbol: t.symbol, name: '', mcap: t.mcap, icon: t.image || m.get(t.mint)?.icon });
    return [...m.values()].filter(t => t.symbol);
  }).catch(() => []));
  const rank = L => L.sort((a, b) => (!!b.isVerified - !!a.isVerified) || ((b.mcap || 0) - (a.mcap || 0))).slice(0, 8);
  async function search(q) {
    const n = ++seq, ql = q.toLowerCase();
    const mine = (await loadLocal()).filter(t => t.symbol.toLowerCase().startsWith(ql));
    if (n !== seq) return;
    if (mine.length) { list = rank([...mine]); sel = 0; draw(); }
    let jup = [];
    try { const L = await (await fetch('https://lite-api.jup.ag/tokens/v2/search?query=' + encodeURIComponent(q))).json(); jup = (Array.isArray(L) ? L : []).filter(t => t.launchpad === 'stonkfun'); } catch (e) {}
    if (n !== seq) return;
    const m = new Map(mine.map(t => [t.id, t])); for (const t of jup) m.set(t.id, { ...(m.get(t.id) || {}), ...t });
    list = rank([...m.values()]); sel = 0; draw();
  }
  inp.addEventListener('input', () => {
    clearTimeout(timer); const q = inp.value.trim().replace(/^\$/, '');
    if (!q || CA.test(q)) { seq++; list = []; show(''); return; }
    if (q.length < 2) return;
    timer = setTimeout(() => search(q), 220);
  });
  inp.addEventListener('keydown', e => {
    if (!box.classList.contains('open') || !list.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length; draw(); }
    else if (e.key === 'Escape') show('');
  });
  inp.addEventListener('focus', () => { loadLocal(); if (list.length) draw(); });
  document.addEventListener('click', e => { if (!box.contains(e.target) && e.target !== inp) show(''); });
  // Enter on a name opens the highlighted match; runs before the page's own CA-only submit handler
  window.addEventListener('submit', e => {
    if (e.target !== form) return;
    const v = inp.value.trim(); if (CA.test(v)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (list[sel]) open(list[sel].id);
    else if (v) { const m = document.getElementById('tkMsg'); if (m) m.textContent = 'type a $TICKER or name, or paste a token CA'; }
  }, true);
})();
