// ⚡ INSTANT TRADES + OPEN IN WALLET APP: the bar above Jupiter's swap widget (token page, launch radar).
// Instant trades: a separate wallet made on this device and kept in this site's storage (on the home-screen app: that app's
// storage). Jupiter's widget gets it through its wallet passthrough and swaps sign right away, no wallet pop-up. The visitor
// funds it from their own wallet, backs up its key (it imports into Phantom / Solflare / Backpack / Jupiter) and withdraws.
// No outside wallet can be told to skip its approval: this is the only way to get no pop-ups, so it's opt-in and warns.
// Open in wallet app: reopens this page in Phantom's, Solflare's or Backpack's browser (Jupiter Mobile has no link for it:
// copy the link, paste it in its browser). The home-screen app on an iPhone can't get a wallet's answer back any other way.
// Pages: T7W.mount(el, reinit) draws the bar in el (reinit: re-run Jupiter.init, called when the mode changes);
// Object.assign(props, await T7W.props()) when calling Jupiter.init.
(()=>{
const KEY='t7iw',RPC='https://solana-rpc.publicnode.com',W3U='https://esm.sh/@solana/web3.js@1.98.0',WARN=1,   // WARN: SOL past which it nags
  ICON='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#04060f"/><path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="#ffd23f"/></svg>');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ld=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){return null}};
const sv=o=>{try{o?localStorage.setItem(KEY,JSON.stringify(o)):localStorage.removeItem(KEY)}catch(e){}};
const st=()=>ld()||{};
const short=a=>a?a.slice(0,4)+'…'+a.slice(-4):'';
// ---------- base58 (keys and addresses) ----------
const B58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58e(u8){let n=0n,o='';for(const b of u8)n=n*256n+BigInt(b);while(n>0n){o=B58[Number(n%58n)]+o;n/=58n}
  for(const b of u8){if(b)break;o='1'+o}return o}
function b58d(s){let n=0n;for(const c of s){const i=B58.indexOf(c);if(i<0)throw new Error('not base58');n=n*58n+BigInt(i)}
  const o=[];while(n>0n){o.unshift(Number(n%256n));n/=256n}for(const c of s){if(c!=='1')break;o.unshift(0)}return Uint8Array.from(o)}
