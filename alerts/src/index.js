// The streamer alerts service: crypto tips with TTS for any streamer, on its own Worker (separate from the terminal and the
// War Room bot). Everything lives under /alerts: the pages (public/alerts), and the API (/alerts/api/...).
//
//   viewer  -> /alerts/@handle      picks an amount, writes a message, pays from their wallet (or a phone wallet via Solana Pay)
//   streamer-> /alerts/dashboard    signs in (wallet or Google), sets the payout wallet, looks and sounds, gets the overlay link
//   OBS     -> /alerts/overlay/KEY  the browser source: shows and speaks each paid tip
//
// Money never passes through us: the server builds the transaction, the viewer signs it, the streamer's share goes straight
// to their wallet and the fee (none on the annual plan) straight to the treasury, in the same transaction.
import * as S from './solana.js';
import * as A from './auth.js';
import { VOICES, serverVoice, synthesize } from './tts.js';
import { DEFAULTS, FONTS, settingsOf, held, clean } from './settings.js';
export { Room } from './room.js';

const now = () => Math.floor(Date.now() / 1000);
const id = (n = 12) => S.b58enc(crypto.getRandomValues(new Uint8Array(n)));
const json = (d, status = 200, h = {}) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...h } });
const err = (msg, status = 400) => json({ error: msg }, status);
const ORDER_TTL = 30 * 60;        // an unpaid order can be paid for 30 min
const usdText = u => '$' + (+u).toFixed(2).replace(/\.00$/, '');
const RESERVED = new Set(['api', 'admin', 'alerts', 'dashboard', 'overlay', 'support', 'help', 'login', 'signup', 'settings']);

// ---------- config ----------
const cfg = env => ({
  brand: env.BRAND || 'Marine Alerts',
  treasury: env.TREASURY,
  feeBps: Math.max(0, Math.min(5000, +env.FEE_BPS || 0)),
  planUsd: +env.PLAN_USD || 79,
  requirePlan: env.REQUIRE_PLAN === '1',
  memo: env.MEMO_PREFIX || 'MA',
});
const isPro = u => (u.pro_until || 0) > now();
// Helius when HELIUS_KEY is set (the key alone, or the whole Helius URL pasted in), else the public RPC. If Helius refuses
// (a wrong or spent key), the public one is tried, so payments keep working; the error says which key to fix.
// publicnode first (what the terminal's checkout uses; it keeps recent history, enough to find a payment within the
// order's 30 minutes), then Solana's own (which turns away some cloud servers)
const PUBLIC_RPC = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
function rpcUrls(env) {
  let k = String(env.HELIUS_KEY || '').trim();
  const pub = env.RPC_URL ? [env.RPC_URL, ...PUBLIC_RPC] : PUBLIC_RPC;
  if (/^https?:\/\//.test(k)) { try { const u = new URL(k); k = u.searchParams.get('api-key') || ''; if (!k) return [env.HELIUS_KEY.trim(), ...pub]; } catch (e) { k = ''; } }
  return k ? [`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(k)}`, ...pub] : pub;
}
async function rpc(env, method, params) {
  let last;
  for (const url of rpcUrls(env)) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const t = await r.text(); let d;
      try { d = JSON.parse(t); } catch (e) { throw new Error(`Solana RPC answered ${r.status} ${t.slice(0, 60)}${url.includes('helius') ? ' (check the HELIUS_KEY secret)' : ''}`); }
      if (d.error) { if (/api.key|unauthori/i.test(d.error.message || '')) throw new Error('Solana RPC refused the HELIUS_KEY'); throw Object.assign(new Error(d.error.message || 'rpc error'), { final: true }); }
      return d.result;
    } catch (e) { if (e.final) throw e; last = e; console.log('rpc', method, e.message); }
  }
  throw last;
}
let solPx = null, solPxAt = 0;
async function solPrice() {
  if (solPx && Date.now() - solPxAt < 60e3) return solPx;
  const d = await (await fetch(`https://lite-api.jup.ag/price/v3?ids=${S.WSOL}`)).json();
  const p = +d?.[S.WSOL]?.usdPrice;
  if (!(p > 0)) throw new Error('no SOL price');
  solPx = p; solPxAt = Date.now(); return p;
}

