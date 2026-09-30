// Live viewer count. Every open page checks in with the bot once a minute (only while the tab is visible); the bot answers
// how many were seen across the whole site in the last 2.5 min. With data-ui="0" on the script tag (stream, HQ) the page is
// only counted; otherwise the count shows in the LIVE badge ("LIVE · 42 watching"), and pages without one get the badge.
(() => {
  const me = document.currentScript, ui = !me || me.dataset.ui !== '0';
  const BOT = 'https://war-room-bot.linkmarine777.workers.dev';
  let id = ''; try { id = sessionStorage.getItem('t7vid') || ''; } catch (e) {}
  if (!/^[A-Za-z0-9]{16}$/.test(id)) { id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[b % 62]).join(''); try { sessionStorage.setItem('t7vid', id); } catch (e) {} }
  let out = null;
  if (ui) {
    let live = document.getElementById('live');
    if (!live) {   // no LIVE badge on this page (trending): add one after the brand
      const brand = document.querySelector('.brand'); if (!brand) return;
      const st = document.createElement('style');
      st.textContent = '.live{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--green,#39ff6a);border:1px solid rgba(57,255,106,.35);padding:2px 8px;white-space:nowrap}' +
        '.live i{width:7px;height:7px;border-radius:50%;background:var(--green,#39ff6a);animation:t7blink 1.4s infinite}@keyframes t7blink{50%{opacity:.25}}';
      document.head.appendChild(st);
      live = document.createElement('span'); live.className = 'live'; live.id = 'live'; live.innerHTML = '<i></i><span>LIVE</span>';
      brand.insertAdjacentElement('afterend', live);
    }
    const st2 = document.createElement('style'); st2.textContent = '.t7n{margin-left:2px}@media (max-width:480px){.t7n .w{display:none}}'; document.head.appendChild(st2);
    out = document.createElement('span'); out.className = 't7n'; out.hidden = true; live.appendChild(out);
  }
  async function ping() {
    if (document.visibilityState === 'hidden') return;
    try {
      const d = await (await fetch(`${BOT}/viewers?id=${id}`, { cache: 'no-store' })).json();
      if (out && d && d.n > 0) { out.innerHTML = `· ${d.n.toLocaleString('en-US')}<span class="w"> watching</span>`; out.hidden = false; }
    } catch (e) {}
  }
  ping(); setInterval(ping, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ping(); });
})();
