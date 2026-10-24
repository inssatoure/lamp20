// LAMP AI — model calls with timeout + automatic fallback (Gemini chain, then Groq)
import { GoogleGenAI } from '@google/genai';
import { geminiKeys } from './settings.js';
import * as stats from './stats.js';
import { GROQ_API_KEY, CEREBRAS_API_KEY, ANSWER_ROUTES, LIGHT_ROUTE, FORCE_ANSWER_MODEL, ELEVENLABS_API_KEY, MODELS, AI_TIMEOUT_MS, LIGHT_TIMEOUT_MS } from './config.js';

// ─── Gemini keys: use the first working one, skip a key whose billing/permission fails ───
// The list comes from the admin page (or cPanel): read on every call, so a key added there works at once.
const keyState = new Map();   // api key -> { client, deadUntil, ok, okAt, error, errorAt }
function allKeys() {
  return geminiKeys().map((apiKey, i) => {
    let k = keyState.get(apiKey);
    if (!k) { k = { client: new GoogleGenAI({ apiKey }), deadUntil: 0, ok: 0, okAt: null, error: '', errorAt: null }; keyState.set(apiKey, k); }
    k.n = i + 1; k.apiKey = apiKey;
    return k;
  });
}
const liveKeys = () => allKeys().filter((k) => k.deadUntil < Date.now());
function killKey(k, msg) {
  k.deadUntil = Date.now() + 30 * 60_000;
  console.warn(`[AI] Gemini key #${k.n} refused (${msg.slice(0, 70)}) → ${liveKeys().length ? 'next key' : 'no key left'}`);
  stats.error(`clé Gemini n°${k.n}`, msg);
}
const keyOk = (k) => { k.ok++; k.okAt = new Date().toISOString(); };
const keyError = (k, msg) => { k.error = String(msg).slice(0, 200); k.errorAt = new Date().toISOString(); };

/** For the admin page: how each key is doing since the last restart. */
export function keyStatus() {
  return allKeys().map((k) => ({
    n: k.n, masked: `${k.apiKey.slice(0, 6)}…${k.apiKey.slice(-4)}`, ok: k.ok, okAt: k.okAt, error: k.error, errorAt: k.errorAt,
    pausedUntil: k.deadUntil > Date.now() ? new Date(k.deadUntil).toISOString() : null,
  }));
}

/** One tiny call to see whether a key works now. */
export async function testKey(index) {
  const k = allKeys()[index];
  if (!k) throw new Error('clé introuvable');
  // the cheapest allowed model first; if Google is busy on one model, the other one tells whether the key works
  let msg = '';
  for (const model of [...MODELS.answer].reverse()) {
    try {
      const r = await withTimeout(k.client.models.generateContent({ model, contents: 'Réponds seulement : OK', config: { maxOutputTokens: 20 } }), 20_000, 'test');
      count('gemini', r.usageMetadata?.promptTokenCount, r.usageMetadata?.candidatesTokenCount);
      keyOk(k); k.deadUntil = 0;
      return { ok: true, text: 'La clé fonctionne.' };
    } catch (e) {
      msg = String(e?.message || e);
      if (!isBusy(msg) && !isQuota(msg)) break;       // a key problem: the other model would say the same
    }
  }
  keyError(k, msg);
  const why = /prepayment|depleted|billing/i.test(msg) ? 'crédit épuisé sur ce compte Google'
    : isQuota(msg) ? 'quota du jour épuisé (elle remarchera plus tard)'
      : /API_KEY|PERMISSION_DENIED|\b40[13]\b|invalid/i.test(msg) ? 'clé refusée par Google (invalide ou désactivée)'
        : isBusy(msg) ? 'Google est saturé en ce moment, réessaie' : msg.slice(0, 120);
  return { ok: false, text: why };
}
/** `ai.models` always points at the first working key (used by TTS and embeddings). */
export const ai = { get models() { return (liveKeys()[0] || allKeys()[0]).client.models; } };

