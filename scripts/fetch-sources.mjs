// Downloads the trusted Coran + hadith texts used by the LAMP bot into ./sources
// Run once on the server (and again only to update):  node scripts/fetch-sources.mjs
//   Coran  : api.alquran.cloud — texte uthmani + traduction Muhammad Hamidullah
//   Hadiths: github.com/fawazahmed0/hadith-api — traductions françaises
import fs from 'fs';
import path from 'path';

const ROOT = process.env.LAMP_ROOT_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'sources');
fs.mkdirSync(OUT, { recursive: true });

const FILES = {
  'quran-uthmani.json': 'https://api.alquran.cloud/v1/quran/quran-uthmani',
  'fr.hamidullah.json': 'https://api.alquran.cloud/v1/quran/fr.hamidullah',
  ...Object.fromEntries(['bukhari', 'muslim', 'abudawud', 'malik', 'nawawi'].map((c) =>
    [`fra-${c}.json`, `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/fra-${c}.min.json`])),
};

let failed = 0;
for (const [name, url] of Object.entries(FILES)) {
  const dest = path.join(OUT, name);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    JSON.parse(text);                       // never keep a broken file
    fs.writeFileSync(dest, text);
    console.log(`✅ ${name} (${(text.length / 1e6).toFixed(1)} Mo)`);
  } catch (e) {
    failed++;
    console.error(`❌ ${name}: ${e.message}${fs.existsSync(dest) ? ' (ancienne version conservée)' : ''}`);
  }
}
console.log(failed ? `${failed} fichier(s) en échec` : `Sources prêtes dans ${OUT}`);
process.exit(failed ? 1 : 0);
