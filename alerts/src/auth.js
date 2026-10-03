// Streamer sign-in: a Solana wallet (Sign-In With Solana: the wallet signs a one-time message) or Google (Google's signed
// ID token). No passwords, nothing to store but who signed in. The session is a signed cookie.
import { b58dec, pubkey } from './solana.js';

const te = new TextEncoder();
const b64u = u8 => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

async function hmac(secret, data) {
  const k = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', k, te.encode(data))));
}
function same(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

// ---------- session cookie ----------
export const COOKIE = 'ma_s';
const DAYS = 30;
export async function sessionCookie(env, uid) {
  const body = b64u(te.encode(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + DAYS * 86400 })));
  return `${COOKIE}=${body}.${await hmac(env.SESSION_SECRET, body)}; Path=/alerts; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}
export const clearCookie = () => `${COOKIE}=; Path=/alerts; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
export async function sessionUser(env, req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.get('cookie') || '');
  if (!m) return null;
  const [body, sig] = m[1].split('.');
  if (!body || !sig || !same(sig, await hmac(env.SESSION_SECRET, body))) return null;
  try { const s = JSON.parse(new TextDecoder().decode(unb64u(body))); return s.exp > Date.now() / 1000 ? s.uid : null; } catch (e) { return null; }
}

// ---------- Sign-In With Solana ----------
// The message follows the SIWS layout wallets show nicely. The nonce is single use (kept in D1 until it is spent or expires).
export function siwsMessage({ host, address, nonce, issued, brand }) {
  return `${host} wants you to sign in with your Solana account:\n${address}\n\nSign in to ${brand}. This costs nothing and sends no transaction.\n\nURI: https://${host}/alerts/\nVersion: 1\nChain ID: mainnet\nNonce: ${nonce}\nIssued At: ${issued}`;
}
export async function verifyWallet({ message, signature, address }, expectHost) {
  const pk = pubkey(address);
  if (!pk || typeof message !== 'string' || message.length > 2000) return null;
  const lines = message.split('\n');
  if (lines[0] !== `${expectHost} wants you to sign in with your Solana account:` || lines[1] !== address) return null;
  const nonce = /^Nonce: (\S+)$/m.exec(message)?.[1], issued = /^Issued At: (\S+)$/m.exec(message)?.[1];
  if (!nonce || !issued || Math.abs(Date.now() - Date.parse(issued)) > 10 * 60 * 1000) return null;
  let sig; try { sig = b58dec(signature); } catch (e) { return null; }
  if (sig.length !== 64) return null;
  const key = await crypto.subtle.importKey('raw', pk, { name: 'Ed25519' }, false, ['verify']);
  return (await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, te.encode(message))) ? { nonce } : null;
}

// ---------- Google ----------
let jwks = null, jwksAt = 0;
async function googleKeys() {
  if (jwks && Date.now() - jwksAt < 3600e3) return jwks;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!r.ok) throw new Error('google keys ' + r.status);
  jwks = (await r.json()).keys; jwksAt = Date.now(); return jwks;
}
export async function verifyGoogle(credential, clientId) {
  const [h, p, s] = String(credential || '').split('.');
  if (!h || !p || !s || !clientId) return null;
  const head = JSON.parse(new TextDecoder().decode(unb64u(h))), claims = JSON.parse(new TextDecoder().decode(unb64u(p)));
  if (head.alg !== 'RS256') return null;
  const jwk = (await googleKeys()).find(k => k.kid === head.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64u(s), te.encode(h + '.' + p)))) return null;
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || claims.aud !== clientId) return null;
  if (!(claims.exp > Date.now() / 1000) || !claims.sub) return null;
  return { sub: claims.sub, email: claims.email_verified ? claims.email : null, name: claims.name || null };
}
