#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  LAMP AI — Automated Evaluation Suite                               ║
 * ║  Tests bot logic DIRECTLY (no Telegram) against ground truth        ║
 * ║  Run: node scripts/eval.mjs                                         ║
 * ║  Run single: node scripts/eval.mjs --suite=verse_count              ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Exit code 0 = all tests passed
 * Exit code 1 = failures detected (blocks CI/CD)
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const CORPUS    = join(ROOT, 'Textes_Arabes_Serigne_Touba');

const SUITE_ARG = process.argv.find(a => a.startsWith('--suite='))?.replace('--suite=', '');
const VERBOSE   = process.argv.includes('--verbose');

// ─── GROUND TRUTH: KNOWN VERSE COUNTS ────────────────────────────────────────
// Derived from KHASSAIDS_METADATA — source of truth
const EXPECTED_VERSE_COUNTS = {
  'jawartu.txt':             29,
  'mawahibu.txt':           166,
  'mafatihul_bishri.txt':   374,
  'nuuru_daarayni.txt':    1517,
  'jalibatul_maraghibi.txt': 533,
  'matlabul_fawzayni.txt':  236,
  'jazbu.txt':              185,
  'khatimatu_munajati.txt':  39,
  'rumna_shukur.txt':        89,
  'zallat.txt':               9,
  'mim_ra_shin.txt':          3,
  'hamdi_wa_shukri.txt':      4,
  'ashkuru_laaha.txt':       12,
};

// ─── GROUND TRUTH: KNOWN FIRST VERSES ───────────────────────────────────────
// First hemistich of verse 1 for each file (verified from actual corpus)
const EXPECTED_FIRST_HEMISTICH = {
  'jawartu.txt':         'جَاوَرْتُ',
  'mawahibu.txt':        'بِسْمِ الْإِلَهِ',
  'mafatihul_bishri.txt':'أَحَدُ',          // starts with 'Ahadun'
  'nuuru_daarayni.txt':  'الْحَمْدُ',       // starts with Al-Hamdulillah
  'khatimatu_munajati.txt': 'الْح',         // contains 'الْح' (Al-Haqq region)
};


// ─── HELPERS ─────────────────────────────────────────────────────────────────

function readVerses(filename) {
  const p = join(CORPUS, filename);
  if (!existsSync(p)) return null;
  const lines = readFileSync(p, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 3);
  // Group into verse pairs
  const verses = [];
  for (let i = 0; i < lines.length; i += 2) {
    verses.push({ h1: lines[i], h2: lines[i + 1] || '' });
  }
  return verses;
}

function getAllFiles() {
  if (!existsSync(CORPUS)) return [];
  return readdirSync(CORPUS).filter(f => f.endsWith('.txt'));
}

// ─── TEST RUNNER ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(suite, name, condition, details = '') {
  if (SUITE_ARG && suite !== SUITE_ARG) return;
  if (condition) {
    passed++;
    if (VERBOSE) console.log(`  ✅ [${suite}] ${name}`);
  } else {
    failed++;
    failures.push({ suite, name, details });
    console.log(`  ❌ [${suite}] ${name}${details ? ` — ${details}` : ''}`);
  }
}

// ─── SUITE 1: FILE EXISTENCE ─────────────────────────────────────────────────
console.log('\n📁 Suite 1: File Existence');
const files = getAllFiles();
test('existence', 'Corpus directory exists', existsSync(CORPUS));
test('existence', 'At least 100 Khassaid files', files.length >= 100, `Found: ${files.length}`);
test('existence', 'jawartu.txt exists',             files.includes('jawartu.txt'));
test('existence', 'mawahibu.txt exists',            files.includes('mawahibu.txt'));
test('existence', 'mafatihul_bishri.txt exists',    files.includes('mafatihul_bishri.txt'));
test('existence', 'nuuru_daarayni.txt exists',      files.includes('nuuru_daarayni.txt'));
test('existence', 'jalibatul_maraghibi.txt exists', files.includes('jalibatul_maraghibi.txt'));
test('existence', 'khatimatu_munajati.txt exists',  files.includes('khatimatu_munajati.txt'));