const b64=u8=>{let s='';for(const b of u8)s+=String.fromCharCode(b);return btoa(s)};
// ---------- chain ----------
let W3=null,KP=null;
const web3=async()=>W3||(W3=await import(W3U));
async function rpc(method,params){const r=await fetch(RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const d=await r.json();if(d.error)throw new Error(d.error.message);return d.result}
async function keypair(){const s=st();if(!s.sk)return null;if(KP&&KP.sk===s.sk)return KP.kp;
  const w=await web3();KP={sk:s.sk,kp:w.Keypair.fromSecretKey(b58d(s.sk))};return KP.kp}
// signs whatever Jupiter's widget hands it (only the widget gets this wallet), in the wallet's own web3.js copy
async function signTx(tx){const k=await keypair();if(!k)throw new Error('Instant wallet is gone from this device');const w=await web3();
  if('version' in tx){const v=w.VersionedTransaction.deserialize(tx.serialize());v.sign([k]);return v}
  const t=w.Transaction.from(tx.serialize({requireAllSignatures:false,verifySignatures:false}));t.partialSign(k);return t}
let BAL=null,balAt=0;
async function balance(force){const a=st().addr;if(!a)return null;if(!force&&Date.now()-balAt<10000)return BAL;
  try{BAL=(await rpc('getBalance',[a,{commitment:'confirmed'}])).value/1e9;balAt=Date.now()}catch(e){}return BAL}
// tokens still in the wallet (sell them to SOL in the swap before withdrawing, or import the key into a wallet app)
async function heldTokens(a){let n=0;
  for(const p of ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'])
    try{n+=(await rpc('getTokenAccountsByOwner',[a,{programId:p},{encoding:'jsonParsed',commitment:'confirmed'}])).value
      .filter(x=>+x.account.data.parsed.info.tokenAmount.amount>0).length}catch(e){}return n}
async function send(to,sol){const w=await web3(),k=await keypair(),dest=new w.PublicKey(to);
  if(dest.equals(k.publicKey))throw new Error('that is this wallet');
  const lam=(await rpc('getBalance',[st().addr,{commitment:'confirmed'}])).value,fee=5000+100;   // base fee + priority (1000 CU × 100k µlamports)
  const amt=sol==='max'?lam-fee:Math.round(sol*1e9);
  if(!(amt>0))throw new Error('nothing to withdraw');if(amt+fee>lam)throw new Error('not enough SOL (fee is 0.0000051)');
  if(lam-amt-fee>0&&lam-amt-fee<890880)throw new Error('that would leave dust it can\'t keep: withdraw MAX or less');
  const {blockhash}=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value;
  const tx=new w.Transaction({feePayer:k.publicKey,recentBlockhash:blockhash}).add(
    w.ComputeBudgetProgram.setComputeUnitLimit({units:1000}),w.ComputeBudgetProgram.setComputeUnitPrice({microLamports:100000}),
    w.SystemProgram.transfer({fromPubkey:k.publicKey,toPubkey:dest,lamports:amt}));
  tx.sign(k);return rpc('sendTransaction',[b64(tx.serialize()),{encoding:'base64',preflightCommitment:'confirmed'}])}
// ---------- Jupiter's widget ----------
function ctx(){const pk=new W3.PublicKey(st().addr),off=async()=>setOn(false);
  const adapter={name:'⚡ Instant wallet',icon:ICON,url:location.origin,publicKey:pk,connected:true,connecting:false,readyState:'Installed',
    supportedTransactionVersions:new Set(['legacy',0]),connect:async()=>{},disconnect:off,signTransaction:signTx,on(){return adapter},off(){return adapter},emit(){}};
  return{autoConnect:false,wallets:[],wallet:{adapter,readyState:'Installed'},publicKey:pk,connected:true,connecting:false,disconnecting:false,
    select(){},connect:async()=>{},disconnect:off,signTransaction:signTx,signAllTransactions:async t=>{const o=[];for(const x of t)o.push(await signTx(x));return o},
    sendTransaction:async(tx,conn,o)=>conn.sendRawTransaction((await signTx(tx)).serialize(),o),signMessage:undefined,signIn:undefined}}
async function props(){const s=st();if(!s.on||!s.sk)return{};try{await web3();await keypair()}catch(e){return{}}
  return{enableWalletPassthrough:true,passthroughWalletContextState:ctx(),onRequestConnectWallet:()=>panel()}}
// ---------- the bar ----------
const BARS=new Set();
function mount(el,reinit){if(!el)return;el._t7r=reinit;el.classList.add('t7w');BARS.add(el);css();draw();balance().then(draw)}
const STD=new Set();   // Wallet Standard wallets in this browser (= we're inside a wallet, or one is installed)
addEventListener('wallet-standard:register-wallet',e=>{try{e.detail({register:(...w)=>{w.forEach(x=>STD.add(x));return()=>{}}})}catch(_){}});
try{dispatchEvent(new CustomEvent('wallet-standard:app-ready',{detail:{register:(...w)=>{w.forEach(x=>STD.add(x));return()=>{}}}}))}catch(_){}
const phone=()=>matchMedia('(pointer:coarse)').matches;
const inWallet=()=>!!(window.phantom?.solana||window.solflare||window.backpack||window.jupiter||STD.size||/Phantom|Solflare|Backpack|Jupiter/i.test(navigator.userAgent));
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
function draw(){const s=st(),b=BAL==null?'…':BAL.toFixed(BAL<10?3:2);
  for(const el of BARS){if(!el.isConnected){BARS.delete(el);continue}
    const oi=phone()&&!inWallet()?'<button type="button" data-t7="openin">📱 OPEN IN WALLET APP</button>':'';
    let h;
    if(s.on&&s.sk)h=`<div class="t7w-row on"><button type="button" class="t7w-main" data-t7="panel" title="Instant wallet ${esc(s.addr)}: manage">⚡ INSTANT ON · <b>${b} SOL</b></button>
      <button type="button" data-t7="fund">FUND</button><button type="button" data-t7="off" title="Back to your own wallet (approve each swap)">OFF</button></div>`;
    else if(s.sk)h=`<div class="t7w-row"><button type="button" class="t7w-main" data-t7="on">⚡ INSTANT TRADES <b class="o">OFF</b> · ${b} SOL · TURN ON</button>${oi}</div>`;
    else h=`<div class="t7w-row"><button type="button" class="t7w-main" data-t7="setup" title="Swap with no wallet pop-up">⚡ INSTANT TRADES <b class="o">OFF</b></button>${oi}</div>`;
    const w=[];
    if(s.sk&&!s.bk)w.push('⚠ Its key isn\'t backed up. Lose this app\'s data and the SOL is gone. <a href="#" data-t7="backup">BACK UP</a>');
    if(s.sk&&BAL>WARN)w.push(`⚠ ${BAL.toFixed(2)} SOL sits in a hot wallet on this device. Keep only what you trade with. <a href="#" data-t7="withdraw">WITHDRAW</a>`);
    if(s.on&&s.sk)w.push('Swaps go through with no wallet pop-up.');
    el.innerHTML=h+(w.length?`<div class="t7w-note">${w.join('<br>')}</div>`:'')}}
async function setOn(on){const s=st();if(!s.sk)return;s.on=!!on;sv(s);draw();
  for(const el of BARS)if(el.isConnected&&el._t7r)try{await el._t7r()}catch(e){}}
setInterval(()=>{if(st().sk&&[...BARS].some(e=>e.isConnected)&&!document.hidden)balance(true).then(draw)},20000);
// ---------- the modal ----------
let M=null,poll=null;
function modal(html){if(!M){M=document.createElement('div');M.id='t7wM';document.body.appendChild(M);
    M.addEventListener('click',e=>{if(e.target===M)close()})}
  clearInterval(poll);M.innerHTML=`<div class="t7w-box"><button type="button" class="t7w-x" data-t7="close" title="Close">✕</button>${html}</div>`;M.classList.add('show');return M}
function close(){clearInterval(poll);if(M)M.classList.remove('show');draw()}
const msg=(t,c)=>{const e=M&&M.querySelector('.t7w-msg');if(e){e.className='t7w-msg '+(c||'');e.innerHTML=t}};
async function copy(t){try{await navigator.clipboard.writeText(t);return true}catch(e){
  const a=document.createElement('textarea');a.value=t;a.style.cssText='position:fixed;opacity:0';document.body.appendChild(a);a.select();
  let ok=false;try{ok=document.execCommand('copy')}catch(_){}a.remove();return ok}}
function intro(){modal(`<h3>⚡ INSTANT TRADES</h3>
  <p>Swap with <b>no wallet pop-up</b>. This makes a separate wallet that lives only on this device${standalone()?', in this home-screen app':', in this browser'}. You send it some SOL from your own wallet, and Jupiter's swap uses it to trade instantly.</p>
  <p class="t7w-warn"><b>Read this first.</b> Its key is kept in this site's storage, not in a wallet app.<br>
  • Delete the home-screen app or clear the site's data without a backup and the SOL in it is <b>gone</b>.<br>
  • Anyone or anything that gets the key can take what's in it.<br>
  • Keep only what you trade with. Withdraw the rest to your own wallet.</p>
  ${standalone()?'':'<p class="dim">The home-screen app keeps its own storage: a wallet made here won\'t show up there (import the backup key to use it in both).</p>'}
  <label class="t7w-ck"><input type="checkbox" id="t7wOk"> I understand. I'll back up the key and keep small amounts in it.</label>
  <div class="t7w-acts"><button type="button" class="pri" data-t7="create">CREATE INSTANT WALLET</button><button type="button" data-t7="import">IMPORT A BACKUP KEY</button></div>
  <div class="t7w-msg"></div>`)}
async function create(){if(!M.querySelector('#t7wOk')?.checked)return msg('Tick the box first.','err');
  try{msg('Making it…');const w=await web3(),k=w.Keypair.generate();
    sv({sk:b58e(k.secretKey),addr:k.publicKey.toBase58(),on:false,bk:false,at:Date.now()});KP=null;BAL=0;balAt=Date.now();
    try{navigator.storage?.persist?.()}catch(e){}   // ask the browser not to clear it on its own
    backup(true)}catch(e){msg('Couldn\'t make it: '+esc(e.message||e),'err')}}
function importer(){modal(`<h3>IMPORT A BACKUP KEY</h3>
  <p>Paste the private key you backed up from an instant wallet (a long base58 string, or a [n,n,…] array). It becomes this device's instant wallet.</p>
  <p class="t7w-warn">Only use a key made for this. Never paste your main wallet's key into a website.</p>
  <textarea id="t7wKey" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
  <div class="t7w-acts"><button type="button" class="pri" data-t7="doimport">IMPORT</button><button type="button" data-t7="setup">BACK</button></div><div class="t7w-msg"></div>`)}
async function doImport(){const v=(M.querySelector('#t7wKey').value||'').trim();if(!v)return msg('Paste a key.','err');
  if(st().sk)return msg('This device already has an instant wallet. Forget it first.','err');
  try{const w=await web3(),raw=v[0]==='['?Uint8Array.from(JSON.parse(v)):b58d(v);if(raw.length!==64)throw new Error('a private key is 64 bytes');
    const k=w.Keypair.fromSecretKey(raw);sv({sk:b58e(k.secretKey),addr:k.publicKey.toBase58(),on:true,bk:true,at:Date.now()});KP=null;
    try{navigator.storage?.persist?.()}catch(e){}await balance(true);await setOn(true);manage()}
  catch(e){msg('That isn\'t a valid key: '+esc(e.message||e),'err')}}
function backup(first){const s=st();modal(`<h3>${first?'STEP 1 · ':''}BACK UP THE KEY</h3>
  <p>This key <b>is</b> the wallet. Save it somewhere safe (a password manager). To see or move everything in it from a wallet app:
  Phantom, Solflare, Backpack or Jupiter → add wallet → <b>import private key</b>.</p>
  <p class="t7w-warn">Anyone with this key can take what's in the wallet. Don't share it or screenshot it into a shared album.</p>
  <div class="t7w-key" id="t7wSk">•••••••• tap SHOW ••••••••</div>
  <div class="t7w-acts"><button type="button" data-t7="showkey">SHOW</button><button type="button" data-t7="copykey">COPY KEY</button>
  <button type="button" class="pri" data-t7="saved">${first?'I SAVED IT · NEXT':'I SAVED IT'}</button></div><div class="t7w-msg"></div>`);
  M.dataset.first=first?'1':''}
function fund(){const s=st(),E=encodeURIComponent,q=a=>`solana:${s.addr}?amount=${a}&label=${E('Instant wallet')}&message=${E('Fund my instant wallet')}`;
  modal(`<h3>FUND THE INSTANT WALLET</h3>
  <p>Send SOL to it from your own wallet. Swaps need a little SOL for fees too (keep ~0.01).</p>
  <div class="t7w-addr">${esc(s.addr)}</div>
  <div class="t7w-acts"><button type="button" class="pri" data-t7="copyaddr">COPY ADDRESS</button></div>
  <p class="dim">Or send from a wallet app on this phone (Solana Pay):</p>
  <div class="t7w-acts">${[0.1,0.25,0.5,1].map(a=>`<a class="t7w-btn" href="${q(a)}">${a} SOL</a>`).join('')}</div>
  <p class="dim">${standalone()?'From the home-screen app: copy the address, send from your wallet app, then come back here.':'Paste the address in your wallet\'s Send screen.'}</p>
  <div class="t7w-bal">Balance: <b id="t7wBal">${BAL==null?'…':BAL.toFixed(4)}</b> SOL</div>
  <div class="t7w-acts"><button type="button" data-t7="panel">DONE</button></div><div class="t7w-msg"></div>`);
  poll=setInterval(async()=>{const b=await balance(true),e=M.querySelector('#t7wBal');if(e&&b!=null)e.textContent=b.toFixed(4)},4000)}
async function withdraw(){const s=st();let to='';try{to=localStorage.getItem('t7iwTo')||''}catch(e){}
  modal(`<h3>WITHDRAW</h3>
  <p>Send SOL from the instant wallet back to your own wallet.</p>
  <label class="t7w-l">To (your wallet's address)</label><input id="t7wTo" value="${esc(to)}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="your Phantom / Solflare / Backpack / Jupiter address">
  <label class="t7w-l">Amount (SOL)</label><div class="t7w-amt"><input id="t7wAmt" inputmode="decimal" value="MAX"><button type="button" data-t7="max">MAX</button></div>
  <div class="t7w-bal">Balance: <b>${BAL==null?'…':BAL.toFixed(4)}</b> SOL</div><div class="t7w-note" id="t7wTok"></div>
  <div class="t7w-acts"><button type="button" class="pri" data-t7="dowithdraw">WITHDRAW</button><button type="button" data-t7="panel">BACK</button></div><div class="t7w-msg"></div>`);
  balance(true).then(b=>{const e=M.querySelector('.t7w-bal b');if(e&&b!=null)e.textContent=b.toFixed(4)});
  const n=await heldTokens(s.addr),e=M.querySelector('#t7wTok');
  if(e&&n)e.innerHTML=`It still holds ${n} token${n>1?'s':''}. This sends SOL only: sell ${n>1?'them':'it'} to SOL in the swap first, or import the backup key into your wallet app to move ${n>1?'them':'it'}.`}
async function doWithdraw(){const to=M.querySelector('#t7wTo').value.trim(),a=M.querySelector('#t7wAmt').value.trim();
  const sol=/^max$/i.test(a)?'max':+a;if(sol!=='max'&&!(sol>0))return msg('Enter an amount or MAX.','err');
  try{const w=await web3();new w.PublicKey(to)}catch(e){return msg('That isn\'t a Solana address.','err')}
  const b=M.querySelector('[data-t7=dowithdraw]');b.disabled=true;msg('Sending…');
  try{const sig=await send(to,sol);try{localStorage.setItem('t7iwTo',to)}catch(e){}
    msg(`Sent. <a href="https://solscan.io/tx/${esc(sig)}" target="_blank" rel="noopener">tx</a>`,'ok');setTimeout(()=>balance(true).then(draw),4000)}
  catch(e){msg('Failed: '+esc(e.message||e),'err')}b.disabled=false}
async function manage(){const s=st();if(!s.sk)return intro();
  modal(`<h3>⚡ INSTANT WALLET</h3>
  <div class="t7w-addr">${esc(s.addr)}</div>
  <div class="t7w-bal">Balance: <b>${BAL==null?'…':BAL.toFixed(4)}</b> SOL · <a href="https://solscan.io/account/${esc(s.addr)}" target="_blank" rel="noopener">view ↗</a></div>
  <p>${s.on?'<b>ON</b>: Jupiter\'s swap uses this wallet and swaps go through with no pop-up.':'<b>OFF</b>: Jupiter\'s swap uses your own wallet (you approve each swap).'}</p>
  <div class="t7w-acts">${s.on?'<button type="button" data-t7="off">TURN OFF</button>':'<button type="button" class="pri" data-t7="on">TURN ON</button>'}
  <button type="button" data-t7="fund">FUND</button><button type="button" data-t7="withdraw">WITHDRAW</button><button type="button" data-t7="backup">BACK UP KEY</button></div>
  <div class="t7w-acts"><button type="button" class="bad" data-t7="forget">FORGET THIS WALLET</button><button type="button" data-t7="copyaddr">COPY ADDRESS</button></div><div class="t7w-msg"></div>`);
  balance(true).then(b=>{const e=M.querySelector('.t7w-bal b');if(e&&b!=null)e.textContent=b.toFixed(4)})}
async function forget(){const b=await balance(true);
  if(b>0||await heldTokens(st().addr)){if(prompt(`It still holds ${b?b.toFixed(4)+' SOL':'tokens'}. Withdraw first. Forgetting it without a backup loses them for good.\n\nType DELETE to forget it anyway.`)!=='DELETE')return}
  else if(!confirm('Forget the instant wallet on this device?'))return;
  sv(null);KP=null;BAL=null;await setOn(false);for(const el of BARS)if(el.isConnected&&el._t7r)try{await el._t7r()}catch(e){}close()}
function openIn(){const here=location.href,E=encodeURIComponent,ref=E(location.origin),and=/android/i.test(navigator.userAgent);
  const apps=[['Phantom',`https://phantom.app/ul/browse/${E(here)}?ref=${ref}`],['Solflare',`https://solflare.com/ul/v1/browse/${E(here)}?ref=${ref}`],
    ['Backpack',`https://backpack.app/ul/v1/browse/${E(here)}?ref=${ref}`]];
  modal(`<h3>OPEN IN WALLET APP</h3>
  <p>Opens this page inside your wallet app's browser, where it connects normally (you approve each swap there).</p>
  <div class="t7w-list">${apps.map(([n,u])=>`<a class="t7w-btn" href="${esc(u)}" target="_blank" rel="noopener">${n} ↗</a>`).join('')}
  <button type="button" class="t7w-btn" data-t7="jupm">Jupiter Mobile · copy link</button></div>
  <div class="t7w-note" id="t7wJm" style="display:none"></div>
  ${and?'<p class="dim">On Android you can also stay here: tap <b>Connect</b> in the swap and pick <b>Mobile Wallet Adapter</b>. It opens your installed wallet app and brings you back.</p>':''}
  <p class="dim">No pop-ups at all: use <a href="#" data-t7="setup">⚡ INSTANT TRADES</a>.</p><div class="t7w-msg"></div>`)}
function panel(){st().sk?manage():intro()}
document.addEventListener('click',async e=>{const t=e.target.closest('[data-t7]');if(!t)return;const a=t.dataset.t7;
  if(t.tagName==='A'&&t.getAttribute('href')==='#')e.preventDefault();
  switch(a){
    case'close':return close();case'setup':return st().sk?manage():intro();case'panel':return panel();
    case'create':return create();case'import':return importer();case'doimport':return doImport();
    case'on':await setOn(true);return M&&M.classList.contains('show')?manage():null;
    case'off':await setOn(false);return M&&M.classList.contains('show')?manage():null;
    case'fund':return fund();case'withdraw':return withdraw();case'dowithdraw':return doWithdraw();
    case'max':M.querySelector('#t7wAmt').value='MAX';return;
    case'backup':return backup(false);
    case'showkey':{const k=M.querySelector('#t7wSk');k.textContent=st().sk||'';k.classList.add('on');return}
    case'copykey':{const ok=await copy(st().sk||'');return msg(ok?'Copied. Paste it somewhere safe now.':'Couldn\'t copy: tap SHOW and copy it by hand.',ok?'ok':'err')}
    case'saved':{const s=st();s.bk=true;sv(s);draw();if(M.dataset.first){await setOn(true);return fund()}return manage()}
    case'copyaddr':{const ok=await copy(st().addr||'');return msg(ok?'Address copied.':'Couldn\'t copy it.',ok?'ok':'err')}
    case'forget':return forget();case'openin':return openIn();
    case'jupm':{const n=M.querySelector('#t7wJm'),ok=await Promise.race([copy(location.href),new Promise(r=>setTimeout(()=>r(false),1500))]);
      n.innerHTML=(ok?'Link copied. ':'Copy this link: <span class="t7w-addr" style="display:block">'+esc(location.href)+'</span>')+'In Jupiter Mobile tap the 🌐 globe (top right), paste it and go.';n.style.display='';return}}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&M&&M.classList.contains('show'))close()});
// ---------- styles (the pages' own colors) ----------
function css(){if(document.getElementById('t7wCss'))return;const s=document.createElement('style');s.id='t7wCss';s.textContent=`
.t7w{margin:0 0 8px;font-size:11px}
.t7w-row{display:flex;gap:6px;flex-wrap:wrap}
.t7w button,.t7w-box button,.t7w-btn{background:var(--panel2,#0d1428);border:1px solid var(--line,#1a2444);color:var(--txt,#c9d3ee);font:inherit;font-size:11px;letter-spacing:.04em;padding:7px 10px;cursor:pointer;text-decoration:none;display:inline-block;text-align:center}
.t7w button:hover,.t7w-box button:hover,.t7w-btn:hover{border-color:var(--amber,#ffd23f);color:#fff}
.t7w .t7w-main{flex:1;text-align:left;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.t7w-row.on .t7w-main{border-color:var(--amber,#ffd23f);color:var(--amber,#ffd23f)}
.t7w b.o{color:var(--dim,#5d6a8f)}
.t7w-note{font-size:10px;color:var(--dim,#5d6a8f);margin-top:5px;line-height:1.45}
.t7w-note a,.t7w-box a{color:var(--amber,#ffd23f)}
#t7wM{position:fixed;inset:0;z-index:200;background:rgba(2,4,10,.82);display:none;align-items:center;justify-content:center;padding:16px}
#t7wM.show{display:flex}
.t7w-box{position:relative;background:var(--panel,#0a0f1f);border:1px solid var(--amber,#ffd23f);color:var(--txt,#c9d3ee);width:100%;max-width:440px;max-height:calc(100vh - 32px);overflow-y:auto;padding:18px 16px 14px;font-size:12px;line-height:1.5}
.t7w-box h3{margin:0 30px 10px 0;color:var(--amber,#ffd23f);font-size:13px;letter-spacing:.08em}
.t7w-box p{margin:0 0 10px}.t7w-box .dim{color:var(--dim,#5d6a8f);font-size:11px}
.t7w-box .t7w-x{position:absolute;top:10px;right:10px;width:30px;height:30px;padding:0}
.t7w-warn{border-left:2px solid var(--red,#ff3355);padding:6px 0 6px 9px;background:rgba(255,51,85,.06)}
.t7w-ck{display:flex;gap:8px;align-items:flex-start;margin:6px 0 10px;cursor:pointer}.t7w-ck input{margin-top:3px}
.t7w-acts{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
.t7w-box .pri{border-color:var(--amber,#ffd23f);color:var(--amber,#ffd23f)}.t7w-box .bad{color:var(--red,#ff3355)}
.t7w-box button:disabled{opacity:.5;cursor:default}
.t7w-addr,.t7w-key{font-family:ui-monospace,monospace;font-size:11px;word-break:break-all;background:var(--bg,#04060f);border:1px solid var(--line,#1a2444);padding:8px;margin:6px 0;user-select:all;-webkit-user-select:all}
.t7w-key{color:var(--dim,#5d6a8f)}.t7w-key.on{color:var(--txt,#c9d3ee)}
.t7w-bal{margin:6px 0}
.t7w-list{display:grid;gap:6px;margin:8px 0}
.t7w-l{display:block;font-size:10px;color:var(--dim,#5d6a8f);margin:8px 0 3px}
.t7w-box input:not([type]),.t7w-box textarea{width:100%;box-sizing:border-box;background:var(--bg,#04060f);border:1px solid var(--line,#1a2444);color:var(--txt,#c9d3ee);font:inherit;font-size:16px;padding:7px 8px}
.t7w-box textarea{font-family:ui-monospace,monospace;font-size:13px;resize:vertical}
.t7w-amt{display:flex;gap:6px}.t7w-amt input{flex:1}
.t7w-msg{min-height:1em;font-size:11px}.t7w-msg.ok{color:var(--green,#39ff6a)}.t7w-msg.err{color:var(--red,#ff3355)}`;document.head.appendChild(s)}
window.T7W={mount,props,panel,openIn,on:()=>!!(st().on&&st().sk),refresh:()=>balance(true).then(draw)};
dispatchEvent(new Event('t7w-ready'));
})();
