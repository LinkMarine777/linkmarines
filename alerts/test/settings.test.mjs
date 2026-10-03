import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsOf, held, DEFAULTS } from '../src/settings.js';

test('settings are clamped and checked', () => {
  const s = settingsOf({ minUsd: -5, maxChars: 9999, accent: 'red', bg: '#123456', voice: 'nope', tokens: ['sol', 'doge'], banned: [' Bad ', ''], soundUrl: 'javascript:alert(1)', template: '   ' });
  assert.equal(s.minUsd, 0.5); assert.equal(s.maxChars, 300);
  assert.equal(s.accent, DEFAULTS.accent); assert.equal(s.bg, '#123456');
  assert.equal(s.voice, DEFAULTS.voice); assert.deepEqual(s.tokens, ['sol']);
  assert.deepEqual(s.banned, ['bad']); assert.equal(s.soundUrl, ''); assert.equal(s.template, DEFAULTS.template);
  assert.deepEqual(settingsOf('not json'), DEFAULTS);
});

test('what gets held', () => {
  const s = settingsOf({ banned: ['badword'] });
  assert.equal(held(s, { from_name: 'a', text: 'hello stream' }), false);
  assert.equal(held(s, { from_name: 'a', text: 'this has BADWORD' }), true);
  assert.equal(held(s, { from_name: 'a', text: 'buy at pump.fun now' }), true);
  assert.equal(held(s, { from_name: 'a', text: 'ca 2NCR5VHESnJnt8VPyTSfuPCaATT5ynDs3Q7KRWrRfDb2' }), true);
  assert.equal(held(settingsOf({ filterLinks: false }), { text: 'https://x.com' }), false);
  assert.equal(held(settingsOf({ modQueue: true }), { text: 'hi' }), true);
});