// Voice has its own small daily quota per key: try each key until one still has some.
const ttsSpent = new Map();   // key n -> until
export async function withEachKey(fn) {
  let lastErr;
  for (const k of liveKeys()) {
    if ((ttsSpent.get(k.n) || 0) > Date.now()) continue;
    try { return await fn(k.client); } catch (e) {
      lastErr = e;
      if (/429|RESOURCE_EXHAUSTED|quota/i.test(String(e.message))) { ttsSpent.set(k.n, Date.now() + 60 * 60_000); continue; }
      throw e;
    }
  }
  throw lastErr || new Error('no key left for voice');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── token counter (text models only) ────────────────────────────────────────
const usage = { gemini: { calls: 0, in: 0, out: 0 }, groq: { calls: 0, in: 0, out: 0 }, cerebras: { calls: 0, in: 0, out: 0 } };
function count(who, input = 0, output = 0) { usage[who].calls++; usage[who].in += input || 0; usage[who].out += output || 0; stats.tokens(who, input, output); }
export const getUsage = () => structuredClone(usage);
export function resetUsage() { for (const u of Object.values(usage)) Object.assign(u, { calls: 0, in: 0, out: 0 }); }

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
const overloaded = new Map();   // model -> until (Google overload is per model, not per key)
const isExhausted = (model) => (exhausted.get(model) || 0) > Date.now();

/**
 * generate({ contents, config }, 'answer' | 'light')
 * Tries each model of the chain; on overload retries once; on quota moves to the next.
 * Returns the Gemini response, or { text, groq: true } when Groq answered.
 */
let lastRoute = '';
/** Which model wrote the last answer (for quality tracking). */
export const lastAnswerModel = () => lastRoute;

export async function generate(params, chain = 'answer') {
  if (chain === 'answer' && FORCE_ANSWER_MODEL) return forced(params);
  const models = MODELS[chain] || MODELS.answer;
  const timeout = chain === 'light' ? LIGHT_TIMEOUT_MS : AI_TIMEOUT_MS;
  // Small tasks (understanding, corrections, memory) go to Groq first: it answers in ~1 s and
  // keeps the Gemini quota for the answers. Gemini is the backup for them.
  if (chain === 'light' && hasProvider(LIGHT_ROUTE) && !params.toolRunner && typeof params.contents === 'string') {
    const text = await groqChat({ ...params, _only: LIGHT_ROUTE }).catch(() => '');
    if (text) return { text, groq: true };
  }
  // Always a time budget: when Google is overloaded the person gets an honest "busy" message (or a
  // checked backup model) instead of waiting minutes.
  const deadline = params.deadline || Date.now() + (chain === 'light' ? 12_000 : 45_000);
  let lastErr;
  const pass = models.flatMap((model) => liveKeys().map((key) => ({ model, key })));
  // two passes: if every model is briefly overloaded, wait a little and try once more before giving up
  const tries = params.preferGroq && HAS_BACKUP ? [] : [...pass, { pause: true }, ...pass.map((t) => ({ ...t, second: true }))];
  for (const { model, key, pause, second } of tries) {      // best model on every key first, then the next model
    if (pause) { if (Date.now() + 8_000 > deadline) break; await sleep(4_000); continue; }
    const slot = `${key.n}:${model}`;
    if (isExhausted(slot) || key.deadUntil > Date.now()) continue;
    if (!second && (overloaded.get(model) || 0) > Date.now()) continue;  // overloaded on another key: same on this one
    if (Date.now() > deadline) { console.warn(`[AI] Gemini too slow today${HAS_BACKUP ? ' → backup models' : ''}`); break; }
    try {
      const { toolRunner, _only, preferGroq, deadline: _d, ...geminiParams } = params;
      // the Gemini SDK rewrites tool schemas in place: give it a copy so Groq still gets clean ones
      const config = geminiParams.config ? structuredClone(geminiParams.config) : undefined;
      // never wait past the budget: a slow Google call is cut and Groq answers instead
      const wait = Math.max(5_000, Math.min(timeout, deadline - Date.now()));
      const r = await withTimeout(key.client.models.generateContent({ ...geminiParams, config, model }), wait, model);
      count('gemini', r.usageMetadata?.promptTokenCount, (r.usageMetadata?.candidatesTokenCount || 0) + (r.usageMetadata?.thoughtsTokenCount || 0));
      keyOk(key);
      if (chain === 'answer') lastRoute = `gemini:${model}`;
      return r;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      if (!isBusy(msg) && !/timeout/i.test(msg)) keyError(key, msg);
      if (/API_KEY|PERMISSION_DENIED|\b40[123]\b|suspended|prepayment|depleted/i.test(msg) && !/\b429\b|RESOURCE_EXHAUSTED/.test(msg)) {
        killKey(key, msg);                                     // key/account problem: no model will work with this key
      } else if (isQuota(msg)) {
        console.warn(`[AI] ${model} (key #${key.n}) quota exhausted → next`);
        exhausted.set(slot, Date.now() + 10 * 60_000);
      } else if (/timeout/i.test(msg) || isBusy(msg)) {
        // overload is Google-side, per model: don't try the same model on the other keys for 2 minutes
        overloaded.set(model, Date.now() + (/timeout/i.test(msg) ? 60_000 : 10_000));   // a 503 is usually over in seconds
        console.warn(`[AI] ${model} ${/timeout/i.test(msg) ? 'too slow' : 'busy'} → next model`);
      } else {
        console.warn(`[AI] ${model} (key #${key.n}) error ${msg.slice(0, 60)} → next`);
      }
    }
  }
  if (HAS_BACKUP) {
    const text = await groqChat(params);
    if (text) return { text, groq: true };
  }
  // Groq could not help either (its per-minute limit): one last patient try on Gemini, no time budget
  if (HAS_BACKUP) {
    for (const { model, key } of models.flatMap((model) => liveKeys().map((key) => ({ model, key })))) {
      if (isExhausted(`${key.n}:${model}`)) continue;
      try {
        const { toolRunner, _only, preferGroq, deadline: _d, ...geminiParams } = params;
        const config = geminiParams.config ? structuredClone(geminiParams.config) : undefined;
        const r = await withTimeout(key.client.models.generateContent({ ...geminiParams, config, model }), timeout, model);
        count('gemini', r.usageMetadata?.promptTokenCount, r.usageMetadata?.candidatesTokenCount);
        return r;
      } catch (e) { lastErr = e; }
      break;
    }
  }
  throw lastErr || new Error('All models unavailable');
}
// Exam mode: every answer by one model, no fallback, so its quality is measured alone.
async function forced(params) {
  const [provider, ...rest] = FORCE_ANSWER_MODEL.split(':');
  const model = rest.join(':');
  if (provider !== 'gemini') {
    for (let attempt = 0; attempt < 10; attempt++) {          // rate limits: wait and retry, never switch model
      try {
        const text = await groqChat({ ...params, _only: FORCE_ANSWER_MODEL, _noRetry: true });
        if (text) return { text, groq: true };
        throw new Error('empty');
      } catch (e) { await sleep(Math.min((e.retryAfter || 20) * 1000 + 500, 30_000)); }
    }
    throw new Error(`${FORCE_ANSWER_MODEL} unavailable`);
  }
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const key of liveKeys()) {
      try {
        const { toolRunner, _only, preferGroq, deadline: _d, ...geminiParams } = params;
        const config = geminiParams.config ? structuredClone(geminiParams.config) : undefined;
        const r = await withTimeout(key.client.models.generateContent({ ...geminiParams, config, model }), 90_000, model);
        count('gemini', r.usageMetadata?.promptTokenCount, (r.usageMetadata?.candidatesTokenCount || 0) + (r.usageMetadata?.thoughtsTokenCount || 0));
        lastRoute = FORCE_ANSWER_MODEL;
        return r;
      } catch (e) { lastErr = e; }
    }
    await sleep(10_000);
  }
  throw lastErr;
}

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

