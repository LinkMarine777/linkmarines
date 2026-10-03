// What a streamer can set on the dashboard (checked and clamped here, whatever the page sent), and the tip filter.
import { VOICES } from './tts.js';

export const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
// links and contract addresses (held when the streamer's link filter is on)
const BAD = /(https?:\/\/|www\.|\.(com|xyz|io|net|org|gg|fun|app|link|ly|me|so|tv)\b|t\.me|discord\.gg|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b)/i;

export const DEFAULTS = {
  tagline: '', minUsd: 1, maxChars: 200, tokens: ['usdc', 'sol'],
  tts: true, voice: 'en-US-Neural2-J', rate: 1, ttsVolume: 1, readName: true, ttsMinUsd: 0,
  sound: 'chime', soundUrl: '', soundVolume: 0.6,
  duration: 8, position: 'top', anim: 'pop', font: 'Inter', accent: '#ffb000', bg: '#0b1020', text: '#ffffff', opacity: 0.92,
  template: '{name} sent {amount}', showAmount: true,
  modQueue: false, filterLinks: true, banned: [],
};
export const FONTS = ['Inter', 'VT323', 'Bangers', 'Press Start 2P', 'Roboto Mono', 'Permanent Marker'];
export function settingsOf(raw) {
  let s = {}; try { s = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {}; } catch (e) {}
  const o = { ...DEFAULTS }, num = (k, lo, hi) => { const v = +s[k]; if (Number.isFinite(v)) o[k] = Math.min(hi, Math.max(lo, v)); };
  const pick = (k, list) => { if (list.includes(s[k])) o[k] = s[k]; }, bool = k => { if (typeof s[k] === 'boolean') o[k] = s[k]; };
  const color = k => { if (/^#[0-9a-f]{6}$/i.test(s[k] || '')) o[k] = s[k]; };
  if (typeof s.tagline === 'string') o.tagline = clean(s.tagline, 140);
  num('minUsd', 0.5, 1000); num('maxChars', 20, 300); num('rate', 0.5, 2); num('ttsVolume', 0, 1); num('ttsMinUsd', 0, 1000);
  num('soundVolume', 0, 1); num('duration', 3, 30); num('opacity', 0, 1);
  if (Array.isArray(s.tokens)) { const t = s.tokens.filter(x => x === 'usdc' || x === 'sol'); if (t.length) o.tokens = [...new Set(t)]; }
  pick('voice', VOICES.map(v => v.id)); pick('sound', ['chime', 'coin', 'none', 'url']); pick('position', ['top', 'center', 'bottom']);
  pick('anim', ['pop', 'slide', 'fade']); pick('font', FONTS);
  ['tts', 'readName', 'showAmount', 'modQueue', 'filterLinks'].forEach(bool);
  ['accent', 'bg', 'text'].forEach(color);
  if (typeof s.soundUrl === 'string' && /^https:\/\/\S{1,400}$/.test(s.soundUrl)) o.soundUrl = s.soundUrl;
  if (typeof s.template === 'string' && s.template.trim()) o.template = clean(s.template, 80);
  if (Array.isArray(s.banned)) o.banned = s.banned.map(w => clean(w, 40).toLowerCase()).filter(Boolean).slice(0, 200);
  return o;
}

// tip held for the streamer to approve? (their mod queue, links / contract addresses, their banned words)
export function held(s, o) {
  if (s.modQueue) return true;
  const all = `${o.from_name || ''} ${o.text || ''}`;
  if (s.filterLinks && BAD.test(all)) return true;
  const low = all.toLowerCase();
  return s.banned.some(w => low.includes(w));
}