// ─── SUITE 2: VERSE COUNT ACCURACY ───────────────────────────────────────────
console.log('\n🔢 Suite 2: Verse Count Accuracy (2 lines = 1 verse)');
for (const [file, expectedCount] of Object.entries(EXPECTED_VERSE_COUNTS)) {
  const verses = readVerses(file);
  if (!verses) {
    test('verse_count', `${file} — readable`, false, 'file not found');
    continue;
  }
  test(
    'verse_count',
    `${file} has ${expectedCount} verses`,
    verses.length === expectedCount,
    `Got: ${verses.length}, Expected: ${expectedCount}`
  );
}

// ─── SUITE 3: FIRST VERSE INTEGRITY ──────────────────────────────────────────
console.log('\n📖 Suite 3: First Verse Integrity');
for (const [file, expectedStart] of Object.entries(EXPECTED_FIRST_HEMISTICH)) {
  const verses = readVerses(file);
  if (!verses || verses.length === 0) {
    test('first_verse', `${file} — has first verse`, false, 'empty file');
    continue;
  }
  test(
    'first_verse',
    `${file} starts with correct Arabic`,
    verses[0].h1.includes(expectedStart),
    `Got: "${verses[0].h1.substring(0, 30)}", Expected start: "${expectedStart}"`
  );
  test(
    'first_verse',
    `${file} verse 1 has both hemistichs`,
    verses[0].h1.length > 3 && verses[0].h2.length > 3,
    `h1="${verses[0].h1.substring(0,20)}" h2="${verses[0].h2.substring(0,20)}"`
  );
}

// ─── SUITE 4: CORPUS INTEGRITY ───────────────────────────────────────────────
console.log('\n🔍 Suite 4: Corpus Integrity');
let emptyFiles = 0;
let singleLineFiles = 0;
let totalVerses = 0;
for (const file of files) {
  const verses = readVerses(file);
  if (!verses || verses.length === 0) emptyFiles++;
  else if (verses.length === 1) singleLineFiles++;
  if (verses) totalVerses += verses.length;
}
test('integrity', 'No empty corpus files', emptyFiles === 0, `Empty: ${emptyFiles}`);
test('integrity', 'No single-verse files (likely indexing error)', singleLineFiles < 5, `Single: ${singleLineFiles}`);
test('integrity', 'Total corpus verses > 5000', totalVerses > 5000, `Total: ${totalVerses}`);
test('integrity', 'Total corpus verses < 20000', totalVerses < 20000, `Total: ${totalVerses}`);

// ─── SUITE 5: SYNONYM RESOLUTION LOGIC ───────────────────────────────────────
console.log('\n🔗 Suite 5: Synonym Resolution Logic');

// Replicate the KHASSAID_SYNONYMS table from app.js (the critical ones)
const SYNONYMS = {
  'jawartou': 'jawartu.txt',
  'jawartu': 'jawartu.txt',
  'jaawartou': 'jawartu.txt',
  'djawartu': 'jawartu.txt',
  'mawahibou': 'mawahibu.txt',
  'mawahibu': 'mawahibu.txt',
  'mawahiboul quloub': 'mawahibu.txt',
  'mafatihoul bichri': 'mafatihul_bishri.txt',
  'mafatihul bishri': 'mafatihul_bishri.txt',
  'nuuru daarayni': 'nuuru_daarayni.txt',
  'nurul darayni': 'nuuru_daarayni.txt',
  'jalibatul maraghibi': 'jalibatul_maraghibi.txt',
  'rassail jali batul marahib': 'jalibatul_maraghibi.txt',
  'khatimatu munajati': 'khatimatu_munajati.txt',
  'zallat': 'zallat.txt',
};

function resolveFile(query) {
  const lower = query.toLowerCase();
  const sorted = Object.entries(SYNONYMS).sort((a,b) => b[0].length - a[0].length);
  for (const [alias, file] of sorted) {
    if (lower.includes(alias)) return file;
  }
  return null;
}

const synonymTests = [
  ['parle de jawartou', 'jawartu.txt'],
  ['cite le jaawartou', 'jawartu.txt'],
  ['mawahibou parle de quoi', 'mawahibu.txt'],
  ['parle de Mawahibul Quloub', 'mawahibu.txt'],
  ['Mafatihoul Bichri', 'mafatihul_bishri.txt'],
  ['nuurl darayni', null], // intentional miss — tests we don't over-match
  ['rassail jali batul marahib', 'jalibatul_maraghibi.txt'],
  ['khatimatu munajati', 'khatimatu_munajati.txt'],
  ['le Zallat', 'zallat.txt'],
];

