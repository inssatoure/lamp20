// LAMP AI — conversation memory per chat (saved to disk) + interaction log
import fs from 'fs';
import { HISTORY_FILE, CHAT_LOG_FILE, HISTORY_MAX } from './config.js';

const chats = new Map();   // chatId -> [{ role: 'user'|'model', text }]

try {
  if (fs.existsSync(HISTORY_FILE)) {
    for (const [id, h] of Object.entries(JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')))) {
      // old format { role, parts:[{text}] } → { role, text }
      chats.set(id, h.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text ?? m.parts?.[0]?.text ?? '' })).filter((m) => m.text));
    }
    console.log(`[History] ${chats.size} conversations loaded`);
  }
} catch (e) {
  console.warn('[History] could not load (starting empty):', e.message);
}

let timer = null;
function save() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      const tmp = `${HISTORY_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(chats)));
      fs.renameSync(tmp, HISTORY_FILE);       // atomic: never leaves a half-written file
    } catch (e) {
      console.warn('[History] could not save:', e.message);
    }
  }, 3000);
}

export const getHistory = (chatId) => chats.get(String(chatId)) || [];

export function addExchange(chatId, userText, botText) {
  const h = getHistory(chatId).concat([{ role: 'user', text: userText }, { role: 'model', text: botText }]);
  chats.set(String(chatId), h.slice(-HISTORY_MAX));
  save();
}

export function clearHistory(chatId) {
  chats.delete(String(chatId));
  save();
}

export const activeChats = () => chats.size;

export function logInteraction(chatId, username, userText, botText, extra = {}) {
  try {
    fs.appendFileSync(CHAT_LOG_FILE, JSON.stringify({
      ts: new Date().toISOString(), chatId, username: username || 'unknown', user: userText, bot: botText, ...extra,
    }) + '\n');
  } catch (e) {
    console.warn('[Log] could not write:', e.message);
  }
}
