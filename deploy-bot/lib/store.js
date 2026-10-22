// LAMP AI — durable storage of every user: profile, long-term memory, all messages.
//
// Two backends, same functions:
//  • Firestore (if FIREBASE_SERVICE_ACCOUNT is set): survives any redeploy, readable from the
//    Firebase console. Uses the Admin SDK, so the data can stay closed to the public.
//  • Local files (default): one JSON file per user in DATA_DIR. On Railway, put DATA_DIR on a volume.
import fs from 'fs';
import path from 'path';
import { DATA_DIR, FIREBASE_SERVICE_ACCOUNT } from './config.js';

const MAX_LOCAL_MESSAGES = 2000;   // per user file (older ones are dropped)

// ─── Firestore (Admin SDK) ───────────────────────────────────────────────────
let fsdb = null;
if (FIREBASE_SERVICE_ACCOUNT) {
  try {
    const { initializeApp, cert } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const raw = FIREBASE_SERVICE_ACCOUNT.trim().startsWith('{')
      ? FIREBASE_SERVICE_ACCOUNT : fs.readFileSync(FIREBASE_SERVICE_ACCOUNT, 'utf8');
    fsdb = getFirestore(initializeApp({ credential: cert(JSON.parse(raw)) }, 'lamp-store'));
    console.log('[Store] Firestore (lamp_users)');
  } catch (e) {
    console.warn('[Store] Firestore unavailable, using local files:', e.message);
  }
}
if (!fsdb) {
  fs.mkdirSync(path.join(DATA_DIR, 'users'), { recursive: true });
  console.log(`[Store] local files: ${path.join(DATA_DIR, 'users')}`);
}
export const backend = fsdb ? 'firestore' : 'files';

const fileOf = (id) => path.join(DATA_DIR, 'users', `${String(id).replace(/[^\w-]/g, '_')}.json`);
function readLocal(id) {
  try { return JSON.parse(fs.readFileSync(fileOf(id), 'utf8')); } catch { return null; }
}
function writeLocal(id, data) {
  const f = fileOf(id);
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(data));
  fs.renameSync(`${f}.tmp`, f);        // atomic
}
const emptyUser = (id) => ({ id: String(id), profile: {}, memory: '', memory_at: null, messages: [] });

/** { profile, memory, memory_at, recent: last n messages } */
export async function loadUser(id, n = 20) {
  if (fsdb) {
    const ref = fsdb.collection('lamp_users').doc(String(id));
    const [doc, msgs] = await Promise.all([ref.get(), ref.collection('messages').orderBy('ts', 'desc').limit(n).get()]);
    const d = doc.exists ? doc.data() : {};
    return { profile: d.profile || {}, memory: d.memory || '', memory_at: d.memory_at || null,
      recent: msgs.docs.map((m) => m.data()).reverse() };
  }
  const u = readLocal(id) || emptyUser(id);
  return { profile: u.profile, memory: u.memory, memory_at: u.memory_at, recent: u.messages.slice(-n) };
}

/** messages: [{ ts, role: 'user'|'model', text, session, voice? }] ; profile: fields to merge */
export async function saveMessages(id, profile, messages) {
  if (fsdb) {
    const ref = fsdb.collection('lamp_users').doc(String(id));
    const batch = fsdb.batch();
    batch.set(ref, { profile, updated: new Date().toISOString() }, { merge: true });
    for (const m of messages) batch.set(ref.collection('messages').doc(), m);
    await batch.commit();
    return;
  }
  const u = readLocal(id) || emptyUser(id);
  u.profile = { ...u.profile, ...profile };
  u.messages = u.messages.concat(messages).slice(-MAX_LOCAL_MESSAGES);
  writeLocal(id, u);
}

export async function saveMemory(id, memory) {
  const memory_at = new Date().toISOString();
  if (fsdb) return fsdb.collection('lamp_users').doc(String(id)).set({ memory, memory_at }, { merge: true });
  const u = readLocal(id) || emptyUser(id);
  Object.assign(u, { memory, memory_at });
  writeLocal(id, u);
}

/** Deletes everything about a user (/oublie). */
export async function deleteUser(id) {
  if (fsdb) {
    const ref = fsdb.collection('lamp_users').doc(String(id));
    await fsdb.recursiveDelete(ref);
    return;
  }
  fs.rmSync(fileOf(id), { force: true });
}

// ─── for the admin page ──────────────────────────────────────────────────────
export async function listUsers() {
  if (fsdb) {
    const snap = await fsdb.collection('lamp_users').orderBy('updated', 'desc').limit(500).get();
    return snap.docs.map((d) => ({ id: d.id, profile: d.data().profile || {}, memory: d.data().memory || '' }));
  }
  const dir = path.join(DATA_DIR, 'users');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => readLocal(f.slice(0, -5))).filter(Boolean)
    .map((u) => ({ id: u.id, profile: u.profile, memory: u.memory }))
    .sort((a, b) => String(b.profile.last_seen || '').localeCompare(String(a.profile.last_seen || '')));
}

export async function getMessages(id, n = 500) {
  if (fsdb) {
    const snap = await fsdb.collection('lamp_users').doc(String(id)).collection('messages').orderBy('ts', 'desc').limit(n).get();
    return snap.docs.map((m) => m.data()).reverse();
  }
  return (readLocal(id)?.messages || []).slice(-n);
}