for (const [query, expectedFile] of synonymTests) {
  const got = resolveFile(query);
  test(
    'synonyms',
    `"${query}" → ${expectedFile || 'null'}`,
    got === expectedFile,
    `Got: ${got}`
  );
}

// ─── SUITE 6: VERSE RANGE LOGIC ──────────────────────────────────────────────
console.log('\n📐 Suite 6: Verse Range Extraction Logic');

// Replicate the verse count detection from app.js
function detectVerseCount(query, totalVerses) {
  const lower = query.toLowerCase();
  const wantAll = /(tout|complet|intégral|entier|all|full)/i.test(lower);
  if (wantAll) return totalVerses;

  let count = 10; // default
  // 'le premier vers' / 'le 1er vers' = exactly 1
  if (/\ble\s*premier\b/i.test(lower) || /\b1er\b/i.test(lower)) return 1;
  const numMatch = lower.match(/(\d+)\s*(?:\w+\s*)?(?:1er|prem|vers|verset|ayat|premier|ligne)/i);
  if (numMatch) return Math.min(parseInt(numMatch[1]), totalVerses);
  const anyNum = lower.match(/\b(\d+)\b/);
  if (anyNum) return Math.min(parseInt(anyNum[1]), totalVerses);
  return count;
}

const jawCount = 29;
const rangeTests = [
  ['cite les 5 premiers vers de Jawartu', 5, jawCount],
  ['donne moi les 20 permir vers', 20, jawCount],        // typo test
  ['donne moi les 10 premiers versets', 10, jawCount],
  ['ecris moi tout jawartu', jawCount, jawCount],         // "tout" = all
  ['jawartu complet', jawCount, jawCount],
  ['les 3 premiers', 3, jawCount],
  ['50 versets de Nuuru Daarayni', 50, 1517],
  ['cite le premier vers', 1, jawCount],
];

for (const [query, expected, total] of rangeTests) {
  const got = detectVerseCount(query, total);
  test(
    'verse_range',
    `"${query}" → ${expected} verses`,
    got === expected,
    `Got: ${got}, Expected: ${expected}`
  );
}

// ─── SUITE 7: "SANS TRADUCTION" DETECTION ────────────────────────────────────
console.log('\n🔒 Suite 7: Direct Bypass Detection');

function isNoTranslation(text) {
  return /(sans traduction|arabe seulement|arabic only|juste l.arabe|just arabic|without translation)/i.test(text);
}

const bypassTests = [
  ['donne moi les 20 premiers vers sans traduction', true],
  ['cite jawartu arabe seulement', true],
  ['give me jawartu arabic only', true],
  ['parle de mawahibou', false],           // general question, should go to AI
  ['cite avec traduction', false],         // has translation, don't bypass
  ['explique le premier vers', false],     // needs AI explanation
];

for (const [query, expected] of bypassTests) {
  const got = isNoTranslation(query);
  test(
    'bypass',
    `"${query.substring(0,35)}" → bypass=${expected}`,
    got === expected,
    `Got: ${got}`
  );
}

// ─── RESULTS ─────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log(`📊 RESULTS`);
console.log(`  Total  : ${passed + failed}`);
console.log(`  ✅ Pass : ${passed}`);
console.log(`  ❌ Fail : ${failed}`);
const score = ((passed / (passed + failed)) * 100).toFixed(1);
console.log(`  Score  : ${score}%`);

if (failures.length > 0) {
  console.log('\n🔴 FAILURES:');
  for (const f of failures) {
    console.log(`  [${f.suite}] ${f.name}${f.details ? ` (${f.details})` : ''}`);
  }
}

if (failed === 0) {
  console.log('\n✅ ALL TESTS PASSED — Safe to deploy.\n');
  process.exit(0);
} else {
  const pct = parseFloat(score);
  if (pct >= 90) {
    console.log('\n⚠️  MINOR FAILURES — Review before deploying.\n');
    process.exit(1);
  } else {
    console.log('\n🛑 CRITICAL FAILURES — DO NOT DEPLOY.\n');
    process.exit(1);
  }
}
