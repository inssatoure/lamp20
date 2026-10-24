// LAMP AI — daily numbers for the admin page: questions, answers, AI calls and tokens, checks, errors.
// Kept in DATA_DIR/stats.json (last 60 days), written at most every few seconds.
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';

const FILE = path.join(DATA_DIR, 'stats.json');
const KEEP_DAYS = 60;
const MAX_ERRORS = 40;
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dakar' });

let state;
try { state = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { state = {}; }
state.days ||= {}; state.errors ||= [];

const emptyDay = () => ({
  questions: 0, voice: 0, answered: 0, busy: 0, limited: 0, withoutAI: 0,
  ai: { gemini: { calls: 0, in: 0, out: 0 }, groq: { calls: 0, in: 0, out: 0 }, cerebras: { calls: 0, in: 0, out: 0 } },
  models: {}, checks: {}, people: [],
});
function day() {
  const d = today();
  if (!state.days[d]) {
    state.days[d] = emptyDay();
    for (const old of Object.keys(state.days).sort().slice(0, -KEEP_DAYS)) delete state.days[old];
  }
  return state.days[d];
}

let timer = null;
function save() {
  if (timer) return;
  timer = setTimeout(flush, 3000);
  timer.unref?.();
}
export function flush() {
  clearTimeout(timer); timer = null;
  readCounters();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(state));
    fs.renameSync(`${FILE}.tmp`, FILE);
  } catch (e) { console.warn('[Stats] not saved:', e.message); }
}
process.on('exit', () => { try { flush(); } catch { /* ignore */ } });

// ─── the answer checks (counters live in brain.js; registered by app.js to avoid an import loop) ──
let counters = null; let lastSeen = {};
export function watchCounters(fn) { counters = fn; lastSeen = { ...fn() }; }
function readCounters() {
  if (!counters) return;
  const now = counters(); const d = day();
  for (const [k, v] of Object.entries(now)) {
    const delta = (v || 0) - (lastSeen[k] || 0);
    if (delta > 0) d.checks[k] = (d.checks[k] || 0) + delta;
  }
  lastSeen = { ...now };
}

// ─── events ──────────────────────────────────────────────────────────────────
export function question(chatId, { voice = false } = {}) {
  const d = day(); d.questions++; if (voice) d.voice++;
  const id = String(chatId); if (!d.people.includes(id)) d.people.push(id);
  save();
}
export function answered(model) {
  const d = day(); d.answered++;
  if (!model) d.withoutAI++; else d.models[model] = (d.models[model] || 0) + 1;
  save();
}
export function busy() { day().busy++; save(); }
export function limited() { day().limited++; save(); }
export function tokens(who, input = 0, output = 0) {
  const a = day().ai[who] ||= { calls: 0, in: 0, out: 0 };
  a.calls++; a.in += input || 0; a.out += output || 0;
  save();
}
export function error(where, message) {
  state.errors.unshift({ at: new Date().toISOString(), where, message: String(message || '').slice(0, 300) });
  state.errors.length = Math.min(state.errors.length, MAX_ERRORS);
  save();
}

/** For the admin page: the last n days (newest first) and the recent errors. */
export function report(n = 7) {
  readCounters();
  day();
  const days = Object.keys(state.days).sort().reverse().slice(0, n).map((d) => ({ day: d, ...state.days[d] }));
  return { days, errors: state.errors };
}
