// LAMP AI — daily limit of questions per person (protects the AI credits).
// Counted when a question arrives, before any AI call; given back if the bot could not answer.
// Kept in a small file in DATA_DIR, so a restart of the app does not reset it. New day = midnight in Dakar.
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';
import { dailyLimit, unlimitedIds } from './settings.js';   // set on the admin page (else cPanel variables)

const FILE = path.join(DATA_DIR, 'quota.json');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dakar' });   // YYYY-MM-DD

let state = null;
function load() {
  if (!state) { try { state = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { state = {}; } }
  if (state.day !== today()) state = { day: today(), counts: {} };
  return state;
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(state));
    fs.renameSync(`${FILE}.tmp`, FILE);
  } catch (e) { console.warn('[Quota] not saved:', e.message); }
}

export const unlimited = (id) => !dailyLimit() || unlimitedIds().has(String(id));

/** Takes one question from today's allowance. false = limit reached (nothing taken). */
export function take(id) {
  if (unlimited(id)) return true;
  const s = load(); const k = String(id);
  if ((s.counts[k] || 0) >= dailyLimit()) return false;
  s.counts[k] = (s.counts[k] || 0) + 1;
  save();
  return true;
}

/** Gives the question back (the bot could not answer it). */
export function giveBack(id) {
  if (unlimited(id)) return;
  const s = load(); const k = String(id);
  if (s.counts[k] > 0) { s.counts[k] -= 1; save(); }
}

/** Questions used today (for the admin page). */
export function usedToday(id) { return load().counts[String(id)] || 0; }

export const limitMsg = (lang) => {
  const DAILY_LIMIT = dailyLimit();
  const m = {
  fr: `Tu as atteint la limite de ${DAILY_LIMIT} questions pour aujourd'hui. Reviens demain, inch'Allah : le compteur repart à zéro à minuit (heure de Dakar). Jërëjëf 🤍`,
  wo: `Jot nga ci ${DAILY_LIMIT} laaj yi nga mën a laaj tey. Ñëwaatal ëllëg, inch'Allah : ci xaaju guddi (waxtu Dakar) lay tàmbaliwaat. Jërëjëf 🤍`,
  en: `You have reached today's limit of ${DAILY_LIMIT} questions. Please come back tomorrow, inch'Allah: the counter resets at midnight (Dakar time). Thank you 🤍`,
  };
  return m[lang] || m.fr;
};
