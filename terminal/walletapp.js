// Wallet apps for Jupiter's swap widget (token page, launch radar), e.g. from the home-screen app, which can't get a wallet's
// answer back through a link:
// - Jupiter Mobile and WalletConnect in the swap's own wallet list (below): connect and approve in the wallet app over WalletConnect.
// - OPEN IN WALLET APP, the button above the swap on a phone that isn't already inside a wallet's browser (and T7A.openIn(), from
//   the token page's payment wallet picker): reopens this page in Phantom's, Solflare's or Backpack's browser (Jupiter Mobile has
//   no link for it: copy the link, paste it in its browser). The only way for Phantom and Solflare from the iPhone home-screen
//   app: neither can be reached there over WalletConnect, and their own links answer back to Safari.
// The site never makes or keeps a wallet key.
// Pages: T7A.mount(el) draws the button in el; T7A.openIn() opens the chooser.
(()=>{
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// ---------- Jupiter Mobile and WalletConnect in the swap's own wallet list ----------
// Two Wallet Standard wallets Jupiter's widget lists next to the installed ones. Picking one loads terminal/wc/ (built from
// wc/: Reown AppKit, what Jupiter's own mobile adapter uses): Jupiter Mobile opens the Jupiter app straight away (a QR code on a
// computer), WalletConnect lists every wallet app that speaks it (Backpack, Trust, OKX…; on a phone not Phantom or Solflare: no mobile link). The wallet app answers through
// WalletConnect's relay, so it works from the home-screen app on an iPhone: approve in the wallet app, switch back. Swaps ask
// the wallet app the same way (its own auto-approve setting applies). The site keeps only WalletConnect's session.
// Not offered inside a wallet's own browser (its wallet is already there).
const WC_ID='175291997ee6f0fb76ece8669bf0ea14',RPC='https://solana-rpc.publicnode.com',WCK='t7wc';   // WCK: which of the two holds the session
const B58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58d(s){let n=0n;for(const c of s){const i=B58.indexOf(c);if(i<0)throw new Error('not base58');n=n*58n+BigInt(i)}
  const o=[];while(n>0n){o.unshift(Number(n%256n));n/=256n}for(const c of s){if(c!=='1')break;o.unshift(0)}return Uint8Array.from(o)}
const b64=u8=>{let s='';for(const b of u8)s+=String.fromCharCode(b);return btoa(s)};
let WC=null,WCP=null;
const wc=()=>WCP||(WCP=import('/terminal/wc/entry.js').then(m=>{
  m.init({projectId:WC_ID,name:'Terminal 7',url:location.origin,icon:location.origin+'/terminal/img/app-t7-192.png'});return WC=m},e=>{WCP=null;throw e}));
// preload on a phone outside a wallet's browser when the swap opens: the first tap would otherwise wait seconds on ~3 MB
let warmed=false;
function warm(){if(warmed)return;warmed=true;(window.requestIdleCallback||setTimeout)(()=>wc().then(m=>m.warm()).catch(()=>{warmed=false}),1500)}
// "Opening Jupiter Mobile…" from the tap until AppKit's panel shows (or the error, if it can't)
let TO=null;
function toast(t,err,ms){if(!TO){TO=document.createElement('div');TO.title='Tap to close';TO.onclick=()=>toast('');TO.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1001;max-width:calc(100vw - 32px);box-sizing:border-box;background:#0a0f1f;border:1px solid #ffd23f;color:#c9d3ee;font:12px/1.45 ui-monospace,monospace;padding:10px 14px;text-align:center';document.body.appendChild(TO)}
  clearTimeout(TO._t);TO._t=0;TO.style.borderColor=err?'#ff3355':'#ffd23f';TO.textContent=t;TO.style.display=t?'':'none';if(err)TO._t=setTimeout(()=>toast(''),ms||9000)}
const FEAT=['solana:signTransaction','solana:signAndSendTransaction','solana:signMessage'];
// a swap signed in a wallet app that Jupiter turns down shows only "Swap Failed": show Jupiter's own answer (status, code, error)
// and what the wallet did (how long it took, whether it changed the transaction), so the cause can be told apart
const ULTRA={'-1':'the order expired before it was sent (took too long to approve?)','-2':'invalid signed transaction','-3':'the wallet changed the transaction (message bytes differ)',
  '-1000':'it didn\'t land on-chain','-1001':'unknown error','-1002':'invalid transaction','-1003':'it wasn\'t fully signed','-1004':'too late: the block height passed (took too long to approve)',
  '-2000':'it didn\'t land on-chain','-2001':'unknown error','-2002':'invalid payload','-2003':'the quote expired (took too long to approve)','-2004':'the market maker rejected the swap'};   // developers.jup.ag/docs/swap/order-and-execute
const F0=window.fetch;
window.fetch=async function(u,...r){const res=await F0.call(this,u,...r);
  try{const url=typeof u==='string'?u:u?.url||'';if(WC&&WC.lastSign&&/ultra-api\.jup\.ag\/.*execute/.test(url))res.clone().json().then(d=>{
    if(d&&d.status&&d.status!=='Success'){const s=WC.lastSign,c=d.code!=null?String(d.code):'';
      toast('Jupiter turned the swap down: '+(ULTRA[c]||d.error||'no reason given')+(c?' (code '+c+')':'')+(d.error&&ULTRA[c]?' · '+d.error:'')
        +' · wallet answered in '+Math.round(s.ms/1000)+'s'+(s.changed?' and CHANGED the transaction':''),true,30000)}}).catch(()=>{})}catch(e){}
  return res};
function wcWallet(name,icon,pick){
  const ls=new Set();let accts=[],unsub=null;
  const set=a=>{const n=a?[{address:a,publicKey:b58d(a),chains:['solana:mainnet'],features:FEAT}]:[];
    if((accts[0]?.address||null)===(a||null))return;accts=n;ls.forEach(f=>{try{f({accounts:accts})}catch(e){}})};
  const watch=m=>{unsub?.();unsub=m.onChange(a=>{if(localStorage.getItem(WCK)===name)set(a)})};
  const mine=()=>{try{return localStorage.getItem(WCK)===name}catch(e){return false}};
  const ready=async()=>{if(!accts.length)throw new Error('Wallet not connected');return wc()};
  return{version:'1.0.0',name,icon,chains:['solana:mainnet'],get accounts(){return accts},features:{
    'standard:connect':{version:'1.0.0',connect:async({silent}={})=>{
      if(silent){if(!mine())return{accounts:[]};const m=await wc();watch(m);set(await m.restore());return{accounts:accts}}
      toast('Opening '+name+'…');let m;
      try{m=await wc()}catch(e){toast('Couldn\'t load '+name+': '+(e.message||e)+'. Check your connection and try again.',true);throw e}
      const off=m.onModal(o=>{if(o)toast('')});let a;
      try{a=await m.connect(pick)}catch(e){toast(name+': '+(e.message||e),true);throw e}finally{off&&off();if(TO&&!TO._t)toast('')}
      if(!a)throw new Error('Connection cancelled');
      try{localStorage.setItem(WCK,name)}catch(e){}watch(m);set(a);return{accounts:accts}}},
    'standard:disconnect':{version:'1.0.0',disconnect:async()=>{try{localStorage.removeItem(WCK)}catch(e){}set(null);if(WC)await WC.disconnect()}},
    'standard:events':{version:'1.0.0',on:(ev,f)=>{if(ev!=='change')return()=>{};ls.add(f);return()=>ls.delete(f)}},
    'solana:signTransaction':{version:'1.0.0',supportedTransactionVersions:['legacy',0],signTransaction:async(...ins)=>{const m=await ready(),o=[];
      for(const i of ins)o.push({signedTransaction:await m.signTransaction(i.transaction)});return o}},
    'solana:signAndSendTransaction':{version:'1.0.0',supportedTransactionVersions:['legacy',0],signAndSendTransaction:async(...ins)=>{const m=await ready(),o=[];
      for(const i of ins){const st=await m.signTransaction(i.transaction);
        const r=await(await fetch(RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'sendTransaction',params:[b64(st),{encoding:'base64'}]})})).json();
        if(r.error)throw new Error(r.error.message);o.push({signature:b58d(r.result)})}return o}},
    'solana:signMessage':{version:'1.0.0',signMessage:async(...ins)=>{const m=await ready(),o=[];
      for(const i of ins)o.push({signedMessage:i.message,signature:await m.signMessage(i.message)});return o}}}}}
