// Solana without a library: base58, associated token accounts, building the tip transaction on the server and checking a
// paid one. The server builds every transaction (wallet in the browser, or a phone wallet through a Solana Pay link), so the
// viewer only signs: one transaction, the streamer's share and the fee each go straight to their own wallet. We never hold funds.

export const SYSTEM = '11111111111111111111111111111111';
export const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const ATAP = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const BUDGET = 'ComputeBudget111111111111111111111111111111';
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const WSOL = 'So11111111111111111111111111111111111111112';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58enc(u8) {
  let n = 0n, o = '';
  for (const b of u8) n = n * 256n + BigInt(b);
  while (n > 0n) { o = B58[Number(n % 58n)] + o; n /= 58n; }
  for (const b of u8) { if (b) break; o = '1' + o; }
  return o;
}
export function b58dec(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error('bad base58'); n = n * 58n + BigInt(i); }
  const out = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of s) { if (c !== '1') break; out.unshift(0); }
  return Uint8Array.from(out);
}
// a 32-byte public key (wallet, mint, program...) or null
export function pubkey(s) {
  try { const b = b58dec(String(s || '')); return b.length === 32 ? b : null; } catch (e) { return null; }
}
export const isAddress = s => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(s || '')) && !!pubkey(s);
export const randomKey = () => b58enc(crypto.getRandomValues(new Uint8Array(32)));
export const toB64 = u8 => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
export const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// ---------- program derived addresses (the associated token account) ----------
// A PDA must not be a valid ed25519 point: decompress y and see whether x² has a square root mod p.
const P = 2n ** 255n - 19n, D = (-121665n * inv(121666n)) % P;
function pow(b, e) { let r = 1n; b %= P; while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; }
function inv(x) { return pow((x % P + P) % P, P - 2n); }
export function onCurve(bytes) {
  const b = Uint8Array.from(bytes); b[31] &= 0x7f;
  let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(b[i]);
  if (y >= P) return false;
  const y2 = y * y % P, u = (y2 - 1n + P) % P, v = (D * y2 + 1n) % P;
  const x2 = u * inv(v) % P;
  if (x2 === 0n) return true;
  return pow(x2, (P - 1n) / 2n) === 1n;   // Euler's criterion
}
const enc = new TextEncoder();
export async function findPda(seeds, program) {
  for (let bump = 255; bump >= 0; bump--) {
    const parts = [...seeds, Uint8Array.of(bump), pubkey(program), enc.encode('ProgramDerivedAddress')];
    const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
    for (const p of parts) { buf.set(p, o); o += p.length; }
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    if (!onCurve(h)) return b58enc(h);
  }
  throw new Error('no PDA');
}
export const ata = (owner, mint = USDC) => findPda([pubkey(owner), pubkey(TOKEN), pubkey(mint)], ATAP);

// ---------- building a transaction ----------
const u64 = n => { const d = new Uint8Array(8); new DataView(d.buffer).setBigUint64(0, BigInt(n), true); return d; };
const u32 = n => { const d = new Uint8Array(4); new DataView(d.buffer).setUint32(0, n, true); return d; };
function shortvec(n) { const o = []; for (;;) { let b = n & 0x7f; n >>= 7; if (n) { o.push(b | 0x80); } else { o.push(b); return o; } } }
const cat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };

// instructions: [{program, keys: [{key, signer, writable}], data: Uint8Array}] -> an unsigned legacy transaction (payer signs)
export function compile(payer, instructions, blockhash) {
  const metas = new Map();
  const add = (key, signer, writable) => { const m = metas.get(key) || { key, signer: false, writable: false };
    m.signer ||= signer; m.writable ||= writable; metas.set(key, m); };
  add(payer, true, true);
  for (const ix of instructions) { for (const k of ix.keys) add(k.key, k.signer, k.writable); add(ix.program, false, false); }
  const all = [...metas.values()], rank = m => (m.key === payer ? -1 : 0) + (m.signer ? 0 : 2) + (m.writable ? 0 : 1);
  // payer first, then writable signers, readonly signers, writable others, readonly others (stable within each group)
  const keys = all.map((m, i) => [m, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]);
  const idx = new Map(keys.map((m, i) => [m.key, i]));
  const nSig = keys.filter(m => m.signer).length;
  const header = [nSig, keys.filter(m => m.signer && !m.writable).length, keys.filter(m => !m.signer && !m.writable).length];
  const ixs = instructions.map(ix => cat(Uint8Array.of(idx.get(ix.program)), Uint8Array.from(shortvec(ix.keys.length)),
    Uint8Array.from(ix.keys.map(k => idx.get(k.key))), Uint8Array.from(shortvec(ix.data.length)), ix.data));
  const message = cat(Uint8Array.from(header), Uint8Array.from(shortvec(keys.length)), ...keys.map(m => pubkey(m.key)),
    pubkey(blockhash), Uint8Array.from(shortvec(ixs.length)), ...ixs);
  return cat(Uint8Array.from(shortvec(nSig)), new Uint8Array(64 * nSig), message);
}