// ---------- users ----------
const userBy = (env, col, v) => env.DB.prepare(`SELECT * FROM users WHERE ${col} = ?`).bind(v).first();
async function createUser(env) {
  const u = { id: id(), overlay_key: id(24), created: now() };
  await env.DB.prepare('INSERT INTO users (id, overlay_key, created) VALUES (?, ?, ?)').bind(u.id, u.overlay_key, u.created).run();
  return u.id;
}
// signs in with an identity; signed in already and the identity is new: adds it to that account (a second way to sign in)
async function signIn(env, req, provider, subject, email) {
  const cur = await A.sessionUser(env, req);
  const ident = await env.DB.prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?').bind(provider, subject).first();
  let uid = ident?.user_id;
  if (!uid) {
    uid = (cur && await userBy(env, 'id', cur)) ? cur : await createUser(env);
    await env.DB.prepare('INSERT INTO identities (provider, subject, user_id, email, created) VALUES (?, ?, ?, ?, ?)').bind(provider, subject, uid, email || null, now()).run();
  }
  // a wallet sign-in is the obvious payout wallet until they choose another
  if (provider === 'solana') await env.DB.prepare('UPDATE users SET payout = ? WHERE id = ? AND payout IS NULL').bind(subject, uid).run();
  return json({ ok: true }, 200, { 'set-cookie': await A.sessionCookie(env, uid) });
}
async function me(env, u, origin) {
  const ids = (await env.DB.prepare('SELECT provider, subject, email FROM identities WHERE user_id = ?').bind(u.id).all()).results;
  const c = cfg(env);
  return {
    id: u.id, handle: u.handle, display: u.display, payout: u.payout, settings: settingsOf(u.settings),
    pro: isPro(u), proUntil: u.pro_until || 0, feeBps: isPro(u) ? 0 : c.feeBps, planUsd: c.planUsd, requirePlan: c.requirePlan,
    identities: ids.map(i => ({ provider: i.provider, label: i.provider === 'solana' ? i.subject : (i.email || 'Google account') })),
    overlayUrl: `${origin}/alerts/overlay/${u.overlay_key}`, tipUrl: u.handle ? `${origin}/alerts/@${u.handle}` : null,
  };
}

