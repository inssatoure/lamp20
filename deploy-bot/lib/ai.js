// LAMP AI — model calls with timeout + automatic fallback (Gemini chain, then Groq)
import { GoogleGenAI } from '@google/genai';
import { GEMINI_API_KEY, GROQ_API_KEY, MODELS, GROQ_MODELS, AI_TIMEOUT_MS, LIGHT_TIMEOUT_MS } from './config.js';

export const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

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
  for (const model of models) {
    if (isExhausted(model)) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await withTimeout(ai.models.generateContent({ ...params, model }), timeout, model);
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || err);
        if (isQuota(msg)) {
          console.warn(`[AI] ${model} quota exhausted → next model`);
          exhausted.set(model, Date.now() + 10 * 60_000);
          break;
        }
        if (!isBusy(msg)) throw err;              // real error (bad request…) → no point retrying
        if (/timeout/i.test(msg)) { console.warn(`[AI] ${model} too slow → next model`); break; }
        console.warn(`[AI] ${model} busy (${msg.slice(0, 60)}) → retry`);
        await sleep(2000);
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

// Groq (OpenAI-compatible). Text only — tools and audio are dropped.
async function groqChat(params) {
  const messages = [];
  const sys = params.config?.systemInstruction;
  if (sys) messages.push({ role: 'system', content: String(sys) });
  const contents = typeof params.contents === 'string'
    ? [{ role: 'user', parts: [{ text: params.contents }] }]
    : Array.isArray(params.contents) ? params.contents : null;
  if (!contents) return '';
  for (const m of contents) {
    const t = (m.parts || []).map((p) =>
      p.text || (p.functionResponse ? `[Source ${p.functionResponse.name}] ${JSON.stringify(p.functionResponse.response)}` : '')
    ).join('\n');
    if (t) messages.push({ role: m.role === 'model' ? 'assistant' : 'user', content: t });
  }
  if (!messages.some((m) => m.role === 'user')) return '';
  const json = params.config?.responseMimeType === 'application/json';
  for (const model of GROQ_MODELS) {
    try {
      const res = await withTimeout(fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, messages, temperature: params.config?.temperature ?? 0.4,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
      }), AI_TIMEOUT_MS, `groq ${model}`);
      if (!res.ok) { console.warn(`[Groq] ${model} ${res.status}`); continue; }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      if (text) { console.warn(`[Groq] answered with ${model}`); return text; }
    } catch (e) { console.warn(`[Groq] ${model}: ${e.message}`); }
  }
  return '';
}

export function parseJson(raw) {
  const s = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  return JSON.parse(start >= 0 && end > start ? s.slice(start, end + 1) : s);
}
