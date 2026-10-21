// LAMP AI — voice reply (Gemini TTS → WAV, converted to OGG/Opus when ffmpeg exists)
import { execFile } from 'child_process';
import { Modality } from '@google/genai';
import { ai, withTimeout } from './ai.js';
import { MODELS, TTS_VOICE } from './config.js';
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

/** Returns { buffer, filename, contentType, isVoice } or null when there is nothing to say. */
export async function speak(text) {
  const say = toSpeech(text);
  if (say.length < 3) return null;
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await withTimeout(ai.models.generateContent({
        model: MODELS.tts,
        contents: [{ parts: [{ text: say }] }],
        config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } } },
      }), 90_000, 'tts');
      const data = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
      if (!data) throw new Error('no audio returned');
      const wav = pcmToWav(Buffer.from(data, 'base64'));
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
  throw lastErr;
}
