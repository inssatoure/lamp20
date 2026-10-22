// LAMP AI — model calls with timeout + automatic fallback (Gemini chain, then Groq)
import { GoogleGenAI } from '@google/genai';
import { GEMINI_API_KEYS, GROQ_API_KEY, ELEVENLABS_API_KEY, MODELS, GROQ_MODELS, AI_TIMEOUT_MS, LIGHT_TIMEOUT_MS } from './config.js';

// ─── Gemini keys: use the first working one, skip a key whose billing/permission fails ───
const KEYS = GEMINI_API_KEYS.map((apiKey, i) => ({ n: i + 1, client: new GoogleGenAI({ apiKey }), deadUntil: 0 }));
const liveKeys = () => KEYS.filter((k) => k.deadUntil < Date.now());
function killKey(k, msg) {
  k.deadUntil = Date.now() + 30 * 60_000;
  console.warn(`[AI] Gemini key #${k.n} refused (${msg.slice(0, 70)}) → ${liveKeys().length ? 'next key' : 'no key left'}`);
}
/** `ai.models` always points at the first working key (used by TTS and embeddings). */
export const ai = { get models() { return (liveKeys()[0] || KEYS[0]).client.models; } };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function withTimeout(promise, ms = AI_TIMEOUT_MS, label = 'AI call') {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timeout after ${ms}ms`)), ms); }),
  ]);
}

const isQuota = (m) => /429|RESOURCE_EXHAUSTED|quota/i.test(m);
const isBusy = (m) => /503|500|UNAVAILABLE|INTERNAL|overloaded|high demand|timeout|ECONNRESET|ETIMEDOUT|fetch failed|socket/i.test(m);

// Models that hit their daily quota are skipped for 10 minutes (saves a wasted call each time)
const exhausted = new Map();
const isExhausted = (model) => (exhausted.get(model) || 0) > Date.now();

/**
 * generate({ contents, config }, 'answer' | 'light')
 * Tries each model of the chain; on overload retries once; on quota moves to the next.
 * Returns the Gemini response, or { text, groq: true } when Groq answered.
 */
export async function generate(params, chain = 'answer') {
  const models = MODELS[chain] || MODELS.answer;
  const timeout = chain === 'light' ? LIGHT_TIMEOUT_MS : AI_TIMEOUT_MS;
  let lastErr;
  for (const key of liveKeys()) {
  gemini: for (const model of models) {
    const slot = `${key.n}:${model}`;
    if (isExhausted(slot)) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { toolRunner, _only, ...geminiParams } = params;
        // the Gemini SDK rewrites tool schemas in place: give it a copy so Groq still gets clean ones
        const config = geminiParams.config ? structuredClone(geminiParams.config) : undefined;
        return await withTimeout(key.client.models.generateContent({ ...geminiParams, config, model }), timeout, model);
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || err);
        if (isQuota(msg)) {
          console.warn(`[AI] ${model} (key #${key.n}) quota exhausted → next`);
          exhausted.set(slot, Date.now() + 10 * 60_000);
          break;
        }
        if (/API_KEY|PERMISSION_DENIED|403|401|402|billing|suspended|prepayment|depleted/i.test(msg)) {
          killKey(key, msg);   // key/account problem: no model will work with this key
          break gemini;
        }
        if (!isBusy(msg)) { console.warn(`[AI] ${model} error (${msg.slice(0, 70)}) → next`); break; }
        if (/timeout/i.test(msg)) { console.warn(`[AI] ${model} too slow → next model`); break; }
        console.warn(`[AI] ${model} busy (${msg.slice(0, 60)}) → retry`);
        await sleep(2000);
      }
    }
  }
  }
  if (GROQ_API_KEY) {
    const text = await groqChat(params);
    if (text) return { text, groq: true };
  }
  throw lastErr || new Error('All models unavailable');
}

/** Same as generate() but returns plain text ('' on total failure if soft=true). */
export async function generateText(params, chain = 'answer', soft = false) {
  try {
    const r = await generate(params, chain);
    return (r.text || '').trim();
  } catch (e) {
    if (soft) return '';
    throw e;
  }
}

// ─── Groq (OpenAI-compatible) ────────────────────────────────────────────────
// Used when every Gemini model is unavailable. Supports the library tools: pass
// params.toolRunner(name, args) and the Gemini functionDeclarations are offered to Groq too.
function toGroqTools(tools) {
  const decls = (tools || []).flatMap((t) => t.functionDeclarations || []);
  return decls.map((d) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.parameters } }));
}

async function groqCall(model, body) {
  const res = await withTimeout(fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, ...body }),
  }), AI_TIMEOUT_MS, `groq ${model}`);
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`groq ${model} ${res.status}: ${body.slice(0, 120)}`);
    const m = body.match(/try again in ([\d.]+)s/);
    if (res.status === 429) err.retryAfter = m ? Number(m[1]) : 60;
    throw err;
  }
  return (await res.json()).choices?.[0]?.message || {};
}

