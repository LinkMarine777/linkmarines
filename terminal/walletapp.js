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
function toast(t,err,ms){if(!TO){TO=document.createElement('div');TO.title='Tap to close';TO.onclick=()=>toast('');TO.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1003;max-width:calc(100vw - 32px);box-sizing:border-box;background:#0a0f1f;border:1px solid #ffd23f;color:#c9d3ee;font:12px/1.45 ui-monospace,monospace;padding:10px 14px;text-align:center';document.body.appendChild(TO)}
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
      WC_NAME=pick?name:'';
      try{a=await m.connect(pick)}catch(e){toast(name+': '+(e.message||e),true);throw e}finally{off&&off();if(TO&&!TO._t)toast('');closeApp()}
      if(!a)throw new Error('Connection cancelled');
      try{localStorage.setItem(WCK,name)}catch(e){}watch(m);set(a);return{accounts:accts}}},
    'standard:disconnect':{version:'1.0.0',disconnect:async()=>{try{localStorage.removeItem(WCK)}catch(e){}set(null);if(WC)await WC.disconnect()}},
    'standard:events':{version:'1.0.0',on:(ev,f)=>{if(ev!=='change')return()=>{};ls.add(f);return()=>ls.delete(f)}},
    'solana:signTransaction':{version:'1.0.0',supportedTransactionVersions:['legacy',0],signTransaction:async(...ins)=>{const m=await ready(),o=[];
      WC_NAME=pick?name:'';try{for(const i of ins)o.push({signedTransaction:await m.signTransaction(i.transaction)})}finally{closeApp()}return o}},
    'solana:signAndSendTransaction':{version:'1.0.0',supportedTransactionVersions:['legacy',0],signAndSendTransaction:async(...ins)=>{const m=await ready(),o=[];
      for(const i of ins){WC_NAME=pick?name:'';let st;try{st=await m.signTransaction(i.transaction)}finally{closeApp()}
        const r=await(await fetch(RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'sendTransaction',params:[b64(st),{encoding:'base64'}]})})).json();
        if(r.error)throw new Error(r.error.message);o.push({signature:b58d(r.result)})}return o}},
    'solana:signMessage':{version:'1.0.0',signMessage:async(...ins)=>{const m=await ready(),o=[];
      for(const i of ins)o.push({signedMessage:i.message,signature:await m.signMessage(i.message)});return o}}}}}
