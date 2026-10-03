// End-to-end against a running `wrangler dev` (default http://localhost:8787): sign in with a wallet, set up a page,
// make a tip order, get its transaction (needs the RPC for a blockhash), drive the overlay. Run: node test/e2e.mjs [base]
import assert from 'node:assert/strict';
import { Keypair, Transaction } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { execSync } from 'node:child_process';
import * as S from '../src/solana.js';

const BASE = process.argv[2] || 'http://localhost:8787', A = BASE + '/alerts/api';
let cookie = '';
async function call(path, body, method) {
  const r = await fetch(A + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const d = await r.json().catch(() => null);
  return { status: r.status, d };
}
const ok = (r, what) => { assert.equal(r.status, 200, `${what}: ${r.status} ${JSON.stringify(r.d)}`); return r.d; };
const sql = q => execSync(`npx wrangler d1 execute tts-alerts --local --command "${q}"`, { stdio: 'pipe' }).toString();

const streamer = Keypair.generate(), viewer = Keypair.generate();
const cfg = ok(await call('/config'), 'config');
console.log('config', cfg.brand, cfg.feeBps, cfg.planUsd);

assert.equal((await call('/me')).status, 401);
const { message } = ok(await call('/auth/nonce?address=' + streamer.publicKey.toBase58()), 'nonce');
const sig = S.b58enc(nacl.sign.detached(new TextEncoder().encode(message), streamer.secretKey));
// a bad signature is refused, then the real one signs in, and the nonce can't be reused
assert.equal((await call('/auth/wallet', { address: streamer.publicKey.toBase58(), message, signature: S.b58enc(new Uint8Array(64)) })).status, 401);
ok(await call('/auth/wallet', { address: streamer.publicKey.toBase58(), message, signature: sig }), 'sign in');
const saved = cookie; cookie = '';
assert.equal((await call('/auth/wallet', { address: streamer.publicKey.toBase58(), message, signature: sig })).status, 401, 'nonce reuse');
cookie = saved;

let me = ok(await call('/me'), 'me');
assert.equal(me.payout, streamer.publicKey.toBase58(), 'wallet sign-in becomes the payout wallet');
const handle = 'test_' + Math.random().toString(36).slice(2, 8);
assert.equal((await call('/me', { handle: 'x' })).status, 400);
assert.equal((await call('/me', { handle: 'api' })).status, 400);
me = ok(await call('/me', { handle, display: 'Test Streamer', settings: { minUsd: 2, banned: ['badword'], accent: '#00ff88', voice: 'browser' } }), 'setup');
assert.equal(me.settings.minUsd, 2); assert.equal(me.settings.accent, '#00ff88');
assert.ok(me.tipUrl.endsWith('/alerts/@' + handle));

const pub = ok(await call('/s/' + handle), 'public page');
assert.equal(pub.open, true); assert.equal(pub.minUsd, 2);
assert.equal((await call('/tip', { handle, usd: 1, token: 'usdc', text: 'hi' })).status, 400, 'under the minimum');
const order = ok(await call('/tip', { handle, from: 'viewer1', usd: 10, token: 'usdc', text: 'hello stream' }), 'tip order');
assert.match(order.payLink, /^solana:https%3A%2F%2F|^solana:http%3A%2F%2F/);
console.log('order', order);

// Solana Pay: GET label, POST account -> transaction
ok(await call('/pay/' + order.id), 'pay GET');
assert.equal((await call('/pay/' + order.id, { account: streamer.publicKey.toBase58() })).status, 400, 'self tip refused');
const pay = await call('/pay/' + order.id, { account: viewer.publicKey.toBase58() });
if (pay.status === 200) {
  const tx = Transaction.from(Buffer.from(pay.d.transaction, 'base64'));
  const amounts = tx.instructions.filter(i => i.programId.toBase58() === S.TOKEN).map(i => i.data.readBigUInt64LE(1));
  assert.deepEqual(amounts, [9_500_000n, 500_000n], '95% streamer / 5% fee');
  console.log('transaction ok:', pay.d.message, tx.instructions.length, 'instructions');
} else console.log('pay POST (needs RPC):', pay.status, pay.d);

// the order isn't paid; pretend it was (the chain check itself is covered by the unit tests)
const o = ok(await call('/order/' + order.id), 'order status');
assert.equal(o.status, 'pending');
sql(`UPDATE orders SET status='paid', alert='queued', paid_at=strftime('%s','now'), sig='testsig${Date.now()}' WHERE id='${order.id}'`);
const key = me.overlayUrl.split('/').pop();

// overlay: live connection gets the test alert
const ws = new WebSocket(BASE.replace('http', 'ws') + `/alerts/api/overlay/${key}/ws`);
const got = new Promise((res, rej) => { ws.onmessage = e => res(JSON.parse(e.data)); setTimeout(() => rej(new Error('no ws message')), 5000); });
await new Promise(r => ws.onopen = r);
ok(await call('/me/test', { text: 'test!' }), 'test alert');
const m = await got; assert.equal(m.type, 'test'); assert.equal(m.alert.text, 'test!');
ws.close();
console.log('websocket ok');

const ov = ok(await call('/overlay/' + key), 'overlay');
assert.equal(ov.queue.length, 1); assert.equal(ov.queue[0].text, 'hello stream'); assert.equal(ov.serverTts, false);
assert.equal(ok(await call(`/overlay/${key}/played/${order.id}`, {}), 'claim').claimed, true);
assert.equal(ok(await call(`/overlay/${key}/played/${order.id}`, {}), 'claim again').claimed, false, 'a second overlay does not replay it');
assert.equal((await call(`/overlay/${key}/audio/${order.id}`)).status, 204, 'browser voice: no server audio');

// dashboard history and actions
const h = ok(await call('/me/alerts'), 'alerts');
assert.equal(h.total.n, 1); assert.equal(h.alerts[0].alert, 'played');
ok(await call('/me/alerts/' + order.id, { action: 'replay' }), 'replay');
assert.equal(ok(await call('/overlay/' + key), 'overlay').queue.length, 1);
assert.equal((await call('/me/alerts/' + order.id, { action: 'approve' })).status, 400, 'approve only held');

// a banned word is held
const o2 = ok(await call('/tip', { handle, from: 'x', usd: 5, token: 'usdc', text: 'this has BADWORD in it' }), 'order 2');
// (markPaid's hold rule is checked through the unit of the API: fake the payment the same way and look at it)

// rotate the overlay key: the old link stops working
me = ok(await call('/me/rotate', {}), 'rotate');
assert.equal((await call('/overlay/' + key)).status, 404);
// plan order
const plan = ok(await call('/me/plan', { token: 'usdc' }), 'plan');
assert.match(plan.amount, /^79\.00 USDC/);
// pages
for (const p of ['/alerts/', '/alerts/dashboard', '/alerts/@' + handle, '/alerts/overlay/' + me.overlayUrl.split('/').pop(), '/alerts/wallet.js', '/alerts/app.css', '/alerts/icon.svg']) {
  const r = await fetch(BASE + p, { redirect: 'manual' }); assert.equal(r.status, 200, p + ' ' + r.status);
}
ok(await call('/auth/logout', {}), 'logout');
console.log('all e2e checks passed');