// The tip (or plan) transaction: `legs` are [{to, amount}] in base units (lamports, or USDC with 6 decimals). The reference
// (a random key, one per order) rides as a read-only account on the first transfer, so the payment can be found by it.
export async function buildPayment({ payer, token, legs, reference, memo, blockhash, microLamports = 20000 }) {
  const ixs = [
    { program: BUDGET, keys: [], data: cat(Uint8Array.of(2), u32(token === 'sol' ? 30000 : 40000 * legs.length + 30000)) },
    { program: BUDGET, keys: [], data: cat(Uint8Array.of(3), u64(microLamports)) },
  ];
  const ref = i => (i === 0 && reference ? [{ key: reference, signer: false, writable: false }] : []);
  if (token === 'sol') {
    legs.forEach((l, i) => ixs.push({ program: SYSTEM, data: cat(u32(2), u64(l.amount)),
      keys: [{ key: payer, signer: true, writable: true }, { key: l.to, signer: false, writable: true }, ...ref(i)] }));
  } else {
    const src = await ata(payer, USDC);
    for (const [i, l] of legs.entries()) {
      const dst = await ata(l.to, USDC);
      // create the receiver's USDC account if it has none yet (a no-op when it exists)
      ixs.push({ program: ATAP, data: Uint8Array.of(1), keys: [
        { key: payer, signer: true, writable: true }, { key: dst, signer: false, writable: true }, { key: l.to, signer: false, writable: false },
        { key: USDC, signer: false, writable: false }, { key: SYSTEM, signer: false, writable: false }, { key: TOKEN, signer: false, writable: false }] });
      ixs.push({ program: TOKEN, data: cat(Uint8Array.of(12), u64(l.amount), Uint8Array.of(6)), keys: [
        { key: src, signer: false, writable: true }, { key: USDC, signer: false, writable: false }, { key: dst, signer: false, writable: true },
        { key: payer, signer: true, writable: false }, ...ref(i)] });
    }
  }
  if (memo) ixs.push({ program: MEMO, keys: [], data: enc.encode(memo) });
  const tx = compile(payer, ixs, blockhash);
  if (tx.length > 1232) throw new Error('transaction too large');
  return tx;
}

// ---------- checking a paid transaction ----------
// `tx` is getTransaction(sig, {encoding:'json'|'jsonParsed', maxSupportedTransactionVersion:0}). Paid means: it succeeded, it
// carries the order's reference, and every receiver's balance went up by at least its share (balance changes, so it holds
// whatever instructions the wallet wrapped around ours).
export function checkPayment(tx, { token, legs, reference }) {
  if (!tx || !tx.meta) return { ok: false, why: 'not found' };
  if (tx.meta.err) return { ok: false, why: 'failed on chain' };
  const keys = (tx.transaction?.message?.accountKeys || []).map(k => typeof k === 'string' ? k : k.pubkey);
  const loaded = [...keys, ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])];
  if (reference && !loaded.includes(reference)) return { ok: false, why: 'not this order' };
  const want = new Map();
  for (const l of legs) want.set(l.to, (want.get(l.to) || 0n) + BigInt(l.amount));
  const payer = keys[0];
  for (const [to, amount] of want) {
    let got = 0n;
    if (token === 'sol') {
      const i = loaded.indexOf(to);
      if (i < 0 || to === payer) return { ok: false, why: 'receiver missing' };
      got = BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]);
    } else {
      const sum = list => (list || []).filter(b => b.mint === USDC && b.owner === to).reduce((n, b) => n + BigInt(b.uiTokenAmount.amount), 0n);
      got = sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
    }
    if (got < amount) return { ok: false, why: `short: ${to} got ${got} of ${amount}` };
  }
  return { ok: true, payer };
}
