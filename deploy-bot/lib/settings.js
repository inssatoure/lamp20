// LAMP AI — settings changed from the admin page (Gemini keys, daily limit, guidance for the bot).
// Kept in DATA_DIR/settings.json (never in the code or on GitHub). A setting left empty here falls
// back to the server's environment variables (cPanel), so nothing changes until the admin edits it.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR, GEMINI_API_KEYS, DAILY_LIMIT, UNLIMITED_IDS } from './config.js';

const FILE = path.join(DATA_DIR, 'settings.json');
let cache = null; let cacheMtime = -1;
const listeners = new Set();

function read() {
  let mtime = 0;
  try { mtime = fs.statSync(FILE).mtimeMs; } catch { /* no file yet */ }
  if (cache && mtime === cacheMtime) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { cache = {}; }
  cacheMtime = mtime;
  return cache;
}

function write(next) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(next, null, 1), { mode: 0o600 });
  fs.renameSync(`${FILE}.tmp`, FILE);
  cache = next; cacheMtime = fs.statSync(FILE).mtimeMs;
  for (const fn of listeners) { try { fn(); } catch { /* ignore */ } }
}

/** Called after every change (e.g. the answer cache is emptied when the guidance changes). */
export const onChange = (fn) => listeners.add(fn);

// ─── Gemini keys ─────────────────────────────────────────────────────────────
/** Keys in use, in order: the admin page list if it was ever edited, else the cPanel ones. */
export function geminiKeys() {
  const s = read();
  return Array.isArray(s.geminiKeys) && s.geminiKeys.length ? s.geminiKeys : GEMINI_API_KEYS;
}
export const keysFromAdmin = () => Array.isArray(read().geminiKeys) && read().geminiKeys.length > 0;

export function addGeminiKey(key) {
  key = String(key || '').trim();
  if (!/^[\w.-]{20,200}$/.test(key)) throw new Error('Cette clé n\'a pas le bon format.');
  const keys = geminiKeys();
  if (keys.includes(key)) throw new Error('Cette clé est déjà dans la liste.');
  write({ ...read(), geminiKeys: [...keys, key] });
}
export function removeGeminiKey(index) {
  const keys = [...geminiKeys()];
  if (keys.length <= 1) throw new Error('Il faut garder au moins une clé.');
  keys.splice(index, 1);
  write({ ...read(), geminiKeys: keys });
}
export function moveGeminiKey(index, delta) {
  const keys = [...geminiKeys()]; const j = index + delta;
  if (j < 0 || j >= keys.length) return;
  [keys[index], keys[j]] = [keys[j], keys[index]];
  write({ ...read(), geminiKeys: keys });
}

// ─── limits ──────────────────────────────────────────────────────────────────
export function dailyLimit() {
  const v = read().dailyLimit;
  return Number.isInteger(v) && v >= 0 ? v : DAILY_LIMIT;
}
export function unlimitedIds() {
  const v = read().unlimitedIds;
  return new Set(Array.isArray(v) ? v.map(String) : [...UNLIMITED_IDS]);
}
export function setLimits(limit, ids) {
  const n = Number(limit);
  if (!Number.isInteger(n) || n < 0 || n > 1000) throw new Error('La limite doit être un nombre entre 0 et 1000 (0 = sans limite).');
  const list = String(ids || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  if (list.some((x) => !/^-?\d{3,20}$/.test(x))) throw new Error('Les identifiants Telegram sont des nombres, séparés par des virgules.');
  write({ ...read(), dailyLimit: n, unlimitedIds: [...new Set(list)] });
}

// ─── guidance for the bot (instructions and teachings) ─────────────────────────
// type 'consigne' = how LAMP should behave ; 'enseignement' = something LAMP should know and pass on
export const guidance = () => (Array.isArray(read().guidance) ? read().guidance : []);
export function addGuidance(type, text) {
  text = String(text || '').trim();
  if (!['consigne', 'enseignement'].includes(type)) throw new Error('Type inconnu.');
  if (text.length < 3 || text.length > 2000) throw new Error('Le texte doit faire entre 3 et 2000 caractères.');
  const item = { id: crypto.randomBytes(6).toString('hex'), type, text, active: true, created: new Date().toISOString() };
  write({ ...read(), guidance: [...guidance(), item] });
}
export function editGuidance(id, text) {
  text = String(text || '').trim();
  if (text.length < 3 || text.length > 2000) throw new Error('Le texte doit faire entre 3 et 2000 caractères.');
  write({ ...read(), guidance: guidance().map((g) => (g.id === id ? { ...g, text, edited: new Date().toISOString() } : g)) });
}
export function toggleGuidance(id) {
  write({ ...read(), guidance: guidance().map((g) => (g.id === id ? { ...g, active: !g.active } : g)) });
}
export function deleteGuidance(id) {
  write({ ...read(), guidance: guidance().filter((g) => g.id !== id) });
}
