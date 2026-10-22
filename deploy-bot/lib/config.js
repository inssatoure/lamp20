// LAMP AI — configuration (everything adjustable lives here)
import fs from 'fs';
import path from 'path';

const APP_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');   // folder of app.js

// Keys come from the environment, or from a .env file next to app.js (never commit it)
for (const f of [path.join(APP_DIR, '.env'), path.join(APP_DIR, '..', '.env')]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

export const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
// One key, or several separated by commas (GEMINI_API_KEYS=key1,key2): if one key's billing or
// quota fails, the next key is used. Use keys from projects you pay for or own legitimately.
export const GEMINI_API_KEYS = [...new Set(`${process.env.GEMINI_API_KEYS || ''},${process.env.GEMINI_API_KEY || ''}`
  .split(',').map((k) => k.trim()).filter(Boolean))];
export const GEMINI_API_KEY = GEMINI_API_KEYS[0];
export const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';   // Wolof speech-to-text (Scribe)

// Data folder = the first that contains the Khassaid texts:
// LAMP_ROOT_DIR, the cPanel folder, the folder of app.js, or the repo root
const SERVER_DIR = '/home/metawbms/lamp.metafrik.com';
const candidates = [process.env.LAMP_ROOT_DIR, SERVER_DIR, APP_DIR, path.join(APP_DIR, '..')].filter(Boolean);
export const ROOT_DIR = candidates.find((d) => fs.existsSync(path.join(d, 'Textes_Arabes_Serigne_Touba'))) || candidates.at(-1);
export const TEXTES_DIR = path.join(ROOT_DIR, 'Textes_Arabes_Serigne_Touba');
export const SOURCES_DIR = path.join(ROOT_DIR, 'sources');          // Coran + hadiths (scripts/fetch-sources.mjs)
export const VERSETS_CACHE = path.join(ROOT_DIR, 'versets_cache.jsonl');
export const HISTORY_FILE = path.join(ROOT_DIR, 'chat_histories.json');
export const CHAT_LOG_FILE = path.join(ROOT_DIR, 'chat_logs.jsonl');
// Where users' conversations and memories are kept (local backend). On Railway: a volume, e.g. /data
export const DATA_DIR = process.env.LAMP_DATA_DIR || path.join(ROOT_DIR, 'data');
// Firebase service account (JSON text or file path): stores conversations in Firestore instead of files
export const FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT || '';
// Admin page to read the conversations: http://<server>:<PORT>/admin  (off if no password)
export const ADMIN_PASSWORD = process.env.LAMP_ADMIN_PASSWORD || '';
export const PORT = Number(process.env.PORT || 0);

// Models. Each model has its own free quota, so the chain moves on when one is exhausted.
export const MODELS = {
  answer: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  light: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.6-flash'],   // understanding + checks
  tts: 'gemini-3.8-flash-tts',
  embed: 'gemini-embedding-001',
};
export const GROQ_MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];
export const GROQ_LIGHT_MODEL = 'openai/gpt-oss-20b';   // small fast tasks (understanding, corrections, memory)

// Fixed voice for every language (same voice every time; temperature 0 keeps the delivery stable).
export const VOICES = { fr: 'Orus', wo: 'Orus', en: 'Orus', ar: 'Orus' };
export const TTS_VOICE = VOICES.fr;
export const AI_TIMEOUT_MS = 45_000;      // one answer call never waits longer than this
export const LIGHT_TIMEOUT_MS = 12_000;   // understanding call (small JSON)
export const MAX_TOOL_ROUNDS = 2;         // how many times the model may consult the sources per answer
export const HISTORY_MAX = 20;            // messages kept per chat (10 exchanges)
export const VOICE_REPLY = process.env.LAMP_VOICE_REPLY !== 'false';  // send a voice note after each answer

export const firebaseConfig = {
  apiKey: 'AIzaSyAWcGI0OZsHPh-IhglG_4MI9ZcQkkmUKw0',
  authDomain: 'lampridial-19466.firebaseapp.com',
  projectId: 'lampridial-19466',
};
