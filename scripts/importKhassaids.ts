/**
 * Bulk Import Script: Loads all 122 Khassaid .txt files into Firestore knowledge_base.
 *
 * Run with: npx tsx scripts/importKhassaids.ts
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const firebaseConfig = {
  apiKey: "AIzaSyAWcGI0OZsHPh-IhglG_4MI9ZcQkkmUKw0",
  authDomain: "lampridial-19466.firebaseapp.com",
  projectId: "lampridial-19466",
  storageBucket: "lampridial-19466.firebasestorage.app",
  messagingSenderId: "76433392810",
  appId: "1:76433392810:web:92cac9a34da732f779bcd3",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Known Khassaid name mappings (filename -> proper title)
const TITLE_MAP: Record<string, string> = {
  'mafatihul_bishri': 'Mafatihul Bishri (مفاتح البشر)',
  'mafatihul_jinan': 'Mafatihul Jinan (مفاتح الجنان)',
  'anta_rabbi': 'Anta Rabbi (أنت ربي)',
  'asma_ul_husna': 'Asma ul Husna (أسماء الله الحسنى)',
  'jalibatul_maraghibi': 'Jalibatul Maraghibi (جالبة المراغب)',
  'ahazanil_baaqi': 'Ahazanil Baaqi',
  'asiru': 'Asiru',
  'bushra_lana': 'Bushra Lana (بشرى لنا)',
  'bakh_bakhaa': 'Bakh Bakhaa',
  'barakatu': 'Barakatu (بركات)',
  'farrij': 'Farrij (فرج)',
  'fuzti': 'Fuzti',
  'ashkuru_laaha': 'Ashkuru Laaha',
  'ashinu': 'Ashinu',
  'ayyasa': 'Ayyasa',
  'bihaqqi': 'Bihaqqi',
  'ahyaytu_mawlidan': 'Ahyaytu Mawlidan',
  'alhamdu_yujaazi': 'Alhamdu Yujaazi',
  'allaahu_hayyun_samadun': 'Allaahu Hayyun Samadun',
};

function filenameToTitle(filename: string): string {
  const base = filename.replace('.txt', '');
  if (TITLE_MAP[base]) return TITLE_MAP[base];

  // Convert snake_case to Title Case
  return base
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function filenameToRef(filename: string): string {
  const title = filenameToTitle(filename);
  return `Khassaid - ${title} - Cheikh Ahmadou Bamba`;
}

async function checkExisting(title: string): Promise<boolean> {
  try {
    const q = query(
      collection(db, 'knowledge_base'),
      where('title', '==', title)
    );
    const snap = await getDocs(q);
    return !snap.empty;
  } catch {
    return false;
  }
}

async function importAll() {
  const dir = path.join(__dirname, '..', 'Textes_Arabes_Serigne_Touba');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.txt')).sort();

  console.log(`Found ${files.length} Khassaid files to import.\n`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    const title = filenameToTitle(file);
    const sourceRef = filenameToRef(file);
    const filePath = path.join(dir, file);
    const arabicText = fs.readFileSync(filePath, 'utf-8').trim();

    if (!arabicText) {
      console.log(`  SKIP (empty): ${file}`);
      skipped++;
      continue;
    }

    // Check if already imported
    const exists = await checkExisting(title);
    if (exists) {
      console.log(`  SKIP (exists): ${title}`);
      skipped++;
      continue;
    }

    try {
      await addDoc(collection(db, 'knowledge_base'), {
        title,
        content: arabicText,
        arabicText,
        category: 'Khassaid',
        sourceRef,
        language: 'ar',
        addedAt: Date.now(),
        addedBy: 'bulk_import',
      });
      console.log(`  OK: ${title} (${arabicText.length} chars)`);
      imported++;
    } catch (err: any) {
      console.error(`  ERROR: ${title} - ${err.message}`);
      errors++;
    }
  }

  console.log(`\n=== IMPORT COMPLETE ===`);
  console.log(`Imported: ${imported}`);
  console.log(`Skipped:  ${skipped}`);
  console.log(`Errors:   ${errors}`);
  console.log(`Total:    ${files.length}`);

  process.exit(0);
}

importAll().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
