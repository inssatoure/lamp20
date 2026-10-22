// LAMP AI — audio of the Arabic texts quoted in an answer.
//  • Quran: the real recitation of Sheikh Mishary Alafasy (everyayah.com), never a synthetic voice.
//  • Khassaids: read by the bot's fixed voice from the library text, then listened back by a second
//    engine (Whisper, Arabic) and compared with the library. An audio that does not match is not sent.
import { execFile } from 'child_process';
import { Modality } from '@google/genai';
import { withEachKey, withTimeout, groqTranscribe } from './ai.js';
import { MODELS, VOICES } from './config.js';
import * as S from './sources.js';

const AR = '؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿';
// one line at a time: a quote written over two lines is two passages (two hemistichs)
const ARABIC_RUN = new RegExp(`[${AR}](?:[${AR} \\t\\u00a0\\u200c-\\u200f]|[A-Za-z](?=[${AR}]))*`, 'g');
const MAX_RECITATIONS = 4;

/** The Quran verses and Khassaid distiques quoted in a (checked) answer, in order, without duplicates. */
export function quotedTexts(answer) {
  const seen = new Set(); const items = [];
  for (const run of String(answer).replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ').match(ARABIC_RUN) || []) {
    if (run.trim().split(/\s+/).length < 3) continue;
    const v = S.verifyArabic(run.trim());
    if (v.status === 'unknown' || !v.item) continue;
    const key = v.item.kind === 'quran' ? `q${v.item.sura}:${v.item.ayah}` : `k${v.item.stem}:${v.item.n}`;
    if (seen.has(key)) continue;
    seen.add(key); items.push(v.item);
  }
  return items.slice(0, MAX_RECITATIONS);
}

const pad = (n) => String(n).padStart(3, '0');

function toOgg(input, inputFormat) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', ...(inputFormat ? ['-f', inputFormat, '-ar', '24000', '-ac', '1'] : []),
      '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '48k', '-f', 'ogg', 'pipe:1'];
    const p = execFile('ffmpeg', args, { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(out)));
    p.stdin.end(input);
  });
}

async function quranAudio({ sura, ayah }) {
  const url = `https://everyayah.com/data/Alafasy_128kbps/${pad(sura)}${pad(ayah)}.mp3`;
  const res = await withTimeout(fetch(url), 25_000, 'recitation');
  if (!res.ok) throw new Error(`recitation ${res.status}`);
  const mp3 = Buffer.from(await res.arrayBuffer());
  return toOgg(mp3);
}

async function khassaidAudio({ text }) {
  const r = await withEachKey((c) => withTimeout(c.models.generateContent({
    model: MODELS.tts,
    contents: [{ parts: [{ text }] }],                        // the library text alone, nothing else
    config: { temperature: 0, responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES.ar } } } },
  }), 90_000, 'tts arabic'));
  const data = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
  if (!data) throw new Error('no audio');
  const pcm = Buffer.from(data, 'base64');
  const ogg = await toOgg(pcm, 's16le');
  // listen back and compare with the library text
  const heard = await groqTranscribe(ogg, 'audio/ogg', '', 'ar');
  const score = S.arabicSimilarity(heard, text);
  if (score < 0.85) throw new Error(`lecture non conforme (${Math.round(score * 100)} %)`);
  return ogg;
}

/** [{ buffer, caption }] — audio for each quoted text; texts whose audio fails or does not match are skipped. */
export async function recitations(answer) {
  const out = [];
  for (const item of quotedTexts(answer)) {
    try {
      if (item.kind === 'quran') {
        const buffer = await quranAudio(item);
        if (buffer) out.push({ buffer, caption: `🎧 Coran ${item.sura}:${item.ayah} — récitation de Mishary Alafasy` });
      } else {
        const buffer = await khassaidAudio(item);
        out.push({ buffer, caption: `🎧 ${item.title}, distique ${item.n} — lecture vérifiée sur le texte de la bibliothèque` });
      }
    } catch (e) {
      console.warn(`[Recite] ${item.kind === 'quran' ? `${item.sura}:${item.ayah}` : `${item.title} ${item.n}`} skipped: ${e.message}`);
    }
  }
  return out;
}