const WCW=[wcWallet('Jupiter Mobile','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAMAAAC7IEhfAAAAkFBMVEUfZFofNiyk7p4r0eIuWjGg5ZVS2stWcFNiyqmY2Iuh6JhYYy0nxdZloG1WtZdp1bFs2rRj2Lqs13PF8YQtpaVM0cUizNrK9YfH84Upydmls2cbssrF74RN0cUUvt1EyMEAM2YA/wBmmTPD7H////8AAADL+YuN56lN18w2zNJm2bi59ZRq5cWN5aZ24rcZyOcfo68sAAAAMHRSTlMIBu/0B1vvByokpQdiCRVgneQRYQ6oKdOhnQccJl1BMwUBBTgBAfz7+/v6/P/Q+fghIzrSAAADAUlEQVR42m2Ua3uiMBSEEyAQQMJFQPCy3VuUItL//+92JsGtfXbPByvm7eTM5ARhv9TxfN6zzo17yj9XxCsmbbMfrr4Owx7Yz/+AMoqkxN/m/IQP+6PN869glGzPRcHP83DYUCy9gk4pTVPfVIHPZu/RobH5q2KaBb4ypeBDQld69LCRBGWhHo6637FyDwaFRhI628joqZik7KxIlYLw3fUG2Zy98uF8lJ+unWFGB5bCROmQooNNPBgVQjrnScJNCs/ScZLbX+h0D1JY6USLLR+RJ84bVem4sA22T5OEWrqsHqgsU67XBD6sCq5AFQM/DofBHoU11brefAW3R0bHOCOgd6gqK+FpuDZWmDpe1vWVValHsX9wzXCKUYJ+RTlXpa/q8WQzoFSC6DVr8K0ZGqHN5/RolW2ogigSc2QBf80ZlgufZSSYjVFON3ikiDa3KfLPeEpWgJJaa2OIuagc6kQ9eVckhb108VTP81xXpeZ/RkQDoFkBTySD9EduRTex6nqOlwWwBiqtzp7bOzLDWAhicRxPTnVdZqIUfZI5HSkYiae4Q4GEImpZK0Mhze29pgoynEzf+mhaU3a1Y5e15LCYLKBmJJIiuKdfb6G5eHStCiwUJJEN21SIp+13KO2FRVk70VpTEzkBwVgSbEMUDXUX7VTLGei6ktRMVCfit6LiGL6z6L678ELq+JO8zQGzSdjKLnz3aEzdC35uq4W7m0jY6rYGxt1m9DiGQEPCjLNr8bsjq0iIol5vJS6C9Ne1Pe2oGxKNY+5ZLXW9lPhSrmu1XVe5RdSPnpymN5JxPc2GknHlAF6u0zjuejycRtftNEHKYFIWIuVfkH4+0OPuRNSTb/DOUcHsaeDJ9qYQ9tvHB9gdfHgyNsLi+OPSSoPs5fOV4kmgvWVaIEc45CEgFfP62hP2FIZu/40M0TMmteO6fH3tCSvQKEQ3Mhxt3zvFjfs7Pd8jOHGNWuv6bG3bXVoh/32HM5/dGH7s+hNT6r9O4OuT4KT1PQxh8Nw8ty+rfwBzvKPekNbn3wAAAABJRU5ErkJggg==','jupiter'),wcWallet('WalletConnect','data:image/svg+xml,%3Csvg height=%22185%22 viewBox=%220 0 300 185%22 width=%22300%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cpath d=%22m61.4385429 36.2562612c48.9112241-47.8881663 128.2119871-47.8881663 177.1232091 0l5.886545 5.7634174c2.445561 2.3944081 2.445561 6.2765112 0 8.6709204l-20.136695 19.715503c-1.222781 1.1972051-3.2053 1.1972051-4.428081 0l-8.100584-7.9311479c-34.121692-33.4079817-89.443886-33.4079817-123.5655788 0l-8.6750562 8.4936051c-1.2227816 1.1972041-3.205301 1.1972041-4.4280806 0l-20.1366949-19.7155031c-2.4455612-2.3944092-2.4455612-6.2765122 0-8.6709204zm218.7677961 40.7737449 17.921697 17.546897c2.445549 2.3943969 2.445563 6.2764769.000031 8.6708899l-80.810171 79.121134c-2.445544 2.394426-6.410582 2.394453-8.85616.000062-.00001-.00001-.000022-.000022-.000032-.000032l-57.354143-56.154572c-.61139-.598602-1.60265-.598602-2.21404 0-.000004.000004-.000007.000008-.000011.000011l-57.3529212 56.154531c-2.4455368 2.394432-6.4105755 2.394472-8.8561612.000087-.0000143-.000014-.0000296-.000028-.0000449-.000044l-80.81241943-79.122185c-2.44556021-2.394408-2.44556021-6.2765115 0-8.6709197l17.92172963-17.5468673c2.4455602-2.3944082 6.4105989-2.3944082 8.8561602 0l57.3549775 56.155357c.6113908.598602 1.602649.598602 2.2140398 0 .0000092-.000009.0000174-.000017.0000265-.000024l57.3521031-56.155333c2.445505-2.3944633 6.410544-2.3945531 8.856161-.0002.000034.0000336.000068.0000673.000101.000101l57.354902 56.155432c.61139.598601 1.60265.598601 2.21404 0l57.353975-56.1543249c2.445561-2.3944092 6.410599-2.3944092 8.85616 0z%22 fill=%22%233b99fc%22/%3E%3C/svg%3E',null)];
const ours=w=>WCW.includes(w);
function regWC(api){if(!window.phantom?.solana&&!window.solflare&&!window.backpack&&!window.jupiter)try{api.register(...WCW)}catch(e){}}
addEventListener('wallet-standard:app-ready',e=>regWC(e.detail));
try{dispatchEvent(new CustomEvent('wallet-standard:register-wallet',{detail:regWC}))}catch(_){}
const STD=new Set();   // Wallet Standard wallets in this browser (= we're inside a wallet, or one is installed)
const reg={register:(...w)=>{w.forEach(x=>{if(!ours(x))STD.add(x)});return()=>{}}};
addEventListener('wallet-standard:register-wallet',e=>{try{e.detail(reg)}catch(_){}});
try{dispatchEvent(new CustomEvent('wallet-standard:app-ready',{detail:reg}))}catch(_){}
const phone=()=>matchMedia('(pointer:coarse)').matches;
const inWallet=()=>!!(window.phantom?.solana||window.solflare||window.backpack||window.jupiter||STD.size||/Phantom|Solflare|Backpack|Jupiter/i.test(navigator.userAgent));
// the instant-trades test (12 Oct 2026, removed) left a key in this browser's storage for anyone who made one: help them move
// what's in it to a wallet app and wipe it; nothing new is ever written
const OLD='t7iw',old=()=>{try{return JSON.parse(localStorage.getItem(OLD)||'null')}catch(e){return null}};
const BARS=new Set();
function mount(el){if(!el)return;el.classList.add('t7a');BARS.add(el);css();draw();if(phone()&&!inWallet())warm()}
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
  <p>Opens this page inside your wallet app's browser, where the swap connects to it directly.</p>
  <div class="t7a-list">${apps.map(([n,u])=>`<a class="t7a-btn" href="${esc(u)}" target="_blank" rel="noopener">${n} ↗</a>`).join('')}
  <button type="button" class="t7a-btn" data-t7a="jupm">Jupiter Mobile · copy link</button></div>
  <div class="t7a-note" id="t7aJm" style="display:none"></div>
  <p class="dim">Jupiter Mobile, Backpack, Trust, OKX and Magic Eden can also stay here: tap <b>Connect</b> in the swap, pick <b>Jupiter Mobile</b> or <b>WalletConnect</b>, approve in the wallet app and come back.</p>
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
// the payment wallet pickers' OPEN IN WALLET APP link (token page, stream, TTS checkout): close the picker, open the chooser
document.addEventListener('click',e=>{if(!e.target.closest('#wOpenIn'))return;e.preventDefault();document.getElementById('wCancel')?.click();openIn()});
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