const WCW=[wcWallet('Jupiter Mobile','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAMAAAC7IEhfAAAAkFBMVEUfZFofNiyk7p4r0eIuWjGg5ZVS2stWcFNiyqmY2Iuh6JhYYy0nxdZloG1WtZdp1bFs2rRj2Lqs13PF8YQtpaVM0cUizNrK9YfH84Upydmls2cbssrF74RN0cUUvt1EyMEAM2YA/wBmmTPD7H////8AAADL+YuN56lN18w2zNJm2bi59ZRq5cWN5aZ24rcZyOcfo68sAAAAMHRSTlMIBu/0B1vvByokpQdiCRVgneQRYQ6oKdOhnQccJl1BMwUBBTgBAfz7+/v6/P/Q+fghIzrSAAADAUlEQVR42m2Ua3uiMBSEEyAQQMJFQPCy3VuUItL//+92JsGtfXbPByvm7eTM5ARhv9TxfN6zzo17yj9XxCsmbbMfrr4Owx7Yz/+AMoqkxN/m/IQP+6PN869glGzPRcHP83DYUCy9gk4pTVPfVIHPZu/RobH5q2KaBb4ypeBDQld69LCRBGWhHo6637FyDwaFRhI628joqZik7KxIlYLw3fUG2Zy98uF8lJ+unWFGB5bCROmQooNNPBgVQjrnScJNCs/ScZLbX+h0D1JY6USLLR+RJ84bVem4sA22T5OEWrqsHqgsU67XBD6sCq5AFQM/DofBHoU11brefAW3R0bHOCOgd6gqK+FpuDZWmDpe1vWVValHsX9wzXCKUYJ+RTlXpa/q8WQzoFSC6DVr8K0ZGqHN5/RolW2ogigSc2QBf80ZlgufZSSYjVFON3ikiDa3KfLPeEpWgJJaa2OIuagc6kQ9eVckhb108VTP81xXpeZ/RkQDoFkBTySD9EduRTex6nqOlwWwBiqtzp7bOzLDWAhicRxPTnVdZqIUfZI5HSkYiae4Q4GEImpZK0Mhze29pgoynEzf+mhaU3a1Y5e15LCYLKBmJJIiuKdfb6G5eHStCiwUJJEN21SIp+13KO2FRVk70VpTEzkBwVgSbEMUDXUX7VTLGei6ktRMVCfit6LiGL6z6L678ELq+JO8zQGzSdjKLnz3aEzdC35uq4W7m0jY6rYGxt1m9DiGQEPCjLNr8bsjq0iIol5vJS6C9Ne1Pe2oGxKNY+5ZLXW9lPhSrmu1XVe5RdSPnpymN5JxPc2GknHlAF6u0zjuejycRtftNEHKYFIWIuVfkH4+0OPuRNSTb/DOUcHsaeDJ9qYQ9tvHB9gdfHgyNsLi+OPSSoPs5fOV4kmgvWVaIEc45CEgFfP62hP2FIZu/40M0TMmteO6fH3tCSvQKEQ3Mhxt3zvFjfs7Pd8jOHGNWuv6bG3bXVoh/32HM5/dGH7s+hNT6r9O4OuT4KT1PQxh8Nw8ty+rfwBzvKPekNbn3wAAAABJRU5ErkJggg==','jupiter'),wcWallet('WalletConnect','data:image/svg+xml,%3Csvg height=%22185%22 viewBox=%220 0 300 185%22 width=%22300%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cpath d=%22m61.4385429 36.2562612c48.9112241-47.8881663 128.2119871-47.8881663 177.1232091 0l5.886545 5.7634174c2.445561 2.3944081 2.445561 6.2765112 0 8.6709204l-20.136695 19.715503c-1.222781 1.1972051-3.2053 1.1972051-4.428081 0l-8.100584-7.9311479c-34.121692-33.4079817-89.443886-33.4079817-123.5655788 0l-8.6750562 8.4936051c-1.2227816 1.1972041-3.205301 1.1972041-4.4280806 0l-20.1366949-19.7155031c-2.4455612-2.3944092-2.4455612-6.2765122 0-8.6709204zm218.7677961 40.7737449 17.921697 17.546897c2.445549 2.3943969 2.445563 6.2764769.000031 8.6708899l-80.810171 79.121134c-2.445544 2.394426-6.410582 2.394453-8.85616.000062-.00001-.00001-.000022-.000022-.000032-.000032l-57.354143-56.154572c-.61139-.598602-1.60265-.598602-2.21404 0-.000004.000004-.000007.000008-.000011.000011l-57.3529212 56.154531c-2.4455368 2.394432-6.4105755 2.394472-8.8561612.000087-.0000143-.000014-.0000296-.000028-.0000449-.000044l-80.81241943-79.122185c-2.44556021-2.394408-2.44556021-6.2765115 0-8.6709197l17.92172963-17.5468673c2.4455602-2.3944082 6.4105989-2.3944082 8.8561602 0l57.3549775 56.155357c.6113908.598602 1.602649.598602 2.2140398 0 .0000092-.000009.0000174-.000017.0000265-.000024l57.3521031-56.155333c2.445505-2.3944633 6.410544-2.3945531 8.856161-.0002.000034.0000336.000068.0000673.000101.000101l57.354902 56.155432c.61139.598601 1.60265.598601 2.21404 0l57.353975-56.1543249c2.445561-2.3944092 6.410599-2.3944092 8.85616 0z%22 fill=%22%233b99fc%22/%3E%3C/svg%3E',null)];
// ---------- Phantom and Solflare in the swap's wallet list, on an iPhone ----------
// Neither can be reached over WalletConnect from the same phone, and their own links answer back to Safari, never the
// home-screen app. So they answer through the site's relay (terminal/wc/dl.js, /wr/ in worker/site.js): picking one, or
// approving a swap, shows a button that opens the wallet app; approve there, the wallet opens a "switch back" page in Safari,
// switch back to the app and it finishes. Only on an iPhone/iPad outside a wallet's browser (elsewhere: the wallet's own
// extension, Android's Mobile Wallet Adapter, or the wallet's in-app browser).
const IOS=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
// Reaching a wallet app from the home-screen app: there an https link to another site opens in a small in-app browser, and
// iOS won't hand an app's universal link (phantom.app/ul/…, solflare.com/ul/…) over to the app from it: you just see the
// wallet's website. So in the home-screen app: Phantom by its own phantom:// links (docs.phantom.com: phantom://<version>/
// <method>, phantom://browse/…); the others through /wr/open, a page of this site with a button linking to the wallet's
// universal link (a tap on a link to another site, which iOS does hand to the app). Every OPEN also offers the other way.
// In Safari: the universal link as is.
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const PHU=/^https:\/\/phantom\.(app|com)\/ul\//;
const hop=u=>location.origin+'/wr/open?to='+encodeURIComponent(u);
const appLink=u=>!standalone()?u:PHU.test(u)?u.replace(PHU,'phantom://'):hop(u);
const altLink=u=>!standalone()?'':PHU.test(u)?hop(u):u;
const appA=(u,label,cls)=>{const l=appLink(u),alt=altLink(u);
  return `<a class="t7a-btn ${cls||''}" href="${esc(l)}"${/^https?:/.test(l)?' target="_blank" rel="noopener"':''}>${label}</a>`
    +(alt?`<a class="t7a-alt" href="${esc(alt)}" target="_blank" rel="noopener">didn't open? try this</a>`:'')};
