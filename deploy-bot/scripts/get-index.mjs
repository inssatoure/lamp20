// Downloads the Khassaid meaning index (same as get-index.sh, without curl): pieces from the
// "index-data" branch, checksum verified, unzipped to the path given (default: ./versets_cache.jsonl).
//   node deploy-bot/scripts/get-index.mjs [/data/versets_cache.jsonl]
import fs from 'fs';
import crypto from 'crypto';
import zlib from 'zlib';

const BASE = process.env.LAMP_INDEX_URL || 'https://raw.githubusercontent.com/inssatoure/lamp20/index-data';
const OUT = process.argv[2] || 'versets_cache.jsonl';
const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return Buffer.from(await r.arrayBuffer()); };

const expected = (await get(`${BASE}/SHA256`)).toString().split(/\s+/)[0];
const parts = [];
for (let i = 0; i < 100; i++) {
  const r = await fetch(`${BASE}/versets_cache.jsonl.gz.part${String(i).padStart(2, '0')}`);
  if (!r.ok) break;
  parts.push(Buffer.from(await r.arrayBuffer()));
}
const gz = Buffer.concat(parts);
const sum = crypto.createHash('sha256').update(gz).digest('hex');
if (sum !== expected) { console.error('Téléchargement abîmé (somme de contrôle) : réessaie.'); process.exit(1); }
fs.writeFileSync(`${OUT}.tmp`, zlib.gunzipSync(gz));
fs.renameSync(`${OUT}.tmp`, OUT);
console.log(`Index installé : ${OUT} (${parts.length} morceaux, ${fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).length} distiques)`);
