// Spoken alerts as audio files, made on the server (Google Cloud Text-to-Speech), so they play inside an OBS browser source
// (OBS doesn't reliably play the browser's own speech). "browser" voice, or no GOOGLE_TTS_KEY: the overlay speaks it itself.
export const VOICES = [
  { id: 'browser', name: 'Browser voice (free, best for a captured Chrome window)' },
  { id: 'en-US-Neural2-J', name: 'US · male (Neural)' },
  { id: 'en-US-Neural2-F', name: 'US · female (Neural)' },
  { id: 'en-US-Neural2-D', name: 'US · male, deep (Neural)' },
  { id: 'en-US-Neural2-C', name: 'US · female, bright (Neural)' },
  { id: 'en-GB-Neural2-B', name: 'UK · male (Neural)' },
  { id: 'en-GB-Neural2-A', name: 'UK · female (Neural)' },
  { id: 'en-AU-Neural2-B', name: 'Australia · male (Neural)' },
  { id: 'en-US-Standard-B', name: 'US · male (Standard)' },
];
export const serverVoice = (env, v) => !!env.GOOGLE_TTS_KEY && v !== 'browser' && VOICES.some(x => x.id === v);

export async function synthesize(env, text, voice, rate = 1) {
  const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(env.GOOGLE_TTS_KEY)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: { text }, voice: { languageCode: voice.split('-').slice(0, 2).join('-'), name: voice },
      audioConfig: { audioEncoding: 'MP3', speakingRate: Math.min(2, Math.max(0.5, +rate || 1)) } }),
  });
  if (!r.ok) throw new Error('tts ' + r.status);
  const { audioContent } = await r.json();
  return Uint8Array.from(atob(audioContent), c => c.charCodeAt(0));
}