// WalletConnect (AppKit) opens a wallet app's own link (jupiter://wc?uri=…) with window.open(link,'_self'). In the home-screen
// app that can land in the in-app browser, where an app link dies silently: send app links (any scheme but http(s)) to a
// plain page navigation instead, which iOS hands to the app.
// And because iOS lets an app link through for sure only from a tap, it also shows OPEN <WALLET>, a real link to tap (over
// AppKit's panel), until the connect or the signing it was for is over. Covers connecting and every signing request.
let WC_NAME='';
function appSheet(link){const n=WC_NAME||((/^([a-z0-9]+):/i.exec(link)||[])[1]||'wallet').replace(/^./,c=>c.toUpperCase()),N=esc(n).toUpperCase();
  modal(`<h3>OPEN ${N}</h3><p>Tap <b>OPEN ${N}</b>, approve in ${esc(n)}, then switch back to this app.</p>
  <div class="t7a-list"><a class="t7a-btn pri" href="${esc(link)}">OPEN ${N} ↗</a></div>`);M._app=true;M.style.zIndex=1002}
function closeApp(){if(M&&M._app){M._app=false;M.style.zIndex='';close()}}
{const WO=window.open;window.open=function(u){try{const s=String(u||'');
  if(/^[a-z][a-z0-9+.-]*:/i.test(s)&&!/^(https?|about|blob|data|javascript):/i.test(s)){appSheet(s);location.href=s;return null}}catch(e){}
  return WO.apply(this,arguments)}}
let DLP=null;
const dl=()=>DLP||(DLP=import('/terminal/wc/dl.js').catch(e=>{DLP=null;throw e}));
// the "open the wallet" sheet: a real link the visitor taps (iOS opens a wallet app only from a tap), until the answer is in
function viaWallet(name,req,what){const tok={};
  modal(`<h3>${what==='connect'?'CONNECT '+esc(name).toUpperCase():'APPROVE IN '+esc(name).toUpperCase()}</h3>
  <p>1. Tap <b>OPEN ${esc(name).toUpperCase()}</b> and ${what==='connect'?'approve the connection':'approve the transaction'}.<br>2. ${esc(name)} then opens a page in Safari: <b>switch back to this app</b> and it finishes here.</p>
  <div class="t7a-list">${appA(req.url,'OPEN '+esc(name).toUpperCase()+' ↗','pri')}</div>
  <div class="t7a-msg">Waiting for ${esc(name)}…</div>`);M._tok=tok;
  return DLM.answer(req.id,()=>!M.classList.contains('show')||M._tok!==tok).finally(()=>{if(M._tok===tok)close()})}
