// LAMP AI — voice reply (Gemini TTS → WAV, converted to OGG/Opus when ffmpeg exists)
import { execFile } from 'child_process';
import { Modality } from '@google/genai';
import { ai, withTimeout, groqTranscribe } from './ai.js';
import { MODELS, VOICES } from './config.js';
import { toSpeech } from './telegram-format.js';

function pcmToWav(pcm, sampleRate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

let ffmpegOk = null;
function hasFfmpeg() {
  if (ffmpegOk !== null) return Promise.resolve(ffmpegOk);
  return new Promise((res) => execFile('ffmpeg', ['-version'], (err) => res((ffmpegOk = !err))));
}

function wavToOgg(wav) {
  return new Promise((resolve, reject) => {
    const p = execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    p.stdin.end(wav);
  });
}

// The speech model must read the text, not "perform" it. It never gets Arabic text (see toSpeech),
// and each audio is checked before sending: length, no Arabic spoken, no words that are not written.
const seconds = (pcm) => pcm.length / (24000 * 2);
async function looksFaithful(pcm, wav, say, lang) {
  const dur = seconds(pcm);
  const expected = say.length / 14;                          // ~14 characters per second of speech
  if (dur > expected * 1.7 + 6) return `audio trop long (${dur.toFixed(0)}s pour ~${expected.toFixed(0)}s)`;
  const heard = await groqTranscribe(wav, 'audio/wav').catch(() => '');
  if (heard) {
    const arabicWords = (heard.match(/[\u0600-\u06FF]{2,}/g) || []).length;
    if (arabicWords >= 3) return `de l'arabe a été prononcé (${arabicWords} mots)`;
    if (heard.length > say.length * 1.6 + 60) return 'texte prononcé plus long que le texte écrit';
    if (lang !== 'wo') {                                     // Whisper does not know Wolof: word check only in fr/en
      const norm = (x) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/).filter((w) => w.length > 3);
      const written = norm(say);
      const known = (w) => written.some((x) => x === w || (w.length > 4 && x.length > 4 && x.slice(0, 5) === w.slice(0, 5)));
      const extra = norm(heard).filter((w) => !known(w));
      // a speech model that "adds" something (a verse, a prayer) produces several unwritten words
      if (extra.length >= 3) return `mots non écrits prononcés : ${extra.slice(0, 6).join(', ')}`;
      // ...and one that skips a sentence can change who said what ("Allah dit : <next sentence>")
      const said = norm(heard);
      const heardKnown = (w) => said.some((x) => x === w || (w.length > 4 && x.length > 4 && x.slice(0, 5) === w.slice(0, 5)));
      const missing = written.filter((w) => !heardKnown(w));
      if (missing.length >= 4) return `phrases sautées : ${missing.slice(0, 6).join(', ')}`;
    }
  }
  return '';
}

/** Returns { buffer, filename, contentType, isVoice } or null when there is nothing to say (or the audio is not faithful). */
export async function speak(text, lang = 'fr', recited = false) {
  const say = toSpeech(text, lang, recited);
  if (say.length < 3) return null;
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await withTimeout(ai.models.generateContent({
        model: MODELS.tts,
        contents: [{ parts: [{ text: say }] }],     // the text alone: any instruction would be read aloud too
        config: { temperature: 0, responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES[lang] || VOICES.fr } } } },
      }), 120_000, 'tts');
      const data = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
      if (!data) throw new Error('no audio returned');
      const pcm = Buffer.from(data, 'base64');
      const wav = pcmToWav(pcm);
      const problem = await looksFaithful(pcm, wav, say, lang);
      if (problem) { console.warn(`[Voice] audio rejected: ${problem}`); lastErr = new Error(problem); continue; }
      if (await hasFfmpeg()) {
        try { return { buffer: await wavToOgg(wav), filename: 'lamp.ogg', contentType: 'audio/ogg', isVoice: true }; } catch { /* send wav */ }
      }
      return { buffer: wav, filename: 'lamp.wav', contentType: 'audio/wav', isVoice: false };
    } catch (e) {
      lastErr = e;
      if (/429|quota/i.test(e.message)) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.warn(`[Voice] no voice note sent: ${lastErr?.message || 'unknown'}`);
  return null;                                               // the written answer is enough
}
