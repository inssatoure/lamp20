import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs } from 'firebase/firestore/lite';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = initializeApp({
  apiKey: "AIzaSyAWcGI0OZsHPh-IhglG_4MI9ZcQkkmUKw0",
  authDomain: "lampridial-19466.firebaseapp.com",
  projectId: "lampridial-19466",
});

const db = getFirestore(app);
const dir = join(__dirname, '..', 'Textes_Arabes_Serigne_Touba');
const files = readdirSync(dir).filter(f => f.endsWith('.txt')).sort();

console.log(`Found ${files.length} files.\n`);

// Check existing
let existingTitles = new Set();
try {
  const snap = await getDocs(collection(db, 'knowledge_base'));
  snap.forEach(d => existingTitles.add(d.data().title));
  console.log(`${existingTitles.size} already in Firestore.\n`);
} catch (e) {
  console.log(`Could not check existing: ${e.message}\n`);
}

let ok = 0, skip = 0, errors = 0;

for (const file of files) {
  const title = file.replace('.txt', '').split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

  if (existingTitles.has(title)) {
    console.log(`SKIP: ${title}`);
    skip++;
    continue;
  }

  const text = readFileSync(join(dir, file), 'utf-8').trim();
  if (!text) { skip++; continue; }

  try {
    await addDoc(collection(db, 'knowledge_base'), {
      title,
      content: text,
      arabicText: text,
      category: 'Khassaid',
      sourceRef: `Khassaid - ${title} - Cheikh Ahmadou Bamba`,
      language: 'ar',
      addedAt: Date.now(),
      addedBy: 'bulk_import',
    });
    ok++;
    console.log(`OK: ${title} (${text.length} chars)`);
  } catch (e) {
    errors++;
    console.log(`ERR: ${title} — ${e.message}`);
  }
}

console.log(`\n=== DONE: ${ok} imported, ${skip} skipped, ${errors} errors ===`);
process.exit(0);