let DLM=null;
function dlWallet(name,icon){
  const ls=new Set();let accts=[];
  const set=a=>{if((accts[0]?.address||null)===(a||null))return;accts=a?[{address:a,publicKey:b58d(a),chains:['solana:mainnet'],features:FEAT}]:[];ls.forEach(f=>{try{f({accounts:accts})}catch(e){}})};
  const m=async()=>DLM||(DLM=await dl());
  const sign=async b=>{const d=await m(),r=d.signRequest(name,b);return r.finish(await viaWallet(name,r,'sign'))};
  return{version:'1.0.0',name,icon,chains:['solana:mainnet'],get accounts(){return accts},features:{
    'standard:connect':{version:'1.0.0',connect:async({silent}={})=>{const d=await m(),had=d.address(name);
      if(had||silent){set(had);return{accounts:accts}}
      const r=d.connectRequest(name);set(r.finish(await viaWallet(name,r,'connect')));return{accounts:accts}}},
    'standard:disconnect':{version:'1.0.0',disconnect:async()=>{(await m()).disconnect(name);set(null)}},
    'standard:events':{version:'1.0.0',on:(ev,f)=>{if(ev!=='change')return()=>{};ls.add(f);return()=>ls.delete(f)}},
    'solana:signTransaction':{version:'1.0.0',supportedTransactionVersions:['legacy',0],signTransaction:async(...ins)=>{const o=[];
      for(const i of ins)o.push({signedTransaction:await sign(i.transaction)});return o}},
    'solana:signAndSendTransaction':{version:'1.0.0',supportedTransactionVersions:['legacy',0],signAndSendTransaction:async(...ins)=>{const o=[];
      for(const i of ins){const st=await sign(i.transaction);
        const r=await(await fetch(RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'sendTransaction',params:[b64(st),{encoding:'base64'}]})})).json();
        if(r.error)throw new Error(r.error.message);o.push({signature:b58d(r.result)})}return o}}}}}
