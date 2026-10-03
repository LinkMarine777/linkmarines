// node --test test/  (checks our hand-rolled Solana code against @solana/web3.js and @solana/spl-token)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import * as S from '../src/solana.js';

test('base58 round trip', () => {
  for (let i = 0; i < 50; i++) {
    const k = Keypair.generate().publicKey;
    assert.equal(S.b58enc(k.toBytes()), k.toBase58());
    assert.deepEqual(S.b58dec(k.toBase58()), k.toBytes());
  }
  assert.equal(S.b58enc(new Uint8Array(32)), SystemProgram.programId.toBase58());
  assert.equal(S.isAddress('nope'), false);
  assert.equal(S.isAddress(S.USDC), true);
});

test('on-curve check matches web3.js', () => {
  for (let i = 0; i < 200; i++) {
    const b = crypto.getRandomValues(new Uint8Array(32));
    assert.equal(S.onCurve(b), PublicKey.isOnCurve(b), S.b58enc(b));
  }
});

test('associated token accounts match spl-token', async () => {
  for (let i = 0; i < 20; i++) {
    const o = Keypair.generate().publicKey;
    assert.equal(await S.ata(o.toBase58()), getAssociatedTokenAddressSync(new PublicKey(S.USDC), o).toBase58());
  }
});

const blockhash = Keypair.generate().publicKey.toBase58();
test('USDC tip with fee split decodes as expected', async () => {
  const payer = Keypair.generate(), streamer = Keypair.generate().publicKey.toBase58(), fee = Keypair.generate().publicKey.toBase58();
  const reference = S.randomKey();
  const raw = await S.buildPayment({ payer: payer.publicKey.toBase58(), token: 'usdc', reference, memo: 'MA|abc',
    blockhash, legs: [{ to: streamer, amount: 4_750_000 }, { to: fee, amount: 250_000 }] });
  const tx = Transaction.from(raw);
  assert.equal(tx.feePayer.toBase58(), payer.publicKey.toBase58());
  assert.equal(tx.recentBlockhash, blockhash);
  const progs = tx.instructions.map(i => i.programId.toBase58());
  assert.deepEqual(progs, [S.BUDGET, S.BUDGET, S.ATAP, S.TOKEN, S.ATAP, S.TOKEN, S.MEMO]);
  const t1 = tx.instructions[3], t2 = tx.instructions[5];
  assert.equal(t1.keys[2].pubkey.toBase58(), await S.ata(streamer));
  assert.equal(t2.keys[2].pubkey.toBase58(), await S.ata(fee));
  assert.equal(t1.data.readBigUInt64LE(1), 4_750_000n);
  assert.equal(t2.data.readBigUInt64LE(1), 250_000n);
  assert.equal(t1.keys[4].pubkey.toBase58(), reference);
  assert.equal(t1.keys[4].isSigner, false);
  assert.equal(Buffer.from(tx.instructions[6].data).toString(), 'MA|abc');
  // it signs and verifies like any other transaction
  tx.sign(payer);
  assert.ok(tx.verifySignatures());
});

test('SOL tip decodes as expected', async () => {
  const payer = Keypair.generate(), streamer = Keypair.generate().publicKey.toBase58();
  const reference = S.randomKey();
  const raw = await S.buildPayment({ payer: payer.publicKey.toBase58(), token: 'sol', reference, blockhash, legs: [{ to: streamer, amount: 12345678 }] });
  const tx = Transaction.from(raw);
  const t = tx.instructions[2];
  assert.equal(t.programId.toBase58(), S.SYSTEM);
  assert.equal(t.data.readUInt32LE(0), 2);
  assert.equal(t.data.readBigUInt64LE(4), 12345678n);
  assert.equal(t.keys[1].pubkey.toBase58(), streamer);
  assert.equal(t.keys[2].pubkey.toBase58(), reference);
  tx.sign(payer);
  assert.ok(tx.verifySignatures());
});

test('payment check', () => {
  const ref = S.randomKey(), a = S.randomKey(), b = S.randomKey(), payer = S.randomKey();
  const legs = [{ to: a, amount: 950 }, { to: b, amount: 50 }];
  const bal = (owner, amount, i) => ({ accountIndex: i, mint: S.USDC, owner, uiTokenAmount: { amount: String(amount) } });
  const tx = { meta: { err: null, preTokenBalances: [bal(a, 0, 1), bal(b, 100, 2)], postTokenBalances: [bal(a, 950, 1), bal(b, 150, 2)] },
    transaction: { message: { accountKeys: [payer, 'x', 'y', ref] } } };
  assert.equal(S.checkPayment(tx, { token: 'usdc', legs, reference: ref }).ok, true);
  assert.equal(S.checkPayment(tx, { token: 'usdc', legs, reference: S.randomKey() }).ok, false);
  tx.meta.postTokenBalances[1] = bal(b, 140, 2);
  assert.equal(S.checkPayment(tx, { token: 'usdc', legs, reference: ref }).ok, false);
  const sol = { meta: { err: null, preBalances: [5000, 10, 0, 0], postBalances: [100, 1010, 0, 0] },
    transaction: { message: { accountKeys: [payer, a, ref, S.SYSTEM] } } };
  assert.equal(S.checkPayment(sol, { token: 'sol', legs: [{ to: a, amount: 1000 }], reference: ref }).ok, true);
  assert.equal(S.checkPayment(sol, { token: 'sol', legs: [{ to: a, amount: 1001 }], reference: ref }).ok, false);
  assert.equal(S.checkPayment({ ...sol, meta: { ...sol.meta, err: { x: 1 } } }, { token: 'sol', legs: [{ to: a, amount: 1 }], reference: ref }).ok, false);
});
