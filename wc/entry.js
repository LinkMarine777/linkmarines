// WalletConnect for Jupiter's swap widget (built into terminal/wc/ by `npm run build`; loaded by terminal/walletapp.js only when
// someone picks Jupiter Mobile or WalletConnect in the swap's wallet list).
// Same idea as Jupiter's own @jup-ag/jup-mobile-adapter (Reown AppKit + its "jupiter" wallet button), without React: the
// wallet app answers through WalletConnect's relay, not a link back, so it works from the home-screen app on an iPhone too
// (approve in the wallet, then switch back). The wallet keeps its key; the site keeps only the WalletConnect session.
import { createAppKit } from '@reown/appkit'
import { SolanaAdapter } from '@reown/appkit-adapter-solana'
import { solana } from '@reown/appkit/networks'
import { createAppKitWalletButton } from '@reown/appkit-wallet-button'
import { Transaction, VersionedTransaction } from '@solana/web3.js'

// WalletConnect explorer ids (featured first in the "all wallets" list)
const IDS = {
  jupiter: '0ef262ca2a56b88d179c93a21383fee4e135bd7bc6680e5c2356ff8e38301037',
  solflare: '1ca0bdd4747578705b1939af023d120677c64fe6ca76add81fda36e350605e79',
  phantom: 'a797aa35c0fadbfc1a53e7f675162ed5226968b44a19ee3d24385c64d1d3c393',
  backpack: '2bd8c14e035c2d48f184aaa168559e86b0e3433228d3c4075900a221785019b0',
  trust: '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0',
  okx: '971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709'
}
let kit = null, btn = null, addr = null
const subs = new Set()
const account = () => { const a = kit.getAccount('solana'); return a && a.isConnected && a.address ? a.address : null }
const provider = () => kit.getProvider ? kit.getProvider('solana') : kit.getWalletProvider()

export function init({ projectId, name, url, icon }) {
  if (kit) return
  kit = createAppKit({
    adapters: [new SolanaAdapter({ wallets: [] })], networks: [solana], defaultNetwork: solana, projectId,
    metadata: { name, description: name, url, icons: [icon] },
    features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, send: false, receive: false, history: false },
    enableInjected: false, enableCoinbase: false, enableWalletGuide: false,   // wallets in this browser: Jupiter's own list has them
    featuredWalletIds: Object.values(IDS), themeMode: 'dark', themeVariables: { '--w3m-z-index': 1000 }
  })
  btn = createAppKitWalletButton({ namespace: 'solana' })
  kit.subscribeAccount(() => { const n = account(); if (n !== addr) { addr = n; subs.forEach(f => { try { f(addr) } catch (e) {} }) } }, 'solana')
}
export const address = () => addr || (kit && account())
export const onChange = f => { subs.add(f); return () => subs.delete(f) }

// wait for an address; null if the visitor closes AppKit without connecting
function waitFor(ms) {
  return new Promise(res => {
    const a = account(); if (a) return res(a)
    let seenOpen = false
    const t = setTimeout(() => done(null), ms)
    const u1 = onChange(a => { if (a) done(a) })
    const u2 = kit.subscribeState(s => { if (s.open) seenOpen = true; else if (seenOpen && !account()) setTimeout(() => { if (!account()) done(null) }, 1500) })
    function done(v) { clearTimeout(t); u1(); u2 && u2(); res(v) }
  })
}
// wallet: 'jupiter' straight to Jupiter Mobile (its app on a phone, a QR code on a computer); null: AppKit's wallet list
export async function connect(wallet) {
  const a = account(); if (a) return a
  if (wallet) {
    if (!btn.isReady()) await new Promise(r => { const t = setTimeout(r, 6000); btn.subscribeIsReady(({ isReady }) => { if (isReady) { clearTimeout(t); r() } }) })
    btn.connect(wallet).catch(() => {})
  } else kit.open({ view: 'Connect', namespace: 'solana' })
  return waitFor(5 * 60e3)
}
export async function restore() { await new Promise(r => setTimeout(r, 1200)); return account() }   // a saved session reconnects by itself
export async function disconnect() { try { await kit.disconnect('solana') } catch (e) {} }
const tx = b => { try { return VersionedTransaction.deserialize(b) } catch (e) { return Transaction.from(b) } }
const bytes = t => t instanceof VersionedTransaction ? t.serialize() : t.serialize({ requireAllSignatures: false, verifySignatures: false })
export async function signTransaction(b) {
  const p = provider(); if (!p || !account()) throw new Error('Wallet not connected')
  return bytes(await p.signTransaction(tx(b)))
}
export async function signMessage(m) {
  const p = provider(); if (!p || !account()) throw new Error('Wallet not connected')
  return p.signMessage(m)
}