const DLW=IOS?[dlWallet('Phantom','data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiB2aWV3Qm94PSIwIDAgMTA4IDEwOCIgZmlsbD0ibm9uZSI+CjxyZWN0IHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiByeD0iMjYiIGZpbGw9IiNBQjlGRjIiLz4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik00Ni41MjY3IDY5LjkyMjlDNDIuMDA1NCA3Ni44NTA5IDM0LjQyOTIgODUuNjE4MiAyNC4zNDggODUuNjE4MkMxOS41ODI0IDg1LjYxODIgMTUgODMuNjU2MyAxNSA3NS4xMzQyQzE1IDUzLjQzMDUgNDQuNjMyNiAxOS44MzI3IDcyLjEyNjggMTkuODMyN0M4Ny43NjggMTkuODMyNyA5NCAzMC42ODQ2IDk0IDQzLjAwNzlDOTQgNTguODI1OCA4My43MzU1IDc2LjkxMjIgNzMuNTMyMSA3Ni45MTIyQzcwLjI5MzkgNzYuOTEyMiA2OC43MDUzIDc1LjEzNDIgNjguNzA1MyA3Mi4zMTRDNjguNzA1MyA3MS41NzgzIDY4LjgyNzUgNzAuNzgxMiA2OS4wNzE5IDY5LjkyMjlDNjUuNTg5MyA3NS44Njk5IDU4Ljg2ODUgODEuMzg3OCA1Mi41NzU0IDgxLjM4NzhDNDcuOTkzIDgxLjM4NzggNDUuNjcxMyA3OC41MDYzIDQ1LjY3MTMgNzQuNDU5OEM0NS42NzEzIDcyLjk4ODQgNDUuOTc2OCA3MS40NTU2IDQ2LjUyNjcgNjkuOTIyOVpNODMuNjc2MSA0Mi41Nzk0QzgzLjY3NjEgNDYuMTcwNCA4MS41NTc1IDQ3Ljk2NTggNzkuMTg3NSA0Ny45NjU4Qzc2Ljc4MTYgNDcuOTY1OCA3NC42OTg5IDQ2LjE3MDQgNzQuNjk4OSA0Mi41Nzk0Qzc0LjY5ODkgMzguOTg4NSA3Ni43ODE2IDM3LjE5MzEgNzkuMTg3NSAzNy4xOTMxQzgxLjU1NzUgMzcuMTkzMSA4My42NzYxIDM4Ljk4ODUgODMuNjc2MSA0Mi41Nzk0Wk03MC4yMTAzIDQyLjU3OTVDNzAuMjEwMyA0Ni4xNzA0IDY4LjA5MTYgNDcuOTY1OCA2NS43MjE2IDQ3Ljk2NThDNjMuMzE1NyA0Ny45NjU4IDYxLjIzMyA0Ni4xNzA0IDYxLjIzMyA0Mi41Nzk1QzYxLjIzMyAzOC45ODg1IDYzLjMxNTcgMzcuMTkzMSA2NS43MjE2IDM3LjE5MzFDNjguMDkxNiAzNy4xOTMxIDcwLjIxMDMgMzguOTg4NSA3MC4yMTAzIDQyLjU3OTVaIiBmaWxsPSIjRkZGREY4Ii8+Cjwvc3ZnPg=='),dlWallet('Solflare','data:image/svg+xml;base64,PHN2ZyBmaWxsPSJub25lIiBoZWlnaHQ9IjUwIiB2aWV3Qm94PSIwIDAgNTAgNTAiIHdpZHRoPSI1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayI+PGxpbmVhckdyYWRpZW50IGlkPSJhIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNmZmMxMGIiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNmYjNmMmUiLz48L2xpbmVhckdyYWRpZW50PjxsaW5lYXJHcmFkaWVudCBpZD0iYiIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIHgxPSI2LjQ3ODM1IiB4Mj0iMzQuOTEwNyIgeGxpbms6aHJlZj0iI2EiIHkxPSI3LjkyIiB5Mj0iMzMuNjU5MyIvPjxyYWRpYWxHcmFkaWVudCBpZD0iYyIgY3g9IjAiIGN5PSIwIiBncmFkaWVudFRyYW5zZm9ybT0ibWF0cml4KDQuOTkyMTg4MzIgMTIuMDYzODc5NjMgLTEyLjE4MTEzNjU1IDUuMDQwNzEwNzQgMjIuNTIwMiAyMC42MTgzKSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIHI9IjEiIHhsaW5rOmhyZWY9IiNhIi8+PHBhdGggZD0ibTI1LjE3MDggNDcuOTEwNGMuNTI1IDAgLjk1MDcuNDIxLjk1MDcuOTQwM3MtLjQyNTcuOTQwMi0uOTUwNy45NDAyLS45NTA3LS40MjA5LS45NTA3LS45NDAyLjQyNTctLjk0MDMuOTUwNy0uOTQwM3ptLTEuMDMyOC00NC45MTU2NWMuNDY0Ni4wMzgzNi44Mzk4LjM5MDQuOTAyNy44NDY4MWwxLjEzMDcgOC4yMTU3NGMuMzc5OCAyLjcxNDMgMy42NTM1IDMuODkwNCA1LjY3NDMgMi4wNDU5bDExLjMyOTEtMTAuMzExNThjLjI3MzMtLjI0ODczLjY5ODktLjIzMTQ5Ljk1MDcuMDM4NTEuMjMwOS4yNDc3Mi4yMzc5LjYyNjk3LjAxNjEuODgyNzdsLTkuODc5MSAxMS4zOTU4Yy0xLjgxODcgMi4wOTQyLS40NzY4IDUuMzY0MyAyLjI5NTYgNS41OTc4bDguNzE2OC44NDAzYy40MzQxLjA0MTguNzUxNy40MjM0LjcwOTMuODUyNC0uMDM0OS4zNTM3LS4zMDc0LjYzOTUtLjY2MjguNjk0OWwtOS4xNTk0IDEuNDMwMmMtMi42NTkzLjM2MjUtMy44NjM2IDMuNTExNy0yLjEzMzkgNS41NTc2bDMuMjIgMy43OTYxYy4yNTk0LjMwNTguMjE4OC43NjE1LS4wOTA4IDEuMDE3OC0uMjYyMi4yMTcyLS42NDE5LjIyNTYtLjkxMzguMDIwM2wtMy45Njk0LTIuOTk3OGMtMi4xNDIxLTEuNjEwOS01LjIyOTctLjI0MTctNS40NTYxIDIuNDI0M2wtLjg3NDcgMTAuMzk3NmMtLjAzNjIuNDI5NS0uNDE3OC43NDg3LS44NTI1LjcxMy0uMzY5LS4wMzAzLS42NjcxLS4zMDk3LS43MTcxLS42NzIxbC0xLjM4NzEtMTAuMDQzN2MtLjM3MTctMi43MTQ0LTMuNjQ1NC0zLjg5MDQtNS42NzQzLTIuMDQ1OWwtMTIuMDUxOTUgMTAuOTc0Yy0uMjQ5NDcuMjI3MS0uNjM4MDkuMjExNC0uODY4LS4wMzUtLjIxMDk0LS4yMjYyLS4yMTczNS0uNTcyNC0uMDE0OTMtLjgwNmwxMC41MTgxOC0xMi4xMzg1YzEuODE4Ny0yLjA5NDIuNDg0OS01LjM2NDQtMi4yODc2LTUuNTk3OGwtOC43MTg3Mi0uODQwNWMtLjQzNDEzLS4wNDE4LS43NTE3Mi0uNDIzNS0uNzA5MzYtLjg1MjQuMDM0OTMtLjM1MzcuMzA3MzktLjYzOTQuNjYyNy0uNjk1bDkuMTUzMzgtMS40Mjk5YzIuNjU5NC0uMzYyNSAzLjg3MTgtMy41MTE3IDIuMTQyMS01LjU1NzZsLTIuMTkyLTIuNTg0MWMtLjMyMTctLjM3OTItLjI3MTMtLjk0NDMuMTEyNi0xLjI2MjEuMzI1My0uMjY5NC43OTYzLS4yNzk3IDEuMTMzNC0uMDI0OWwyLjY5MTggMi4wMzQ3YzIuMTQyMSAxLjYxMDkgNS4yMjk3LjI0MTcgNS40NTYxLTIuNDI0M2wuNzI0MS04LjU1OTk4Yy4wNDU3LS41NDA4LjUyNjUtLjk0MjU3IDEuMDczOS0uODk3Mzd6bS0yMy4xODczMyAyMC40Mzk2NWMuNTI1MDQgMCAuOTUwNjcuNDIxLjk1MDY3Ljk0MDNzLS40MjU2My45NDAzLS45NTA2Ny45NDAzYy0uNTI1MDQxIDAtLjk1MDY3LS40MjEtLjk1MDY3LS45NDAzcy40MjU2MjktLjk0MDMuOTUwNjctLjk0MDN6bTQ3LjY3OTczLS45NTQ3Yy41MjUgMCAuOTUwNy40MjEuOTUwNy45NDAzcy0uNDI1Ny45NDAyLS45NTA3Ljk0MDItLjk1MDctLjQyMDktLjk1MDctLjk0MDIuNDI1Ny0uOTQwMy45NTA3LS45NDAzem0tMjQuNjI5Ni0yMi40Nzk3Yy41MjUgMCAuOTUwNi40MjA5NzMuOTUwNi45NDAyNyAwIC41MTkzLS40MjU2Ljk0MDI3LS45NTA2Ljk0MDI3LS41MjUxIDAtLjk1MDctLjQyMDk3LS45NTA3LS45NDAyNyAwLS41MTkyOTcuNDI1Ni0uOTQwMjcuOTUwNy0uOTQwMjd6IiBmaWxsPSJ1cmwoI2IpIi8+PHBhdGggZD0ibTI0LjU3MSAzMi43NzkyYzQuOTU5NiAwIDguOTgwMi0zLjk3NjUgOC45ODAyLTguODgxOSAwLTQuOTA1My00LjAyMDYtOC44ODE5LTguOTgwMi04Ljg4MTlzLTguOTgwMiAzLjk3NjYtOC45ODAyIDguODgxOWMwIDQuOTA1NCA0LjAyMDYgOC44ODE5IDguOTgwMiA4Ljg4MTl6IiBmaWxsPSJ1cmwoI2MpIi8+PC9zdmc+')]:[];
const ours=w=>WCW.includes(w)||DLW.includes(w);
function regWC(api){if(!window.phantom?.solana&&!window.solflare&&!window.backpack&&!window.jupiter)try{api.register(...WCW,...DLW)}catch(e){}}
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
function modal(html){css();if(!M){M=document.createElement('div');M.id='t7aM';document.body.appendChild(M);M.addEventListener('click',e=>{if(e.target===M)close()})}
  M.innerHTML=`<div class="t7a-box"><button type="button" class="t7a-x" data-t7a="close" title="Close">✕</button>${html}</div>`;M.classList.add('show')}