async function groqChat(params) {
  const messages = [];
  const sys = params.config?.systemInstruction;
  if (sys) messages.push({ role: 'system', content: String(sys) });
  const contents = typeof params.contents === 'string'
    ? [{ role: 'user', parts: [{ text: params.contents }] }]
    : Array.isArray(params.contents) ? params.contents : null;
  if (!contents) return '';                                   // audio / multimodal: not for Groq chat
  for (const m of contents) {
    const t = (m.parts || []).map((p) =>
      p.text || (p.functionResponse ? `[Résultat ${p.functionResponse.name}] ${JSON.stringify(p.functionResponse.response)}` : '')
    ).join('\n');
    if (t) messages.push({ role: m.role === 'model' ? 'assistant' : 'user', content: t });
  }
  if (!messages.some((m) => m.role === 'user')) return '';
  const json = params.config?.responseMimeType === 'application/json';
  const tools = params.toolRunner ? toGroqTools(params.config?.tools) : [];
  const temperature = params.config?.temperature ?? 0.4;

  for (const model of params._only ? [params._only] : GROQ_MODELS) {
    if (!params._only && isExhausted(`groq:${model}`)) continue;
    try {
      const msgs = [...messages];
      for (let round = 0; round <= 4; round++) {
        const withTools = tools.length && round < 4;
        const msg = await groqCall(model, {
          messages: msgs, temperature,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
          ...(withTools ? { tools, tool_choice: 'auto' } : {}),
        });
        if (withTools && msg.tool_calls?.length) {
          msgs.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
          for (const c of msg.tool_calls) {
            let args = {};
            try { args = JSON.parse(c.function.arguments || '{}'); } catch { /* keep {} */ }
            const out = await params.toolRunner(c.function.name, args);
            msgs.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(out).slice(0, 12000) });
          }
          continue;
        }
        const text = (msg.content || '').trim();
        if (text) { console.warn(`[Groq] answered with ${model}`); return text; }
        break;
      }
    } catch (e) {
      console.warn(`[Groq] ${e.message.slice(0, 90)}`);
      if (e.retryAfter && e.retryAfter <= 15) {                 // short wait requested: wait once, same model
        await sleep(e.retryAfter * 1000 + 300);
        try { const again = await groqChat({ ...params, _only: model }); if (again) return again; } catch { /* next */ }
      }
      if (e.retryAfter) exhausted.set(`groq:${model}`, Date.now() + Math.min(e.retryAfter, 120) * 1000);
    }
  }
  return '';
}

/** Speech → text with Groq Whisper (backup when Gemini can't transcribe). */
// ElevenLabs Scribe: one of the few speech engines trained on Wolof (and it handles
// Wolof mixed with French). Language is detected automatically.
export async function elevenTranscribe(buffer, mimeType) {
  if (!ELEVENLABS_API_KEY) return '';
  const ext = /ogg|opus/.test(mimeType) ? 'ogg' : /mp4|m4a/.test(mimeType) ? 'm4a' : /wav/.test(mimeType) ? 'wav' : 'mp3';
  for (const model of ['scribe_v2', 'scribe_v1']) {
    try {
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: mimeType }), `audio.${ext}`);
      form.append('model_id', model);
      form.append('tag_audio_events', 'false');
      const res = await withTimeout(fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST', headers: { 'xi-api-key': ELEVENLABS_API_KEY }, body: form,
      }), AI_TIMEOUT_MS, `elevenlabs ${model}`);
      if (!res.ok) { console.warn(`[ElevenLabs] ${model} ${res.status} ${(await res.text()).slice(0, 120)}`); if (res.status === 401 || res.status === 402) return ''; continue; }
      const j = await res.json();
      const text = (j.text || '').trim();
      if (text) { console.warn(`[ElevenLabs] transcribed with ${model} (${j.language_code})`); return text; }
    } catch (e) { console.warn(`[ElevenLabs] ${model}: ${e.message}`); }
  }
  return '';
}

// Whisper has no Wolof: left alone it guesses another language (Indonesian, Malay…) and
// writes nonsense. So we give it the usual vocabulary, and if it still picks a language
// other than French / English / Arabic we redo it forcing French — Wolof then comes out
// in the French-style spelling Senegalese people write it with ("dama bëgg", "yaw yay kan").
const WHISPER_OK = new Set(['french', 'english', 'arabic', 'fr', 'en', 'ar']);
export async function groqTranscribe(buffer, mimeType, vocabulary = '') {
  if (!GROQ_API_KEY) return '';
  const ext = /ogg|opus/.test(mimeType) ? 'ogg' : /mp4|m4a/.test(mimeType) ? 'm4a' : /wav/.test(mimeType) ? 'wav' : 'mp3';
  const call = async (model, language) => {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), `audio.${ext}`);
    form.append('model', model);
    form.append('temperature', '0');
    form.append('response_format', 'verbose_json');
    if (vocabulary) form.append('prompt', vocabulary.slice(0, 850));
    if (language) form.append('language', language);
    const res = await withTimeout(fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${GROQ_API_KEY}` }, body: form,
    }), AI_TIMEOUT_MS, `groq ${model}`);
    if (!res.ok) throw new Error(`${model} ${res.status}`);
    const j = await res.json();
    return { text: (j.text || '').trim(), language: String(j.language || '').toLowerCase() };
  };
  for (const model of ['whisper-large-v3', 'whisper-large-v3-turbo']) {
    try {
      let r = await call(model);
      if (r.text && !WHISPER_OK.has(r.language)) {
        console.warn(`[Groq] Whisper heard "${r.language}" → redo as French (probably Wolof)`);
        r = await call(model, 'fr');
      }
      if (r.text) { console.warn(`[Groq] transcribed with ${model}`); return r.text; }
    } catch (e) { console.warn(`[Groq] ${e.message}`); }
  }
  return '';
}

export function parseJson(raw) {
  const s = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  return JSON.parse(start >= 0 && end > start ? s.slice(start, end + 1) : s);
}