// ---------- orders and payments ----------
async function makeOrder(env, origin, { kind, user, from, text, usd, token }) {
  const c = cfg(env);
  if (!c.treasury || !S.isAddress(c.treasury)) throw new Error('payments are not set up yet');
  let total;
  if (token === 'usdc') total = Math.round(usd * 1e6);
  else total = Math.ceil(usd / await solPrice() * 1e9);
  let legs;
  if (kind === 'plan') legs = [{ to: c.treasury, amount: total }];
  else {
    const fee = isPro(user) ? 0 : Math.floor(total * c.feeBps / 10000);
    legs = [{ to: user.payout, amount: total - fee }];
    if (fee > 0) legs.push({ to: c.treasury, amount: fee });
  }
  const o = { id: id(), reference: S.randomKey() };
  await env.DB.prepare('INSERT INTO orders (id, kind, user_id, from_name, text, token, usd, legs, reference, created) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(o.id, kind, user.id, from || null, text || null, token, usd, JSON.stringify(legs), o.reference, now()).run();
  const ui = token === 'usdc' ? `${(total / 1e6).toFixed(2)} USDC` : `${(total / 1e9).toFixed(4)} SOL (≈${usdText(usd)})`;
  return { id: o.id, amount: ui, payLink: `solana:${encodeURIComponent(`${origin}/alerts/api/pay/${o.id}`)}` };
}
const orderBy = (env, oid) => env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(oid).first();

async function push(env, uid, msg) {
  try { await env.ROOM.get(env.ROOM.idFromName(uid)).fetch('https://room/push', { method: 'POST', body: JSON.stringify(msg) }); } catch (e) {}
}
async function markPaid(env, o, sig, payer) {
  const user = await userBy(env, 'id', o.user_id);
  const alert = o.kind === 'tip' ? (held(settingsOf(user?.settings), o) ? 'held' : 'queued') : null;
  let r;
  try {
    r = await env.DB.prepare("UPDATE orders SET status = 'paid', sig = ?, payer = ?, paid_at = ?, alert = ? WHERE id = ? AND status != 'paid'")
      .bind(sig, payer, now(), alert, o.id).run();
  } catch (e) { return false; }   // that signature already paid another order
  if (!r.meta.changes) return false;
  if (o.kind === 'plan') {
    await env.DB.prepare('UPDATE users SET pro_until = MAX(pro_until, ?) + ? WHERE id = ?').bind(now(), 365 * 86400, o.user_id).run();
  } else if (alert === 'queued') await push(env, o.user_id, { type: 'alert', id: o.id });
  else await push(env, o.user_id, { type: 'held', id: o.id });
  return true;
}
const getTx = (env, sig) => rpc(env, 'getTransaction', [sig, { commitment: 'confirmed', encoding: 'json', maxSupportedTransactionVersion: 0 }]);
async function checkSig(env, o, sig) {
  const tx = await getTx(env, sig);
  const r = S.checkPayment(tx, { token: o.token, legs: JSON.parse(o.legs), reference: o.reference });
  if (r.ok) await markPaid(env, o, sig, r.payer);
  return r;
}
// a phone wallet paid through the Solana Pay link: find the payment by the order's reference
async function findByReference(env, o) {
  const sigs = await rpc(env, 'getSignaturesForAddress', [o.reference, { limit: 5, commitment: 'confirmed' }]);
  for (const s of sigs || []) { if (!s.err && (await checkSig(env, o, s.signature)).ok) return true; }
  return false;
}
async function orderStatus(env, o) {
  return { id: o.id, kind: o.kind, status: o.status, alert: o.alert, sig: o.sig };
}

// ---------- the API ----------
async function api(req, env, ctx, path, url) {
  const origin = url.origin, c = cfg(env), m = req.method;
  const body = async () => {
    if (!(req.headers.get('content-type') || '').includes('application/json')) throw new Error('send JSON');
    return await req.json();
  };
  const seg = path.split('/').filter(Boolean);   // after /alerts/api

  if (path === '/config') return json({
    brand: c.brand, googleClientId: env.GOOGLE_CLIENT_ID || null, feeBps: c.feeBps, planUsd: c.planUsd, requirePlan: c.requirePlan,
    voices: VOICES, serverTts: !!env.GOOGLE_TTS_KEY, defaults: DEFAULTS, fonts: FONTS,
  });

  // ----- sign in -----
  if (path === '/auth/nonce') {
    const address = url.searchParams.get('address');
    if (!S.isAddress(address)) return err('bad address');
    const nonce = id(16);
    await env.DB.prepare('INSERT INTO nonces (n, exp) VALUES (?, ?)').bind(nonce, now() + 600).run();
    return json({ message: A.siwsMessage({ host: url.host, address, nonce, issued: new Date().toISOString(), brand: c.brand }) });
  }
  if (path === '/auth/wallet' && m === 'POST') {
    const b = await body(), ok = await A.verifyWallet(b, url.host);
    if (!ok) return err('signature did not check out', 401);
    const spent = await env.DB.prepare('DELETE FROM nonces WHERE n = ? AND exp > ?').bind(ok.nonce, now()).run();
    if (!spent.meta.changes) return err('that sign-in expired, try again', 401);
    return signIn(env, req, 'solana', b.address);
  }
  if (path === '/auth/google' && m === 'POST') {
    const g = await A.verifyGoogle((await body()).credential, env.GOOGLE_CLIENT_ID).catch(() => null);
    if (!g) return err('Google sign-in did not check out', 401);
    return signIn(env, req, 'google', g.sub, g.email);
  }
  if (path === '/auth/logout' && m === 'POST') return json({ ok: true }, 200, { 'set-cookie': A.clearCookie() });

  // ----- a streamer's public tip page -----
  if (seg[0] === 's' && seg[1] && m === 'GET') {
    const u = await userBy(env, 'handle', seg[1].toLowerCase());
    if (!u) return err('no streamer by that name', 404);
    const s = settingsOf(u.settings);
    return json({ handle: u.handle, display: u.display || u.handle, tagline: s.tagline, minUsd: s.minUsd, maxChars: s.maxChars,
      tokens: s.tokens, accent: s.accent, open: !!u.payout && (!c.requirePlan || isPro(u)) });
  }
  if (path === '/tip' && m === 'POST') {
    const b = await body(), u = await userBy(env, 'handle', String(b.handle || '').toLowerCase());
    if (!u) return err('no streamer by that name', 404);
    if (!u.payout || (c.requirePlan && !isPro(u))) return err("this streamer isn't taking tips right now");
    const s = settingsOf(u.settings), usd = Math.round(+b.usd * 100) / 100, token = b.token;
    if (!(usd >= s.minUsd) || usd > 10000) return err(`the minimum is ${usdText(s.minUsd)}`);
    if (!s.tokens.includes(token)) return err('pick USDC or SOL');
    const text = clean(b.text, s.maxChars), from = clean(b.from, 25) || 'anon';
    return json(await makeOrder(env, origin, { kind: 'tip', user: u, from, text, usd, token }));
  }

  // ----- paying: the transaction (from the page's wallet, or a phone wallet via Solana Pay), then the check -----
  if (seg[0] === 'pay' && seg[1]) {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
    if (m === 'OPTIONS') return new Response(null, { headers: cors });
    if (m === 'GET') return json({ label: c.brand, icon: `${origin}/alerts/icon.svg` }, 200, cors);
    const o = await orderBy(env, seg[1]);
    if (!o || o.status !== 'pending' || o.created < now() - ORDER_TTL) return json({ error: 'this order expired, start a new one' }, 400, cors);
    const account = (await req.json().catch(() => ({}))).account;
    if (!S.isAddress(account)) return json({ error: 'bad account' }, 400, cors);
    const legs = JSON.parse(o.legs);
    if (legs.some(l => l.to === account)) return json({ error: "you can't tip from the wallet that receives it (use Send test alert on the dashboard)" }, 400, cors);
    const { blockhash } = (await rpc(env, 'getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
    const tx = await S.buildPayment({ payer: account, token: o.token, legs, reference: o.reference, memo: `${c.memo}|${o.id}`, blockhash });
    const u = await userBy(env, 'id', o.user_id);
    const message = o.kind === 'plan' ? `${c.brand} annual plan` : `Tip to ${u?.display || u?.handle || 'the streamer'}`;
    return json({ transaction: S.toB64(tx), message }, 200, cors);
  }
  if (seg[0] === 'order' && seg[1]) {
    let o = await orderBy(env, seg[1]);
    if (!o) return err('no such order', 404);
    if (seg[2] === 'confirm' && m === 'POST') {
      const sig = String((await body()).signature || '');
      if (o.status === 'pending' && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) {
        const r = await checkSig(env, o, sig).catch(e => ({ ok: false, why: e.message }));
        if (!r.ok && r.why !== 'not found') return json({ ...(await orderStatus(env, await orderBy(env, o.id))), why: r.why });
      }
      return json(await orderStatus(env, await orderBy(env, o.id)));
    }
    if (o.status === 'pending' && o.created > now() - ORDER_TTL * 2) {
      await findByReference(env, o).catch(() => {});
      o = await orderBy(env, o.id);
    }
    return json(await orderStatus(env, o));
  }
  // for wallets that only sign (no send): the page sends the signed transaction through here
  if (path === '/send' && m === 'POST') {
    const t = String((await body()).transaction || '');
    if (!/^[A-Za-z0-9+/=]{100,2000}$/.test(t)) return err('bad transaction');
    try { return json({ signature: await rpc(env, 'sendTransaction', [t, { encoding: 'base64', preflightCommitment: 'confirmed' }]) }); }
    catch (e) { return err(e.message); }
  }

  // ----- the browser source (the key in its link is its password) -----
  if (seg[0] === 'overlay' && seg[1]) {
    const u = await userBy(env, 'overlay_key', seg[1]);
    if (!u) return err('this overlay link was replaced, copy the new one from the dashboard', 404);
    if (seg[2] === 'ws') return env.ROOM.get(env.ROOM.idFromName(u.id)).fetch(req);
    const s = settingsOf(u.settings);
    if (!seg[2] && m === 'GET') {
      const q = (await env.DB.prepare("SELECT id, from_name, text, usd FROM orders WHERE user_id = ? AND alert = 'queued' ORDER BY paid_at LIMIT 20").bind(u.id).all()).results;
      return json({ settings: s, serverTts: serverVoice(env, s.voice), queue: q.map(a => ({ id: a.id, from: a.from_name, text: a.text, usd: a.usd })) });
    }
    if (seg[2] === 'played' && seg[3] && m === 'POST') {
      const r = await env.DB.prepare("UPDATE orders SET alert = 'played', played_at = ? WHERE id = ? AND user_id = ? AND alert = 'queued'").bind(now(), seg[3], u.id).run();
      return json({ claimed: r.meta.changes > 0 });   // only the overlay that claims it plays it
    }
    if (seg[2] === 'audio' && seg[3]) {
      if (!serverVoice(env, s.voice)) return new Response(null, { status: 204 });
      let from, text, usd;
      if (seg[3] === 'test') { from = clean(url.searchParams.get('from'), 25); text = clean(url.searchParams.get('text'), 200); usd = +url.searchParams.get('usd') || 0; }
      else {
        const o = await env.DB.prepare('SELECT from_name, text, usd FROM orders WHERE id = ? AND user_id = ?').bind(seg[3], u.id).first();
        if (!o) return err('no such alert', 404);
        from = o.from_name; text = o.text; usd = o.usd;
      }
      if (!text || usd < s.ttsMinUsd) return new Response(null, { status: 204 });
      const say = s.readName && from ? `${from} says: ${text}` : text;
      const key = new Request(`https://tts.cache/${s.voice}/${s.rate}/${encodeURIComponent(say)}`);
      const hit = await caches.default.match(key);
      if (hit) return hit;
      try {
        const res = new Response(await synthesize(env, say, s.voice, s.rate), { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=86400' } });
        ctx.waitUntil(caches.default.put(key, res.clone()));
        return res;
      } catch (e) { return new Response(null, { status: 204 }); }   // the overlay falls back to the browser voice
    }
    return err('not found', 404);
  }

  // ----- the dashboard (signed in) -----
  if (seg[0] === 'me') {
    const uid = await A.sessionUser(env, req), u = uid && await userBy(env, 'id', uid);
    if (!u) return err('sign in first', 401);
    if (seg.length === 1 && m === 'GET') return json(await me(env, u, origin));
    if (seg.length === 1 && m === 'POST') {
      const b = await body(), set = [], val = [];
      if (b.handle !== undefined) {
        const h = String(b.handle).toLowerCase().trim();
        if (!/^[a-z0-9_]{3,24}$/.test(h)) return err('your page name: 3–24 letters, numbers or _');
        if (RESERVED.has(h)) return err('that name is taken');
        const other = await userBy(env, 'handle', h);
        if (other && other.id !== u.id) return err('that name is taken');
        set.push('handle = ?'); val.push(h);
      }
      if (b.display !== undefined) { set.push('display = ?'); val.push(clean(b.display, 40) || null); }
      if (b.payout !== undefined) {
        if (!S.isAddress(b.payout)) return err("that isn't a Solana wallet address");
        if (b.payout === c.treasury) return err('pick your own wallet');
        set.push('payout = ?'); val.push(b.payout);
      }
      if (b.settings !== undefined) { set.push('settings = ?'); val.push(JSON.stringify(settingsOf({ ...settingsOf(u.settings), ...b.settings }))); }
      if (set.length) await env.DB.prepare(`UPDATE users SET ${set.join(', ')} WHERE id = ?`).bind(...val, u.id).run();
      if (b.settings !== undefined) await push(env, u.id, { type: 'settings' });
      return json(await me(env, await userBy(env, 'id', u.id), origin));
    }
    if (seg[1] === 'rotate' && m === 'POST') {
      await push(env, u.id, { type: 'replaced' });
      await env.DB.prepare('UPDATE users SET overlay_key = ? WHERE id = ?').bind(id(24), u.id).run();
      return json(await me(env, await userBy(env, 'id', u.id), origin));
    }
    if (seg[1] === 'alerts' && !seg[2] && m === 'GET') {
      const r = (await env.DB.prepare("SELECT id, from_name, text, usd, token, alert, sig, paid_at FROM orders WHERE user_id = ? AND kind = 'tip' AND status = 'paid' ORDER BY paid_at DESC LIMIT 100").bind(u.id).all()).results;
      const tot = await env.DB.prepare("SELECT COUNT(*) n, COALESCE(SUM(usd), 0) usd FROM orders WHERE user_id = ? AND kind = 'tip' AND status = 'paid'").bind(u.id).first();
      return json({ alerts: r, total: tot });
    }
    if (seg[1] === 'alerts' && seg[2] && m === 'POST') {
      const act = (await body()).action, o = await env.DB.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ? AND status = 'paid'").bind(seg[2], u.id).first();
      if (!o) return err('no such alert', 404);
      const to = { replay: [['played', 'skipped', 'queued', 'rejected', 'held'], 'queued'], skip: [['queued'], 'skipped'], approve: [['held'], 'queued'], reject: [['held'], 'rejected'] }[act];
      if (!to || !to[0].includes(o.alert)) return err("can't do that to this alert");
      await env.DB.prepare('UPDATE orders SET alert = ? WHERE id = ?').bind(to[1], o.id).run();
      if (to[1] === 'queued') await push(env, u.id, { type: 'alert', id: o.id });
      if (act === 'skip') await push(env, u.id, { type: 'skip', id: o.id });
      return json({ ok: true, alert: to[1] });
    }
    if (seg[1] === 'skip' && m === 'POST') { await push(env, u.id, { type: 'skip' }); return json({ ok: true }); }
    if (seg[1] === 'test' && m === 'POST') {
      const b = await body().catch(() => ({}));
      await push(env, u.id, { type: 'test', alert: { id: 'test', from: clean(b.from, 25) || 'A viewer', text: clean(b.text, 200) || 'This is a test alert. Looking good!', usd: +b.usd > 0 ? Math.min(10000, +b.usd) : 5 } });
      return json({ ok: true });
    }
    if (seg[1] === 'plan' && m === 'POST') {
      const token = (await body()).token === 'sol' ? 'sol' : 'usdc';
      return json(await makeOrder(env, origin, { kind: 'plan', user: u, usd: c.planUsd, token }));
    }
    if (seg[1] === 'orders' && m === 'GET') {   // the plan payments, for the dashboard's billing section
      const r = (await env.DB.prepare("SELECT id, usd, token, sig, paid_at FROM orders WHERE user_id = ? AND kind = 'plan' AND status = 'paid' ORDER BY paid_at DESC").bind(u.id).all()).results;
      return json({ orders: r });
    }
  }
  return err('not found', 404);
}

// ---------- every minute: catch payments made in a phone wallet whose page was closed, tidy up ----------
async function sweep(env) {
  const t = now();
  const pending = (await env.DB.prepare("SELECT * FROM orders WHERE status = 'pending' AND created > ? ORDER BY created DESC LIMIT 25").bind(t - ORDER_TTL - 300).all()).results;
  for (const o of pending) await findByReference(env, o).catch(() => {});
  await env.DB.batch([
    env.DB.prepare("UPDATE orders SET status = 'expired' WHERE status = 'pending' AND created < ?").bind(t - 3600),
    env.DB.prepare("DELETE FROM orders WHERE status = 'expired' AND created < ?").bind(t - 7 * 86400),
    env.DB.prepare('DELETE FROM nonces WHERE exp < ?').bind(t),
  ]);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    let p = url.pathname;
    if (p === '/' || p === '/alerts') return Response.redirect(`${url.origin}/alerts/${url.search}`, 302);
    if (!p.startsWith('/alerts/')) return new Response('Not found', { status: 404 });
    p = p.slice('/alerts'.length);
    if (p.startsWith('/api/')) {
      try { return await api(req, env, ctx, p.slice(4), url); }
      catch (e) { return err(e.message || 'something went wrong', 500); }
    }
    // pages: the tip page and the overlay share one file each, whoever's they are
    const page = /^\/@[A-Za-z0-9_]{1,24}\/?$/.test(p) ? '/alerts/tip' : /^\/overlay\/[1-9A-HJ-NP-Za-km-z]+\/?$/.test(p) ? '/alerts/overlay' : null;
    if (page) {
      const r = await env.ASSETS.fetch(new Request(new URL(page, url.origin), req));
      return new Response(r.body, { status: r.status, headers: { ...Object.fromEntries(r.headers), 'cache-control': 'no-cache', 'referrer-policy': 'no-referrer' } });
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(sweep(env)); },
};
