// LAMP AI — conversation memory per user.
//  • every message is saved for good (lib/store.js), so nothing is lost on restart or redeploy;
//  • a "session" is one conversation: a new one starts after 6 h of silence or with /clear;
//  • a short long-term memory (who the person is, what was discussed) is rewritten every few
//    exchanges and given to the model, so the bot remembers people days later.
import fs from 'fs';
import { HISTORY_FILE, HISTORY_MAX } from './config.js';
import * as store from './store.js';
import { updateMemory as rewriteMemory } from './brain.js';

const SESSION_GAP_MS = 6 * 3600_000;
const MEMORY_EVERY = 2;                     // exchanges between two memory updates

const cache = new Map();                   // chatId -> { profile, memory, session: [{role,text}], sinceMemory }

// One-time import of the old chat_histories.json (local backend only)
let legacy = {};
try {
  if (store.backend === 'files' && fs.existsSync(HISTORY_FILE)) legacy = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
} catch { legacy = {}; }

async function load(chatId) {
  const id = String(chatId);
  if (cache.has(id)) return cache.get(id);
  let u;
  try {
    u = await store.loadUser(id, HISTORY_MAX);
  } catch (e) {
    console.warn('[History] could not load user:', e.message);
    u = { profile: {}, memory: '', recent: [] };
  }
  if (!u.recent.length && legacy[id]) {            // old format → keep it as the current session
    const old = legacy[id].map((m) => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text ?? m.parts?.[0]?.text ?? '' })).filter((m) => m.text);
    const ts = new Date().toISOString();
    u.recent = old.map((m) => ({ ...m, ts, session: 1 }));
    await store.saveMessages(id, { session: 1 }, u.recent).catch(() => {});
  }
  const session = u.profile.session || 1;
  const entry = {
    profile: u.profile,
    memory: u.memory || '',
    session: u.recent.filter((m) => (m.session || 1) === session).map(({ role, text }) => ({ role, text })),
    sinceMemory: u.profile.pending || 0,      // exchanges not yet written into the memory (kept across restarts)
  };
  cache.set(id, entry);
  return entry;
}

/**
 * Everything the bot needs to answer this person:
 * { history: current session messages, memory: long-term notes, name, pauseDays }
 */
export async function getContext(chatId) {
  const u = await load(chatId);
  const last = u.profile.last_seen ? Date.parse(u.profile.last_seen) : 0;
  if (last && Date.now() - last > SESSION_GAP_MS && u.session.length) {
    // silence for a while: start a new session — first make sure the memory has the end of the last one
    if (u.sinceMemory > 0) await refreshMemory(String(chatId), u);
    u.profile.session = (u.profile.session || 1) + 1;
    u.session = [];
  }
  return {
    history: u.session.slice(-HISTORY_MAX),
    memory: u.memory,
    name: u.profile.name || '',
    pauseDays: last ? Math.floor((Date.now() - last) / 86400_000) : null,
    returning: !!last,
  };
}

/** Saves one question/answer and keeps the long-term memory up to date. */
export async function addExchange(chatId, from, userText, botText, extra = {}) {
  const id = String(chatId);
  const u = await load(id);
  const now = new Date().toISOString();
  const session = u.profile.session || 1;
  Object.assign(u.profile, {
    name: [from?.first_name, from?.last_name].filter(Boolean).join(' ') || u.profile.name || '',
    username: from?.username || u.profile.username || '',
    lang: extra.lang || u.profile.lang || '',
    first_seen: u.profile.first_seen || now,
    last_seen: now,
    count: (u.profile.count || 0) + 1,
    session,
  });
  u.session.push({ role: 'user', text: userText }, { role: 'model', text: botText });
  u.session = u.session.slice(-HISTORY_MAX);
  u.sinceMemory++;
  u.profile.pending = u.sinceMemory;      // saved with the messages: a restart still knows what to summarise
  try {
    await store.saveMessages(id, u.profile, [
      { ts: now, role: 'user', text: userText, session, ...(extra.voice ? { voice: true } : {}) },
      { ts: now, role: 'model', text: botText, session },
    ]);
  } catch (e) {
    console.warn('[History] could not save:', e.message);
  }
  if (u.sinceMemory >= MEMORY_EVERY || !u.memory) refreshMemory(id, u).catch(() => {});
}

async function refreshMemory(id, u) {
  const n = u.sinceMemory;
  try {
    const m = await rewriteMemory(u.memory, u.session.slice(-2 * Math.max(n, MEMORY_EVERY) - 2), u.profile.name);
    if (!m) { console.warn('[Memory] empty rewrite, kept the old memory'); return; }
    u.memory = m;
    u.sinceMemory = Math.max(0, u.sinceMemory - n);
    u.profile.pending = u.sinceMemory;
    await store.saveMemory(id, m);
    await store.saveMessages(id, { pending: u.profile.pending }, []);
  } catch (e) {
    console.warn('[Memory] update failed:', e.message);
  }
}

/** /clear: new conversation, the long-term memory stays. */
export async function newSession(chatId) {
  const u = await load(chatId);
  if (u.sinceMemory > 0) await refreshMemory(String(chatId), u);
  u.profile.session = (u.profile.session || 1) + 1;
  u.session = [];
  await store.saveMessages(String(chatId), { session: u.profile.session }, []).catch(() => {});
}

/** /oublie: deletes everything about this person. */
export async function forgetUser(chatId) {
  cache.delete(String(chatId));
  delete legacy[String(chatId)];
  await store.deleteUser(String(chatId));
}

export const activeChats = () => cache.size;