function close(){if(M)M.classList.remove('show');draw()}
async function copy(t){try{await navigator.clipboard.writeText(t);return true}catch(e){
  const a=document.createElement('textarea');a.value=t;a.style.cssText='position:fixed;opacity:0';document.body.appendChild(a);a.select();
  let ok=false;try{ok=document.execCommand('copy')}catch(_){}a.remove();return ok}}
function openIn(){const here=location.href,E=encodeURIComponent,ref=E(location.origin),and=/android/i.test(navigator.userAgent);
  const ca=new URLSearchParams(location.search).get('ca')||'',mint=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca)?ca:'';   // a token page's coin
  const apps=[['Phantom',`https://phantom.app/ul/browse/${E(here)}?ref=${ref}`],['Solflare',`https://solflare.com/ul/v1/browse/${E(here)}?ref=${ref}`],
    ['Backpack',`https://backpack.app/ul/v1/browse/${E(here)}?ref=${ref}`]];
  modal(`<h3>OPEN IN WALLET APP</h3>
  <p>Opens this page inside your wallet app's browser, where the swap connects to it directly.</p>
  <div class="t7a-list">${apps.map(([n,u])=>appA(u,n+' ↗')).join('')}
  ${mint?appA(`https://jup.ag/tokens/${mint}`,'Jupiter Mobile · trade this coin there ↗'):''}
  <button type="button" class="t7a-btn" data-t7a="jupm">Jupiter Mobile · copy link (open it in its browser)</button></div>
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
.t7a-alt{display:block;text-align:right;font-size:10px;margin:-2px 2px 4px;color:var(--dim,#5d6a8f)!important}
.t7a-box .pri{border-color:var(--amber,#ffd23f);color:var(--amber,#ffd23f)}
.t7a-list{display:grid;gap:6px;margin:8px 0}.t7a-acts{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
.t7a-mono{display:block;font-family:ui-monospace,monospace;font-size:11px;word-break:break-all;background:var(--bg,#04060f);border:1px solid var(--line,#1a2444);padding:8px;margin:6px 0;user-select:all;-webkit-user-select:all}
.t7a-msg{min-height:1em;font-size:11px;color:var(--green,#39ff6a)}`;document.head.appendChild(s)}
window.T7A={mount,openIn};
dispatchEvent(new Event('t7a-ready'));
})();
