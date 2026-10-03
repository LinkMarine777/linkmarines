// Shared by the alerts pages: the API, the wallet picker (Wallet Standard + older injected wallets, the buyer always picks),
// sign-in with a wallet, and paying an order (browser wallet, or a phone wallet through a Solana Pay QR / link).
(function () {
  const API = '/alerts/api';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function api(path, body, method) {
    const r = await fetch(API + path, body === undefined && !method ? { cache: 'no-store' } :
      { method: method || 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || ('error ' + r.status)); e.status = r.status; throw e; }
    return d;
  }
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58(u8) { let n = 0n, o = ''; for (const b of u8) n = n * 256n + BigInt(b); while (n > 0n) { o = B58[Number(n % 58n)] + o; n /= 58n; }
    for (const b of u8) { if (b) break; o = '1' + o; } return o; }
  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = u8 => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------- wallets ----------
  const STD = [];
  function addStd(...ws) { ws.forEach(w => { const f = w && w.features || {};
    if (!f['standard:connect'] || !(f['solana:signAndSendTransaction'] || f['solana:signTransaction'])) return;
    if (!(w.chains || []).some(c => String(c).startsWith('solana:'))) return;
    if (!STD.includes(w)) STD.push(w); }); return () => {}; }
  addEventListener('wallet-standard:register-wallet', e => { try { e.detail({ register: addStd }); } catch (_) {} });
  try { dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: { register: addStd } })); } catch (_) {}

  // a Wallet Standard wallet
  function stdProv(w) { let acct = null; const f = w.features; return {
    async connect() { const r = await f['standard:connect'].connect(); acct = (r?.accounts || w.accounts || [])[0];
      if (!acct) throw new Error('wallet returned no account'); return acct.address; },
    async signMessage(bytes) { if (!f['solana:signMessage']) throw new Error("this wallet can't sign in, pick another");
      const [o] = await f['solana:signMessage'].signMessage({ account: acct, message: bytes }); return o.signature; },
    async signAndSend(bytes) {
      if (f['solana:signAndSendTransaction']) { const [o] = await f['solana:signAndSendTransaction'].signAndSendTransaction({ account: acct, chain: 'solana:mainnet', transaction: bytes }); return b58(o.signature); }
      const [o] = await f['solana:signTransaction'].signTransaction({ account: acct, chain: 'solana:mainnet', transaction: bytes });
      return (await api('/send', { transaction: toB64(o.signedTransaction) })).signature; },
    async disconnect() { try { await f['standard:disconnect']?.disconnect(); } catch (_) {} } }; }
  // an older injected wallet (window.phantom.solana style): its transactions are web3.js objects
  let web3 = null;
  function injProv(p) { return {
    async connect() { const r = await p.connect(); return (r?.publicKey || p.publicKey).toString(); },
    async signMessage(bytes) { const r = await p.signMessage(bytes, 'utf8'); return r.signature || r; },
    async signAndSend(bytes) {
      web3 = web3 || await import('https://esm.sh/@solana/web3.js@1.98.0');
      const tx = web3.Transaction.from(bytes);
      if (p.signAndSendTransaction) { const o = await p.signAndSendTransaction(tx); return o.signature || o; }
      const st = await p.signTransaction(tx);
      return (await api('/send', { transaction: toB64(st.serialize()) })).signature; },
    async disconnect() { try { await p.disconnect?.(); } catch (_) {} } }; }
  const WALLETS = [
    { id: 'phantom', name: 'Phantom', get: () => window.phantom?.solana, url: 'https://phantom.app/download' },
    { id: 'solflare', name: 'Solflare', get: () => window.solflare, url: 'https://solflare.com/download' },
    { id: 'backpack', name: 'Backpack', get: () => window.backpack, url: 'https://backpack.app/downloads' },
    { id: 'okx', name: 'OKX Wallet', get: () => window.okxwallet?.solana, url: 'https://www.okx.com/web3' },
    { id: 'coinbase', name: 'Coinbase Wallet', get: () => window.coinbaseSolana, url: 'https://www.coinbase.com/wallet/downloads' },
    { id: 'trust', name: 'Trust Wallet', get: () => window.trustwallet?.solana, url: 'https://trustwallet.com/download' },
    { id: 'magiceden', name: 'Magic Eden', get: () => window.magicEden?.solana, url: 'https://wallet.magiceden.io/' },
  ];
  const wKey = n => String(n || '').toLowerCase().replace(/wallet/g, '').replace(/[^a-z0-9]/g, '');
  function detected() {
    const out = [], names = new Set(), seen = new Set();
    STD.forEach(w => { const k = wKey(w.name); if (names.has(k)) return; names.add(k);
      out.push({ id: 'std:' + k, name: w.name, icon: /^data:image\//.test(w.icon || '') ? w.icon : '', make: () => stdProv(w) }); });
    WALLETS.forEach(w => { let p; try { p = w.get(); } catch (e) {}
      if (p && !seen.has(p) && !names.has(wKey(w.name))) { seen.add(p); names.add(wKey(w.name)); out.push({ ...w, make: () => injProv(p) }); } });
    return out;
  }

  // ---------- modal ----------
  function modal(html) {
    let m = document.getElementById('maModal');
    if (!m) { m = document.createElement('div'); m.id = 'maModal'; m.className = 'modal'; m.innerHTML = '<div class="box"></div>'; document.body.appendChild(m); }
    m.querySelector('.box').innerHTML = html; m.classList.add('show');
    return { el: m.querySelector('.box'), close: () => m.classList.remove('show'), onClose: f => { m.onclick = e => { if (e.target === m) { m.classList.remove('show'); f(); } }; } };
  }
  function pick(title) {
    return new Promise(res => {
      const last = localStorage.getItem('maWallet'), list = detected().sort((a, b) => (b.id === last) - (a.id === last));
      const md = modal(`<h3>${esc(title || 'Pick a wallet')}</h3>` + (list.length
        ? list.map(w => `<button class="wrow" data-w="${esc(w.id)}">${w.icon ? `<img src="${esc(w.icon)}" alt="">` : '<span class="ic"></span>'}<span class="nm">${esc(w.name)}</span><span class="st">${w.id === last ? 'LAST USED' : 'DETECTED'}</span></button>`).join('')
        : WALLETS.slice(0, 4).map(w => `<a class="wrow" href="${w.url}" target="_blank" rel="noopener"><span class="ic"></span><span class="nm">${w.name}</span><span class="st">INSTALL</span></a>`).join('') + '<p class="dim small" style="margin-top:6px">No Solana wallet in this browser. Install one, or pay with your phone.</p>')
        + '<button class="btn block" id="maCancel" style="margin-top:6px">Cancel</button>');
      let done = false; const fin = v => { if (done) return; done = true; md.close(); res(v); };
      md.el.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { const w = list.find(x => x.id === b.dataset.w); if (w) { try { localStorage.setItem('maWallet', w.id); } catch (e) {} fin(w); } });
      md.el.querySelector('#maCancel').onclick = () => fin(null); md.onClose(() => fin(null));
    });
  }
  let prov = null, addr = null;
  async function connect(change, title) {
    if (prov && addr && !change) return { prov, addr };
    const w = await pick(title); if (!w) return null;
    const p = w.make(), a = await p.connect();
    if (prov && prov !== p) await prov.disconnect();
    prov = p; addr = a; return { prov, addr };
  }

  // ---------- sign in with a wallet ----------
  async function signInWallet() {
    const c = await connect(true, 'Sign in with a wallet'); if (!c) return false;
    const { message } = await api('/auth/nonce?address=' + encodeURIComponent(c.addr));
    const sig = await c.prov.signMessage(new TextEncoder().encode(message));
    await api('/auth/wallet', { address: c.addr, message, signature: b58(sig instanceof Uint8Array ? sig : new Uint8Array(sig)) });
    return true;
  }
  // Google: the button only shows when the service has a Google client id
  function googleButton(el, clientId, done) {
    if (!clientId || !el) return;
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => { google.accounts.id.initialize({ client_id: clientId, callback: async r => { try { await api('/auth/google', { credential: r.credential }); done(null); } catch (e) { done(e); } } });
      google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 280 }); };
    document.head.appendChild(s);
  }

  // ---------- paying an order ----------
  // waits for the service to see the payment; onStatus(text, cls) reports progress
  async function waitPaid(orderId, sig, onStatus) {
    for (let i = 0; i < 90; i++) {
      let o; try { o = sig ? await api(`/order/${orderId}/confirm`, { signature: sig }) : await api(`/order/${orderId}`); } catch (e) { o = null; }
      if (o && o.status === 'paid') return o;
      if (o && o.why && o.why !== 'not found') onStatus('Payment check: ' + o.why, 'err');
      await sleep(i < 20 ? 2000 : 4000);
    }
    throw new Error("we haven't seen the payment yet. If it went through it will still count, give it a minute");
  }
  async function payWallet(order, onStatus) {
    const c = await connect(false); if (!c) return null;
    onStatus('Building the transaction…');
    const { transaction } = await api('/pay/' + order.id, { account: c.addr });
    onStatus('Approve it in your wallet…');
    const sig = await c.prov.signAndSend(fromB64(transaction));
    onStatus('Sent. Confirming…', 'ok');
    return waitPaid(order.id, typeof sig === 'string' ? sig : null, onStatus);
  }
  let qrLib = null;
  async function qrImg(text) {
    qrLib = qrLib || await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'; s.onload = () => res(window.qrcode); s.onerror = rej; document.head.appendChild(s); });
    const q = qrLib(0, 'M'); q.addData(text); q.make(); return q.createDataURL(6, 2);
  }
  async function payPhone(order, onStatus) {
    const md = modal(`<h3>Pay with your phone</h3><p class="dim small">Scan with Phantom, Solflare or any Solana Pay wallet, then approve. This window updates by itself.</p>
      <div class="qr"><img id="maQr" alt="Solana Pay QR code"></div><p class="small" style="text-align:center;margin-bottom:12px">${esc(order.amount)}</p>
      <a class="btn pri block" href="${esc(order.payLink)}">Open in wallet app</a><button class="btn block" id="maCancel" style="margin-top:8px">Close</button>`);
    let stop = false; md.el.querySelector('#maCancel').onclick = () => { stop = true; md.close(); }; md.onClose(() => { stop = true; });
    try { md.el.querySelector('#maQr').src = await qrImg(order.payLink); } catch (e) { md.el.querySelector('.qr').style.display = 'none'; }
    onStatus('Waiting for the payment from your phone…');
    for (let i = 0; i < 300 && !stop; i++) {
      await sleep(3000);
      try { const o = await api(`/order/${order.id}`); if (o.status === 'paid') { md.close(); return o; } } catch (e) {}
    }
    md.close();
    return null;
  }

  window.MA = { api, esc, connect, signInWallet, googleButton, payWallet, payPhone, modal,
    get address() { return addr; }, isPhone: () => matchMedia('(pointer:coarse)').matches };
})();
