// OPEN IN WALLET APP: the button above Jupiter's swap widget (token page, launch radar) on a phone that isn't already inside a
// wallet's browser (e.g. the home-screen app, which can't get a wallet's answer back). It reopens this page in Phantom's,
// Solflare's or Backpack's browser, where the swap connects normally; Jupiter Mobile has no link for it: copy the link, paste it
// in its browser. The site never makes or keeps a wallet key.
// Pages: T7A.mount(el) draws the button in el; T7A.openIn() opens the chooser.
(()=>{
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STD=new Set();   // Wallet Standard wallets in this browser (= we're inside a wallet, or one is installed)
const reg={register:(...w)=>{w.forEach(x=>STD.add(x));return()=>{}}};
addEventListener('wallet-standard:register-wallet',e=>{try{e.detail(reg)}catch(_){}});
try{dispatchEvent(new CustomEvent('wallet-standard:app-ready',{detail:reg}))}catch(_){}
const phone=()=>matchMedia('(pointer:coarse)').matches;
const inWallet=()=>!!(window.phantom?.solana||window.solflare||window.backpack||window.jupiter||STD.size||/Phantom|Solflare|Backpack|Jupiter/i.test(navigator.userAgent));
// the instant-trades test (12 Oct 2026, removed) left a key in this browser's storage for anyone who made one: help them move
// what's in it to a wallet app and wipe it; nothing new is ever written
const OLD='t7iw',old=()=>{try{return JSON.parse(localStorage.getItem(OLD)||'null')}catch(e){return null}};
const BARS=new Set();
function mount(el){if(!el)return;el.classList.add('t7a');BARS.add(el);css();draw()}
function draw(){const o=old()?.sk;
  for(const el of BARS){if(!el.isConnected){BARS.delete(el);continue}
    el.innerHTML=(phone()&&!inWallet()?'<button type="button" data-t7a="openin">📱 OPEN IN WALLET APP</button>':'')
      +(o?'<div class="t7a-note">⚠ The instant-wallet test left a wallet key on this device. <a href="#" data-t7a="old">Move it to your wallet app</a></div>':'')}}
let M=null;
function modal(html){if(!M){M=document.createElement('div');M.id='t7aM';document.body.appendChild(M);M.addEventListener('click',e=>{if(e.target===M)close()})}
  M.innerHTML=`<div class="t7a-box"><button type="button" class="t7a-x" data-t7a="close" title="Close">✕</button>${html}</div>`;M.classList.add('show')}
function close(){if(M)M.classList.remove('show');draw()}
async function copy(t){try{await navigator.clipboard.writeText(t);return true}catch(e){
  const a=document.createElement('textarea');a.value=t;a.style.cssText='position:fixed;opacity:0';document.body.appendChild(a);a.select();
  let ok=false;try{ok=document.execCommand('copy')}catch(_){}a.remove();return ok}}
function openIn(){const here=location.href,E=encodeURIComponent,ref=E(location.origin),and=/android/i.test(navigator.userAgent);
  const apps=[['Phantom',`https://phantom.app/ul/browse/${E(here)}?ref=${ref}`],['Solflare',`https://solflare.com/ul/v1/browse/${E(here)}?ref=${ref}`],
    ['Backpack',`https://backpack.app/ul/v1/browse/${E(here)}?ref=${ref}`]];
  modal(`<h3>OPEN IN WALLET APP</h3>
  <p>Opens this page inside your wallet app's browser, where Jupiter's swap connects to it normally.</p>
  <div class="t7a-list">${apps.map(([n,u])=>`<a class="t7a-btn" href="${esc(u)}" target="_blank" rel="noopener">${n} ↗</a>`).join('')}
  <button type="button" class="t7a-btn" data-t7a="jupm">Jupiter Mobile · copy link</button></div>
  <div class="t7a-note" id="t7aJm" style="display:none"></div>
  ${and?'<p class="dim">On Android you can also stay here: tap <b>Connect</b> in the swap and pick <b>Mobile Wallet Adapter</b>. It opens your installed wallet app and brings you back.</p>':''}
  <p class="dim">Fewer approvals: if your wallet has an auto-approve / auto-confirm setting for trusted sites, turn it on there after connecting.</p>`)}
function oldKey(){const o=old();if(!o?.sk)return close();
  modal(`<h3>MOVE THE OLD INSTANT WALLET</h3>
  <p>You made an instant wallet during a test of a feature that's been removed. Its key is still in this device's storage.</p>
  <p>Wallet: <span class="t7a-mono">${esc(o.addr||'')}</span> · <a href="https://solscan.io/account/${esc(o.addr||'')}" target="_blank" rel="noopener">see what's in it ↗</a></p>
  <p>1. Copy the key. 2. In Phantom, Solflare, Backpack or Jupiter: add wallet → <b>import private key</b>, paste it. Everything in it shows up there.
  3. Then remove it from this device.</p>
  <div class="t7a-mono" id="t7aSk">•••••••• tap SHOW ••••••••</div>
  <div class="t7a-acts"><button type="button" data-t7a="show">SHOW</button><button type="button" data-t7a="copy">COPY KEY</button><button type="button" class="bad" data-t7a="wipe">REMOVE FROM THIS DEVICE</button></div>
  <div class="t7a-msg"></div>`)}
const msg=t=>{const e=M&&M.querySelector('.t7a-msg');if(e)e.textContent=t};
document.addEventListener('click',async e=>{const t=e.target.closest('[data-t7a]');if(!t)return;
  if(t.tagName==='A'&&t.getAttribute('href')==='#')e.preventDefault();
  switch(t.dataset.t7a){
    case'close':return close();case'openin':return openIn();case'old':return oldKey();
    case'jupm':{const n=M.querySelector('#t7aJm'),ok=await Promise.race([copy(location.href),new Promise(r=>setTimeout(()=>r(false),1500))]);
      n.innerHTML=(ok?'Link copied. ':'Copy this link: <span class="t7a-mono">'+esc(location.href)+'</span>')+'In Jupiter Mobile tap the 🌐 globe (top right), paste it and go.';n.style.display='';return}
    case'show':{const k=M.querySelector('#t7aSk');k.textContent=old()?.sk||'';return}
    case'copy':return msg(await copy(old()?.sk||'')?'Copied. Import it in your wallet app now.':'Couldn\'t copy: tap SHOW and copy it by hand.');
    case'wipe':if(!confirm('Remove the key from this device? Make sure you imported it into a wallet app first if anything is in it: without the key, it\'s gone.'))return;
      try{localStorage.removeItem(OLD);localStorage.removeItem('t7iwTo')}catch(_){}return close()}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&M&&M.classList.contains('show'))close()});
function css(){if(document.getElementById('t7aCss'))return;const s=document.createElement('style');s.id='t7aCss';s.textContent=`
.t7a{font-size:11px}.t7a:not(:empty){margin:0 0 8px}
.t7a button,.t7a-box button,.t7a-btn{background:var(--panel2,#0d1428);border:1px solid var(--line,#1a2444);color:var(--txt,#c9d3ee);font:inherit;font-size:11px;letter-spacing:.04em;padding:7px 10px;cursor:pointer;text-decoration:none;display:inline-block;text-align:center}
.t7a>button{width:100%}
.t7a button:hover,.t7a-box button:hover,.t7a-btn:hover{border-color:var(--amber,#ffd23f);color:#fff}
.t7a-note{font-size:10px;color:var(--dim,#5d6a8f);margin-top:5px;line-height:1.45}
.t7a-note a,.t7a-box a{color:var(--amber,#ffd23f)}
#t7aM{position:fixed;inset:0;z-index:200;background:rgba(2,4,10,.82);display:none;align-items:center;justify-content:center;padding:16px}
#t7aM.show{display:flex}
.t7a-box{position:relative;background:var(--panel,#0a0f1f);border:1px solid var(--amber,#ffd23f);color:var(--txt,#c9d3ee);width:100%;max-width:440px;max-height:calc(100vh - 32px);overflow-y:auto;padding:18px 16px 14px;font-size:12px;line-height:1.5}
.t7a-box h3{margin:0 30px 10px 0;color:var(--amber,#ffd23f);font-size:13px;letter-spacing:.08em}
.t7a-box p{margin:0 0 10px}.t7a-box .dim{color:var(--dim,#5d6a8f);font-size:11px}
.t7a-box .t7a-x{position:absolute;top:10px;right:10px;width:30px;height:30px;padding:0}
.t7a-box .bad{color:var(--red,#ff3355)}
.t7a-list{display:grid;gap:6px;margin:8px 0}.t7a-acts{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
.t7a-mono{display:block;font-family:ui-monospace,monospace;font-size:11px;word-break:break-all;background:var(--bg,#04060f);border:1px solid var(--line,#1a2444);padding:8px;margin:6px 0;user-select:all;-webkit-user-select:all}
.t7a-msg{min-height:1em;font-size:11px;color:var(--green,#39ff6a)}`;document.head.appendChild(s)}
window.T7A={mount,openIn};
dispatchEvent(new Event('t7a-ready'));
})();