const PROVIDERS = {
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', key: GROQ_API_KEY },
  cerebras: { url: 'https://api.cerebras.ai/v1/chat/completions', key: CEREBRAS_API_KEY },
};
const hasProvider = (route) => !!PROVIDERS[route.split(':')[0]]?.key;
const HAS_BACKUP = ANSWER_ROUTES.some(hasProvider);     // a checked backup model exists: then Gemini gets a time budget

async function groqCall(route, body) {
  const [provider, ...rest] = route.split(':');
  const model = rest.join(':');
  const p = PROVIDERS[provider];
  const res = await withTimeout(fetch(p.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, ...body }),
  }), AI_TIMEOUT_MS, route);
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`${route} ${res.status}: ${text.slice(0, 120)}`);
    const m = text.match(/try again in ([\d.]+)s/) || [null, res.headers.get('retry-after')];
    if (res.status === 429) err.retryAfter = m[1] ? Number(m[1]) : 60;
    throw err;
  }
  const j = await res.json();
  count(provider, j.usage?.prompt_tokens, j.usage?.completion_tokens);
  return j.choices?.[0]?.message || {};
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
  const tools = params.toolRunner && params.config?.toolConfig?.functionCallingConfig?.mode !== 'NONE' ? toGroqTools(params.config?.tools) : [];
  const temperature = params.config?.temperature ?? 0.4;

  for (const model of (params._only ? [params._only] : ANSWER_ROUTES).filter(hasProvider)) {
    if (!params._only && isExhausted(model)) continue;
    try {
      const msgs = [...messages];
      for (let round = 0; round <= 2; round++) {
        const withTools = tools.length && round < 2;
        const body = {
          messages: msgs, temperature,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
          ...(withTools ? { tools, tool_choice: 'auto' } : {}),
        };
        // Groq sometimes rejects its own JSON mode ("Failed to validate JSON"): ask again in plain text, we parse it
        const msg = await groqCall(model, body).catch((e) => {
          if (json && /validate JSON|json_validate/i.test(e.message)) { delete body.response_format; return groqCall(model, body); }
          throw e;
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
        if (text) { console.warn(`[AI] answered with ${model}`); lastRoute = model; return text; }
        break;
      }
    } catch (e) {
      console.warn(`[AI] ${e.message.slice(0, 90)}`);
      if (e.retryAfter && e.retryAfter <= 15) {                 // short wait requested: wait once, same model
        await sleep(e.retryAfter * 1000 + 300);
        try { const again = await groqChat({ ...params, _only: model }); if (again) return again; } catch { /* next */ }
      }
      if (e.retryAfter) exhausted.set(model, Date.now() + Math.min(e.retryAfter, 120) * 1000);
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
export async function groqTranscribe(buffer, mimeType, vocabulary = '', forceLanguage = '') {
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
      let r = await call(model, forceLanguage || undefined);
      if (r.text && !forceLanguage && !WHISPER_OK.has(r.language)) {
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
