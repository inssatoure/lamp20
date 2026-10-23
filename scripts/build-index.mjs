// Builds versets_cache.jsonl (meaning search over every Khassaid distique) from the local
// Textes_Arabes_Serigne_Touba/ files — so search results always show the same text and numbering
// as the library. Run after any change to the texts:   GEMINI_API_KEY=... node scripts/build-index.mjs
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { GoogleGenAI } from '@google/genai';

const ROOT = process.env.LAMP_ROOT_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = path.join(ROOT, 'Textes_Arabes_Serigne_Touba');
const OUT = path.join(ROOT, 'versets_cache.jsonl');
const MODEL = 'gemini-embedding-001';
const BATCH = 50;

// one key or several (GEMINI_API_KEYS=k1,k2): on a quota error the next key is used
const KEYS = `${process.env.GEMINI_API_KEYS || ''},${process.env.GEMINI_API_KEY || ''}`.split(',').map((k) => k.trim()).filter(Boolean);
if (!KEYS.length) { console.error('GEMINI_API_KEY manquant'); process.exit(1); }
const clients = KEYS.map((apiKey) => new GoogleGenAI({ apiKey }));
let current = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const title = (stem) => stem.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const items = [];
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.txt')).sort()) {
  const lines = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.length > 5 || l === '*');
  const t = title(f.replace(/\.txt$/, ''));
  for (let i = 0, n = 1; i + 1 < lines.length; i += 2, n++) {
    const body = lines[i + 1] === '*' ? lines[i] : `${lines[i]}\n${lines[i + 1]}`;
    items.push({ t, n, c: `[Khassaid: ${t} | Distique N°${n}]\n${body}` });
  }
}
// Reuse the vectors already computed for the same text (old index, or an interrupted run):
// only new or corrected distiques cost an API call, so a rebuild fits in the free daily quota.
const body = (c) => c.slice(c.indexOf(']') + 1).trim();
const known = new Map();
for (const f of [OUT, `${OUT}.tmp`]) {
  if (!fs.existsSync(f)) continue;
  for await (const line of readline.createInterface({ input: fs.createReadStream(f) })) {
    try { const x = JSON.parse(line); if (x.c && x.e?.length) known.set(body(x.c), x.e); } catch { /* partial last line */ }   // empty vectors are recomputed
  }
}
const todo = items.filter((x) => !known.has(body(x.c)));
console.log(`${items.length} distiques, ${items.length - todo.length} déjà calculés, ${todo.length} à indexer`);

const tmp = `${OUT}.tmp`;
const out = fs.createWriteStream(`${OUT}.new`);
const part = fs.createWriteStream(tmp, { flags: 'a' });   // keeps progress if the quota stops us
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await clients[current].models.embedContent({ model: MODEL, contents: batch.map((x) => x.c) });
      r.embeddings.forEach((e, j) => { known.set(body(batch[j].c), e.values); part.write(JSON.stringify({ ...batch[j], e: e.values }) + '\n'); });
      break;
    } catch (e) {
      if (attempt >= 12) throw e;
      const msg = String(e.message);
      current = (current + 1) % clients.length;                 // try the next key
      const wait = current === 0 ? 30000 : 1000;                // every key tried: let the per-minute quota reset
      console.warn(`\nlot ${i}: ${msg.slice(0, 60)} → clé ${current + 1}, attente ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  process.stdout.write(`\r${Math.min(i + BATCH, todo.length)}/${todo.length}`);
}
const missing = items.filter((x) => !known.get(body(x.c))?.length);
if (missing.length) { console.error(`\n${missing.length} distiques sans vecteur — index non remplacé`); process.exit(1); }
for (const x of items) out.write(JSON.stringify({ ...x, e: known.get(body(x.c)) }) + '\n');
await new Promise((r) => out.end(r));
await new Promise((r) => part.end(r));
fs.renameSync(`${OUT}.new`, OUT);       // the old index is replaced only when the new one is complete
fs.rmSync(tmp, { force: true });
console.log(`\n✅ ${OUT}`);
