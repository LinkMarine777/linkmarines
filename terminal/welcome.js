// First visit: a welcome to Terminal 7 (what's where), and on phones how to put it on the home screen so it opens like an
// app (terminal7.webmanifest). Shows once per browser ("Don't show this again", ticked; untick it and it shows next visit
// too); the ☰ menu's "Welcome & tips" (wrWelcome()) opens it again.
// Not on the stream's own screen (?obs) or a page opened from the home screen's second visit on.
(() => {
  const KEY = 'wrWelcome', q = new URLSearchParams(location.search);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ua = navigator.userAgent, iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1), android = /Android/.test(ua);
  const phone = matchMedia('(max-width: 760px)').matches || iOS || android;
  let installEvt = null;   // Chrome / Android: its own "Install app" prompt, when it offers one
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; const b = document.getElementById('wlInstall'); if (b) b.style.display = ''; });

  const css = `#wl{position:fixed;inset:0;z-index:200;background:rgba(2,3,10,.78);display:flex;align-items:center;justify-content:center;padding:16px;animation:wlIn .2s ease}
  @keyframes wlIn{from{opacity:0}}
  #wl .wb{width:min(560px,100%);max-height:calc(100vh - 32px);overflow-y:auto;background:var(--panel,#0a0f1f);border:1px solid var(--line,#1a2444);border-top:3px solid var(--blue2,#4a7aff);
    box-shadow:0 30px 80px rgba(0,0,0,.6);padding:22px 22px 18px;font:13px/1.5 'IBM Plex Mono',monospace;color:var(--txt,#c9d3ee);position:relative}
  #wl .hd{display:flex;align-items:center;gap:12px}#wl .hd img{width:46px;height:46px;object-fit:contain}
  #wl .hd b{display:block;font-family:'VT323';font-weight:400;font-size:40px;line-height:.95;color:#fff}#wl .hd small{display:block;font-size:12px;letter-spacing:2px;color:var(--blue2,#4a7aff)}
  #wl .x{position:absolute;top:12px;right:12px;background:none;border:1px solid var(--line,#1a2444);color:var(--dim,#5d6a8f);width:30px;height:30px;cursor:pointer;font:inherit}#wl .x:hover{color:#fff}
  #wl .lead{margin:14px 0 12px;color:var(--txt,#c9d3ee)}
  #wl .it{display:grid;grid-template-columns:28px minmax(0,1fr);gap:10px;padding:9px 0;border-top:1px solid var(--line,#1a2444)}#wl .it>span{font-size:18px;line-height:1.3}
  #wl .it b{color:#fff;font-weight:600}#wl .it div{font-size:12px}
  #wl .app{margin-top:14px;border:1px solid var(--line,#1a2444);background:rgba(255,255,255,.02);padding:18px 14px 16px;text-align:center}
  #wl .app img{width:64px;height:64px;border-radius:15px;border:2px solid #8f96ff;box-shadow:0 0 22px rgba(120,130,255,.35);display:block;margin:0 auto}
  #wl .app h4{font-family:'IBM Plex Mono',monospace;font-size:17px;color:#fff;margin:12px 0 10px;font-weight:600;letter-spacing:.3px}
  #wl .app p{margin:6px 0;font-size:13px;color:var(--dim,#5d6a8f)}#wl .app p b{color:#fff;font-weight:600;display:inline-flex;align-items:center;gap:5px;vertical-align:middle}
  #wl .app svg{width:17px;height:17px;fill:none;stroke:#fff;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  #wl .dsa{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:12px;font-size:12px;color:var(--dim,#5d6a8f);cursor:pointer;user-select:none}#wl .dsa input{accent-color:var(--blue,#2A5ADA);width:15px;height:15px}
  #wl .ft{margin-top:12px;font-size:11px;color:var(--dim,#5d6a8f)}
  #wl .go{display:block;width:100%;margin-top:14px;background:var(--blue,#2A5ADA);color:#fff;border:0;padding:12px;font:inherit;font-size:13px;font-weight:600;letter-spacing:2px;cursor:pointer}#wl .go:hover{filter:brightness(1.1)}
  #wl .inst{background:var(--green,#39ff6a);color:#04060f;border:0;padding:8px 14px;font:inherit;font-weight:600;letter-spacing:1px;cursor:pointer;margin-top:8px}
  @media (max-width:760px){#wl{align-items:flex-end;padding:0}#wl .wb{width:100%;max-height:90vh;border-left:0;border-right:0;border-bottom:0;padding:16px 16px 14px;font-size:12px;animation:wlUp .25s ease}#wl .lead{margin:10px 0 8px}#wl .it{padding:7px 0}#wl .it>span{font-size:16px}}
  @keyframes wlUp{from{transform:translateY(40px)}}`;

  // the phone's own icons: iOS Share (a box with an arrow up), Add to Home Screen (a plus in a box), Android's ⋮ menu
  const SHARE = '<svg viewBox="0 0 24 24"><path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1"/></svg>';
  const ADD = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8M8 12h8"/></svg>';
  const MENU = '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/></svg>';
  function appSteps() {
    if (standalone || !phone) return '';
    const steps = iOS
      ? `<p>Click on <b>${SHARE} Share</b></p><p>Then <b>${ADD} Add to Home Screen</b></p>`
      : `<p>Click on <b>${MENU} Menu</b></p><p>Then <b>${ADD} Add to Home screen</b></p>`;
    return `<div class="app"><img src="/terminal/img/app-t7-192.png" alt=""><h4>Install Terminal 7 App</h4><p>Optional: open it like an app from your home screen</p>${steps}`
      + `${android ? `<button class="inst" id="wlInstall" type="button" style="${installEvt ? '' : 'display:none'}">INSTALL TERMINAL 7</button>` : ''}</div>`;
  }
  function show() {
    if (document.getElementById('wl')) return false;
    if (!document.getElementById('wlCss')) { const st = document.createElement('style'); st.id = 'wlCss'; st.textContent = css; document.head.appendChild(st); }
    const w = document.createElement('div'); w.id = 'wl'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); w.setAttribute('aria-label', 'Welcome to Terminal 7');
    w.innerHTML = `<div class="wb"><button class="x" type="button" aria-label="Close">✕</button>
      <div class="hd"><img src="/helmet.png" alt=""><div><small>WELCOME TO THE WAR ROOM</small><b>TERMINAL 7</b></div></div>
      <p class="lead">The terminal for stonkfun: what's trading, what's real, and what the whales are doing.</p>
      <div class="it"><span>🔥</span><div><b>Trending</b>: stonkfun's busiest coins: volume, APY, what they paid holders, CLOBr and compound scores.</div></div>
      <div class="it"><span>🧪</span><div><b>New launches</b>: every launch of the last 24 h, real or farm. Tap one for its bundle scan and who funded its holders.</div></div>
      <div class="it"><span>🐋</span><div><b>Whale radar &amp; alerts</b>: what the biggest holders buy and sell, live. The 🔔 picks which alerts pop up.</div></div>
      <div class="it"><span>🔬</span><div><b>Wallet X-Ray</b>: tap any wallet (holders, the tape, whales) or paste one: every stonkfun coin it holds, its compound score, rewards and P&amp;L per coin.</div></div>
      <div class="it"><span>🔍</span><div><b>Search</b>: a $ticker, a name or a pasted address: a coin opens its terminal, a wallet its X-Ray.</div></div>
      ${appSteps()}
      <p class="ft">You always trade from your own wallet, through Jupiter: nothing here holds your funds or signs for you. Not financial advice.</p>
      <button class="go" type="button">LET'S GO</button>
      <label class="dsa"><input type="checkbox" id="wlNo" checked> Don't show this again</label></div>`;
    document.body.appendChild(w);
    const close = () => { const no = document.getElementById('wlNo').checked; w.remove(); try { no ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch (e) {} };
    w.addEventListener('click', e => { if (e.target === w || e.target.closest('.x,.go')) close(); });   // the checkbox itself doesn't close it
    addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); removeEventListener('keydown', esc); } });
    const ib = document.getElementById('wlInstall');
    if (ib) ib.onclick = async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) {} installEvt = null; close(); };
    return false;
  }
  window.wrWelcome = show;   // the ☰ menu's "Welcome & tips"
  let seen = false; try { seen = localStorage.getItem(KEY) === '1'; } catch (e) { seen = true; }   // no storage: don't nag every page
  if (!seen && !q.has('obs') && !q.has('embed')) setTimeout(show, 800);   // after the page has drawn
})();
