// LAMP AI — voice reply (Gemini TTS → WAV, converted to OGG/Opus when ffmpeg exists)
import { execFile } from 'child_process';
import { Modality } from '@google/genai';
import { withEachKey, withTimeout, groqTranscribe } from './ai.js';
import { MODELS, VOICES, FFMPEG } from './config.js';
import { toSpeech } from './telegram-format.js';
import * as S from './sources.js';

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
  return new Promise((res) => execFile(FFMPEG, ['-version'], (err) => res((ffmpegOk = !err))));
}

function wavToOgg(wav) {
  return new Promise((resolve, reject) => {
    const p = execFile(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    p.stdin.end(wav);
  });
}

// The speech model must read the text, not "perform" it. It never gets Arabic text (see toSpeech),
// and each audio is checked before sending: length, no Arabic spoken, no words that are not written.
const seconds = (pcm) => pcm.length / (24000 * 2);
// What the voice said vs what was written. The transcription engine itself misspells names
// ("Saïd al-Bourhari" for Sahih al-Bukhari) and homophones ("pain" for "pin"): such scattered
// differences are normal. A voice that ADDS something (a verse, a prayer, an improvised sentence)
// produces several unwritten words in a row; one that SKIPS a sentence leaves several written
// words in a row unheard. Only those are refused.
const norm = (x) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’-]/g, '').split(/[^a-z]+/).filter((w) => w.length > 3);
// Arabic names are spelled many ways (Baqara/Bakara, Ahmadou/Amadou): compare their consonants
const sk = (w) => w.replace(/ou/g, 'u').replace(/q|kh/g, 'k').replace(/dh|th/g, 'd').replace(/sh|ch/g, 's')
  .replace(/([^aeiouy])h/g, '$1').replace(/^h/, '').replace(/(.)\1+/g, '$1').replace(/(?!^)[aeiouy]/g, '');
const lev1 = (a, b) => {                                    // edit distance ≤ 1
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
};
const close = (a, b) => a === b || (a.length > 4 && b.length > 4 && a.slice(0, 5) === b.slice(0, 5))
  || (Math.min(sk(a).length, sk(b).length) >= 3 && Math.max(sk(a).length, sk(b).length) >= 4 && lev1(sk(a), sk(b)));   // Serigne/Serine

// Align the two word lists in order (like a diff). Returns the runs of written words not heard
// and of heard words not written.
function align(written, said) {
  const n = written.length; const m = said.length;
  const eq = (i, j) => close(written[i], said[j])
    || (i + 1 < n && close(written[i] + written[i + 1], said[j]))          // "khadimou rassoul" → "hadimourassoul"
    || (j + 1 < m && close(written[i], said[j] + said[j + 1]));
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = eq(i, j) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const skipped = []; const added = []; let curS = []; let curA = [];
  let i = 0; let j = 0;
  const flush = () => { if (curS.length) skipped.push(curS); if (curA.length) added.push(curA); curS = []; curA = []; };
  while (i < n && j < m) {
    if (eq(i, j)) { flush(); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) { curS.push(written[i++]); } else { curA.push(said[j++]); }
  }
  while (i < n) curS.push(written[i++]);
  while (j < m) curA.push(said[j++]);
  flush();
  return { skipped, added };
}

export function wordProblems(say, heard) {
  const written = norm(say); const said = norm(heard);
  const { skipped, added } = align(written, said);
  const bigAdd = added.find((r) => r.length >= 3);
  if (bigAdd) return `ajout de mots non écrits : ${bigAdd.join(' ')}`;
  const bigSkip = skipped.find((r) => r.length >= 4);
  if (bigSkip) return `passage sauté : ${bigSkip.join(' ')}`;
  const extra = added.reduce((n, r) => n + r.length, 0);
  if (said.length > 20 && extra / said.length > 0.15) return `trop de mots non écrits (${extra}/${said.length})`;
  return '';
}

async function looksFaithful(pcm, wav, say, lang) {
  const dur = seconds(pcm);
  const expected = say.length / 14;                          // ~14 characters per second of speech
  if (dur > expected * 1.7 + 6) return `audio trop long (${dur.toFixed(0)}s pour ~${expected.toFixed(0)}s)`;
  const heard = await groqTranscribe(wav, 'audio/wav').catch(() => '');
  if (process.env.LAMP_DEBUG_VOICE) console.log('[Voice] heard:', heard);
  if (heard) {
    const arabicWords = (heard.match(/[\u0600-\u06FF]{2,}/g) || []).length;
    if (arabicWords >= 3) {
      // Whisper sometimes writes Wolof speech in Arabic letters. A real problem is when the voice
      // recited a verse or a prayer: then what it heard matches the Quran or a Khassaid.
      if (lang !== 'wo') return `de l'arabe a été prononcé (${arabicWords} mots)`;
      const runs = heard.match(/[\u0600-\u06FF][\u0600-\u06FF\s]{12,}/g) || [];
      if (runs.some((r) => S.verifyArabic(r.trim()).status !== 'unknown')) return 'un texte sacré a été récité par la voix';
    }
    if (heard.length > say.length * 1.6 + 60) return 'texte prononcé plus long que le texte écrit';
    if (lang !== 'wo') {                                     // Whisper does not know Wolof: word check only in fr/en
      const p = wordProblems(say, heard);
      if (p) return p;
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
      const r = await withEachKey((c) => withTimeout(c.models.generateContent({
        model: MODELS.tts,
        contents: [{ parts: [{ text: say }] }],     // the text alone: any instruction would be read aloud too
        config: { temperature: 0, responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES[lang] || VOICES.fr } } } },
      }), 120_000, 'tts'));
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
