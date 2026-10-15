// Phantom and Solflare from the iPhone home-screen app (built into terminal/wc/dl.js; loaded by terminal/walletapp.js).
// Neither can be reached over WalletConnect from the same phone, so this uses their own deeplink protocol (the same in both:
// docs.phantom.com/phantom-deeplinks, docs.solflare.com/solflare/technical/deeplinks). They answer by opening redirect_link,
// which on an iPhone opens in Safari, not in the app: it points at the site's relay (/wr/back, worker/site.js), which keeps the
// answer, and the app collects it from /wr/get when the visitor switches back. Answers are encrypted for this app's own
// x25519 key (the shared secret with the wallet), so the relay only ever sees ciphertext.
// Stored per wallet: that encryption key, the wallet's encryption key, the session token and the address. None of them can
// move funds: every transaction is still approved in the wallet app.
import nacl from 'tweetnacl'

const WALLETS = {
  Phantom: { base: 'https://phantom.app/ul/v1/', key: 'phantom_encryption_public_key' },
  Solflare: { base: 'https://solflare.com/ul/v1/', key: 'solflare_encryption_public_key' }
}
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
export function b58e(u8) { let n = 0n, o = ''; for (const b of u8) n = n * 256n + BigInt(b); while (n > 0n) { o = B58[Number(n % 58n)] + o; n /= 58n } for (const b of u8) { if (b) break; o = '1' + o } return o }
export function b58d(s) { let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error('not base58'); n = n * 58n + BigInt(i) } const o = []; while (n > 0n) { o.unshift(Number(n % 256n)); n /= 256n } for (const c of s) { if (c !== '1') break; o.unshift(0) } return Uint8Array.from(o) }
const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('')
const enc = new TextEncoder(), dec = new TextDecoder()

const LS = 't7dl'
const all = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}') } catch (e) { return {} } }
const put = (name, v) => { const a = all(); if (v) a[name] = v; else delete a[name]; try { localStorage.setItem(LS, JSON.stringify(a)) } catch (e) {} }
export const address = name => all()[name]?.address || null
export const disconnect = name => put(name, null)

const shared = (s, walletKey) => nacl.box.before(b58d(walletKey), b58d(s.sk))
function open(s, walletKey, p) {
  const m = nacl.box.open.after(b58d(p.data), b58d(p.nonce), shared(s, walletKey))
  if (!m) throw new Error('could not read the wallet\'s answer')
  return JSON.parse(dec.decode(m))
}
const relayId = () => hex(nacl.randomBytes(16))
const back = id => `${location.origin}/wr/back?s=${id}`
const q = o => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&')

// a request: the link to open in the wallet (from a tap), and how to read its answer
export function connectRequest(name) {
  const w = WALLETS[name], kp = nacl.box.keyPair(), id = relayId(), s = { sk: b58e(kp.secretKey) }
  return {
    id, url: w.base + 'connect?' + q({ app_url: location.origin, dapp_encryption_public_key: b58e(kp.publicKey), redirect_link: back(id), cluster: 'mainnet-beta' }),
    finish(p) {
      const d = open(s, p[w.key], p)
      put(name, { sk: s.sk, wk: p[w.key], session: d.session, address: d.public_key })
      return d.public_key
    }
  }
}
export function signRequest(name, txBytes) {
  const w = WALLETS[name], s = all()[name]; if (!s) throw new Error(name + ' is not connected')
  const id = relayId(), nonce = nacl.randomBytes(24)
  const payload = nacl.box.after(enc.encode(JSON.stringify({ transaction: b58e(txBytes), session: s.session })), nonce, shared(s, s.wk))
  return {
    id, url: w.base + 'signTransaction?' + q({ dapp_encryption_public_key: b58e(nacl.box.keyPair.fromSecretKey(b58d(s.sk)).publicKey), nonce: b58e(nonce), redirect_link: back(id), payload: b58e(payload) }),
    finish(p) { return b58d(open(s, s.wk, p).transaction) }
  }
}
// the wallet's answer from the relay: polls (and at once when the app comes back to the front); stop() gives up
export function answer(id, stopped) {
  return new Promise((res, rej) => {
    let t = null, busy = false
    const done = (f, v) => { clearTimeout(t); clearTimeout(t2); removeEventListener('visibilitychange', now); f(v) }
    const poll = async () => {
      if (stopped()) return done(rej, new Error('Cancelled'))
      if (busy) return; busy = true
      try {
        const r = await fetch('/wr/get?s=' + id, { cache: 'no-store' })
        if (r.status === 200) { const p = await r.json(); return done(p.errorCode ? rej : res, p.errorCode ? new Error(p.errorMessage || 'Rejected in the wallet') : p) }
      } catch (e) {} finally { busy = false }
      t = setTimeout(poll, document.hidden ? 4000 : 1500)
    }
    const now = () => { if (!document.hidden) { clearTimeout(t); poll() } }
    addEventListener('visibilitychange', now)
    const t2 = setTimeout(() => done(rej, new Error('Timed out waiting for the wallet')), 10 * 60e3)
    poll()
  })
}
