/**
 * LAMP AI — Telegram Bot (Railway Persistent Server)
 * Uses polling mode — no webhook URL needed.
 * Deploy: set Root Directory = deploy-bot in Railway settings.
 * Env vars required: TELEGRAM_TOKEN, GEMINI_API_KEY
 */

import fetch, { Headers, Request, Response } from 'node-fetch';
globalThis.fetch = fetch;
globalThis.Headers = Headers;
globalThis.Request = Request;
globalThis.Response = Response;

import TelegramBot from 'node-telegram-bot-api';
import { GoogleGenAI, Modality } from '@google/genai';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore/lite';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT_DIR = '/home/metawbms/lamp.metafrik.com';
const TEXTES_DIR = path.join(ROOT_DIR, 'Textes_Arabes_Serigne_Touba');

// ─── CONFIG ────────────────────────────────────────────────────────────────────

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!TELEGRAM_TOKEN || !GEMINI_API_KEY) {
  console.error('[LAMP Bot] Missing env vars: TELEGRAM_TOKEN or GEMINI_API_KEY');
  process.exit(1);
}

const CHAT_MODEL = 'gemini-2.5-flash';
const TTS_MODEL  = 'gemini-2.5-flash-preview-tts';

const firebaseConfig = {
  apiKey: "AIzaSyAWcGI0OZsHPh-IhglG_4MI9ZcQkkmUKw0",
  authDomain: "lampridial-19466.firebaseapp.com",
  projectId: "lampridial-19466",
};

// ─── INIT ──────────────────────────────────────────────────────────────────────

const fbApp = initializeApp(firebaseConfig);
const db    = getFirestore(fbApp);
const ai    = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const bot   = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

console.log('[LAMP Bot] Started — polling for messages...');

// ─── PERSISTENT CONVERSATION HISTORY ──────────────────────────────────────────
// Saved to disk so history survives bot restarts (crashes, updates, reboots)

const HISTORY_FILE = path.join(ROOT_DIR, 'chat_histories.json');
const chatHistories = new Map();

// Load histories from disk on startup
function loadHistoriesFromDisk() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
      const data = JSON.parse(raw);
      for (const [chatId, history] of Object.entries(data)) {
        chatHistories.set(chatId, history);
      }
      console.log(`[History] Loaded ${chatHistories.size} conversations from disk.`);
    }
  } catch (e) {
    console.warn('[History] Could not load histories:', e.message);
  }
}

// Save all histories to disk (debounced - max once per 3s)
let _saveTimer = null;
function saveHistoriesToDisk() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    try {
      const obj = {};
      for (const [k, v] of chatHistories.entries()) obj[k] = v;
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(obj), 'utf-8');
    } catch (e) {
      console.warn('[History] Could not save histories:', e.message);
    }
    _saveTimer = null;
  }, 3000);
}

// ─── CHAT LOG (Training Data + Dashboard) ─────────────────────────────────────
// Every interaction saved as JSONL — one line per exchange
// Format: {"ts":"...","chatId":...,"user":"...","username":"...","bot":"..."}

const CHAT_LOG_FILE = path.join(ROOT_DIR, 'chat_logs.jsonl');

function logInteraction(chatId, username, userText, botText) {
  try {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      chatId,
      username: username || 'unknown',
      user: userText,
      bot: botText,
    });
    fs.appendFileSync(CHAT_LOG_FILE, entry + '\n', 'utf-8');
  } catch (e) {
    console.warn('[Log] Could not write chat log:', e.message);
  }
}


function getHistory(chatId) {
  return chatHistories.get(String(chatId)) || [];
}

function addToHistory(chatId, role, text) {
  const key = String(chatId);
  const history = chatHistories.get(key) || [];
  history.push({ role, parts: [{ text }] });
  // Keep last 30 messages (15 turns)
  if (history.length > 30) history.splice(0, history.length - 30);
  chatHistories.set(key, history);
  saveHistoriesToDisk();
}

function clearHistory(chatId) {
  chatHistories.delete(String(chatId));
  saveHistoriesToDisk();
}

// Load on startup
loadHistoriesFromDisk();

// ─── SYSTEM INSTRUCTION ────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = `Tu es LAMP AI — un compagnon spirituel Mouride, savant et humble.
Tu n'es pas un maître, ni au-dessus des autres. Tu es un frère en quête de connaissance,
un compagnon de chemin qui partage ce qu'il a appris avec chaleur et respect mutuel.
Tu parles au même niveau que l'utilisateur. Pas de formules condescendantes.

DÉTECTION DE LANGUE :
1. WOLOF : Si l'utilisateur parle Wolof ou mix Wolof/Français → réponds en Wolof bu koor.
2. FRANÇAIS : Réponds en Français, garde les termes religieux en Wolof/Arabe.
3. ANGLAIS : Si l'utilisateur parle Anglais → réponds en Anglais.

<COMPORTEMENT_GENERAL>
Tu réponds à TOUTES les questions — religieuses, factuelles, générales, ou de la vie courante.
Ne refuse PAS de répondre sous prétexte d'éviter les hallucinations.
L'hallucination interdite concerne UNIQUEMENT l'invention de versets arabes de Serigne Touba.
Pour tout le reste (Islam général, histoire, science, actualité, vie quotidienne) : réponds
librement et honnêtement avec tout ce que tu sais.

Si tu ne sais pas quelque chose de précis : dis-le en une phrase et donne ce que tu peux.
</COMPORTEMENT_GENERAL>

<KHASSAID_RULES>
Pour les Khassaids de Cheikh Ahmadou Bamba UNIQUEMENT :
1. Le système injecte automatiquement les versets réels dans "=== SOURCE DIRECTE ===".
2. TU DOIS utiliser ces versets injectés. Ce sont des textes authentiques du corpus.
3. Ne JAMAIS inventer de l'arabe ou fabriquer des paroles de Serigne Touba de mémoire.
4. Si aucun verset n'est injecté pour un Khassaid : dis-le en une phrase courte.
5. Pour le nombre de versets : cherche dans <KHASSAIDS_METADATA>.
</KHASSAID_RULES>

<CITATIONS_PRECISES>
- Coran : cite Sourate + Ayah (ex: "Al-Baqara 2:255")
- Khassaid : cite titre + verset si disponible (ex: "[Mafatihul Bishri, Verset 12]")
- Hadith : cite collection + numéro (ex: "Sahih Bukhari #6018")
</CITATIONS_PRECISES>
`;


const KHASSAIDS_METADATA = `LISTE DES 122 KHASSAIDS ET LEUR NOMBRE DE VERSETS:
Ahazanil Baaqi (25 versets), Ahuzu Bil Laahi Min Mayli (24), Ahyaytu Mawlidan (18), Ajabani Khayru Baaqin (6), Ajabani Rabbus Sama (78), Alaa Inani (26), Alal Mustafa Minni (10), Alhamdu Yujaazi (21), Allaahu Hayyun Samadun (4), Anta Rabbi (27), Ashaabul Jannati (24), Ashinu (42), Ashkuru Laaha (12), Asiru (56), Asma Ul Husna (40), Astaghfirulaha Bihi (12), Ataaba (116), Ayyasa (23), Bakh Bakhaa (26), Barakatu (20), Bihaqqi (7), Bismil Ilaahil Lazi (20), Bismil Laahi Ikfini (101), Bushra Lana (25), Faaqa Jamiha (12), Farrij (15), Fazal Lazina (17), Fazat Qilami (14), Fuzti (24), Hajat Qasa Idi (33), Halal Muntaqa (20), Halaman (36), Halayka Yaa Mukhtaru (11), Hamdi Wa Shukri (4), Hamidtu (19), Hammat Sulaymaa (115), Huqqal Bukaa (78), Ihdi Jamihana (6), Ilaa Ghayrinaa (24), Ilaa Nabiyyin (13), Inani Huztu (59), Innabna Laahi (24), Inni Ukhatibu (15), Innii Aquulu (19), Inniya Ahmadu (43), Jalibatul Maraghibi (533), Jawartu (29), Jazbu (185), Kafaaka Rabbuka (3), Kawin Liya (37), Khatimatu Munajati (39), Khayra Dayfin (14), Kun Katiman (8), Lamyabdu (12), Lil Mustafa Nawaytu (28), Lirabbin Ghafurin (44), Lirabbin Kariimin (17), Liyan Qaada (12), Madahtu Nabiyyal Muntaqa (12), Madal Khabiru (24), Madhun Nabiyyil Muntaqa (12), Mafatihul Bishri (374), Mafatihul Jinan (168), Mahaa Huyuubii (12), Man Zanani (15), Maramiya (5), Matlabul Fawzayni (236), Matlabushiffa (55), Matlabut Taqabbuli (60), Mawahibu (166), Midadi (66), Miftahun Nasri (15), Mim Ra Shin (3), Mimiya (150), Minal Haqqi (10), Minal Lawhil Mahfuzi (14), Minanul Baaqil Qadiim (217), Mulkul Lazii (10), Mumitu (14), Muqadamatul Amdah (192), Nuuru Daarayni (1517), Qalu Liyarkan (10), Raa Iya (117), Rabbi Karrimun (19), Rabbiya Ahmadu (28), Raditu (72), Rafahnaa (12), Rumna Shukur (89), Sabhun Taqii (30), Safar (12), Safaru Bamsashin (12), Salaatu Rahiimin (12), Sana Ilaahi (5), Shakawtu (13), Shakuru Rafihu (8), Sindidi (50), Takhmiisi (102), Tawbatun Nasuuh (106), Taysirul Hasiru (295), Tuhfatu Mutadarihin (58), Wa Kaana Haqqan (152), Wadudu (22), Waduuhu (16), Wajjahtu Hamdan (16), Wajjahtu Kulliya (25), Wajjahtu Wajhii (38), Wajjahtu Wajhiya (25), Wal Baladu (30), Walaqad Karamna (86), Waqani (17), Wawassaynal (25), Yaa Jumlatan (50), Yaa Kitaabal Kariimi (17), Yaa Mukrima Dayfi (14), Yaa Rakhmanu (9), Yaa Zal Busharati (61), Yaa Zal Wujuudi (12), Yaqini (16), Yarabbi (7), Yassara (12), Yasurru (12), Zallat (9).`;

// ─── CORPUS SEARCH ─────────────────────────────────────────────────────────────

const SYNONYMS = {
  'serigne touba': ['cheikh ahmadou bamba', 'khassaid'],
  'khadim rassoul': ['cheikh ahmadou bamba', 'khassaid'],
  'bamba': ['cheikh ahmadou bamba', 'khassaid'],
  'touba': ['cheikh ahmadou bamba', 'khassaid'],
  'mouride': ['cheikh ahmadou bamba', 'khassaid'],
  'xassida': ['khassaid'], 'khassida': ['khassaid'], 'kassida': ['khassaid'],
  'khasside': ['khassaid'], 'xassaid': ['khassaid'], 'khassaid': ['khassaid'],
  'poem': ['khassaid'], 'poème': ['khassaid'],
  'prayer': ['khassaid', 'quran'], 'prière': ['khassaid', 'quran'],
  'pardon': ['khassaid', 'quran', 'forgiveness', 'baal'],
  'forgiveness': ['khassaid', 'quran', 'pardon'],
  'baal': ['khassaid', 'pardon'],
  'patience': ['khassaid', 'quran', 'muñ', 'sabr'],
  'muñ': ['khassaid', 'patience'],
  'sabr': ['khassaid', 'quran', 'patience'],
  'amour': ['khassaid', 'quran', 'love', 'sopp'],
  'love': ['khassaid', 'quran', 'amour'],
  'foi': ['khassaid', 'quran', 'faith', 'iman'],
  'faith': ['khassaid', 'quran', 'foi', 'iman'],
  'iman': ['khassaid', 'quran', 'foi', 'faith'],
  'repentir': ['khassaid', 'quran', 'tawba'],
  'tawba': ['khassaid', 'quran', 'repentir'],
  'dieu': ['khassaid', 'quran', 'allah', 'yàlla'],
  'allah': ['khassaid', 'quran', 'dieu', 'yàlla'],
  'prophète': ['khassaid', 'quran', 'muhammad'],
  'muhammad': ['khassaid', 'quran', 'prophète'],
  'travail': ['khassaid', 'quran', 'liggéey'],
  'liggéey': ['khassaid', 'travail'],
  'science': ['khassaid', 'quran', 'knowledge', 'xam'],
  'xam': ['khassaid', 'science'],
  'mort': ['khassaid', 'quran', 'death'],
  'paradis': ['khassaid', 'quran', 'janna'],
  'janna': ['khassaid', 'quran', 'paradis'],
  'miséricorde': ['khassaid', 'quran', 'mercy', 'rahma'],
  'mercy': ['khassaid', 'quran', 'miséricorde'],
  'rahma': ['khassaid', 'quran', 'miséricorde'],
};

async function embedText(text) {
  const response = await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: text.substring(0, 2000),
  });
  return response.embeddings?.[0]?.values || response.embedding?.values || [];
}

function cosineSimilarity(a, b) {
  let dotProduct = 0, magnitudeA = 0, magnitudeB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }
  const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}



// ─── KHASSAID NAME SYNONYMS ───────────────────────────────────────────────────
// Maps every spelling variant to a canonical file name
const KHASSAID_SYNONYMS = {
  // Mawahibu
  'mawahibu': 'mawahibu.txt',
  'mawahib': 'mawahibu.txt',
  'mawahiboul quloub': 'mawahibu.txt',
  'mawahibul quloub': 'mawahibu.txt',
  'mawahiboul': 'mawahibu.txt',
  'mawahibul': 'mawahibu.txt',
  'mawahiboul qulouub': 'mawahibu.txt',
  'mawahib al': 'mawahibu.txt',

  // Jawartu
  'jawartu': 'jawartu.txt',
  'jawartou': 'jawartu.txt',
  'jaawartou': 'jawartu.txt',
  'jawaartu': 'jawartu.txt',
  'ja wartu': 'jawartu.txt',
  'djawartou': 'jawartu.txt',
  'djawartu': 'jawartu.txt',
  'jawortu': 'jawartu.txt',

  // Mafatihul Bishri
  'mafatihul bishri': 'mafatihul_bishri.txt',
  'mafatihu': 'mafatihul_bishri.txt',
  'mafatih': 'mafatihul_bishri.txt',
  'mafatihul': 'mafatihul_bishri.txt',
  'mafatihoul': 'mafatihul_bishri.txt',
  'mafatihoul bishri': 'mafatihul_bishri.txt',
  'mafatihul bichri': 'mafatihul_bishri.txt',
  'mafatihoul bichri': 'mafatihul_bishri.txt',

  // Nuuru Daarayni
  'nuuru daarayni': 'nuuru_daarayni.txt',
  'nuru daarayni': 'nuuru_daarayni.txt',
  'nourou darayn': 'nuuru_daarayni.txt',
  'nourou': 'nuuru_daarayni.txt',
  'nuru darayni': 'nuuru_daarayni.txt',
  'nourouddarayne': 'nuuru_daarayni.txt',
  'nuuro': 'nuuru_daarayni.txt',

  // Ndaxaan
  'ndaxaan': 'ndaxaan.txt',
  'ndaxan': 'ndaxaan.txt',
  'ndakhaan': 'ndaxaan.txt',
  'ndakhan': 'ndaxaan.txt',

  // Matlabul Fawzayni
  'matlabul fawzayni': 'matlabul_fawzayni.txt',
  'matlaboul fawzayni': 'matlabul_fawzayni.txt',
  'matlab': 'matlabul_fawzayni.txt',
  'matlabul': 'matlabul_fawzayni.txt',
  'matlaboul': 'matlabul_fawzayni.txt',
  'matlabul fawzayn': 'matlabul_fawzayni.txt',

  // Jazbu
  'jazbu': 'jazbu.txt',
  'jazboul': 'jazbu.txt',
  'jazb': 'jazbu.txt',
  'jazbul': 'jazbu.txt',

  // Taysirul Hasiru
  'taysirul hasiru': 'taysirul_hasiru.txt',
  'taysirul': 'taysirul_hasiru.txt',
  'taysir': 'taysirul_hasiru.txt',
  'tayssirul': 'taysirul_hasiru.txt',
  'tayssirul hasiru': 'taysirul_hasiru.txt',

  // Burdah
  'burdah': 'burdah.txt',
  'burda': 'burdah.txt',
  'qasidatul burdah': 'burdah.txt',
  'kasidatul burda': 'burdah.txt',

  // Masalikul Jinan
  'masalikul jinan': 'masalikul_jinan.txt',
  'masalik': 'masalikul_jinan.txt',
  'masalikoul': 'masalikul_jinan.txt',
  'masalikoul jinan': 'masalikul_jinan.txt',

  // Tokhasse
  'tokhasse': 'tokhasse.txt',
  'tokhas': 'tokhasse.txt',
  'tokhas se': 'tokhasse.txt',
};

// Resolve a query text to a Khassaid file (returns null if not found)
function resolveKhassaidFile(lower) {
  // Sort by key length desc so longer/more specific names match first
  const sorted = Object.entries(KHASSAID_SYNONYMS).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, file] of sorted) {
    if (lower.includes(alias)) {
      return path.join(TEXTES_DIR, file);
    }
  }
  return null;
}

async function getDirectVersesFallback(queryText) {
  const lower = queryText.toLowerCase();
  const targetFile = resolveKhassaidFile(lower);

  if (!targetFile || !fs.existsSync(targetFile)) return null;

  try {
    const content = fs.readFileSync(targetFile, 'utf8');
    const lines = content.split('\n').filter(l => l.trim().length > 5);
    // Each verse = 2 lines (first hemistich + second hemistich)
    const totalVerses = Math.floor(lines.length / 2);

    // "tout", "complet", "intégral", "all", "entier" = return full Khassaid
    const wantAll = /(tout|complet|intégral|intégrale|entier|all|full)/i.test(lower);

    let verseCount = wantAll ? totalVerses : 20; // default 20 verses for AI context

    if (!wantAll) {
      // 'le premier vers' = exactly 1 verse
      if (/\ble\s*premier\b/i.test(lower) || /\b1er\b/i.test(lower)) verseCount = 1;
      else {
        const numMatch = lower.match(/(\d+)\s*(?:\w+\s*)?(?:1er|prem|vers|verset|ayat|premier|ligne)/i);
        if (numMatch) verseCount = Math.min(parseInt(numMatch[1]), totalVerses);
        else {
          const anyNum = lower.match(/\b(\d+)\b/);
          if (anyNum) verseCount = Math.min(parseInt(anyNum[1]), totalVerses);
        }
      }
    }

    const isGeneral = /(parle de|sujet|th[ée]me|about|contenu|sens|signif|d[ée]crit|overview)/i.test(lower);
    if (isGeneral && !wantAll) verseCount = Math.min(20, totalVerses);

    // Build verse pairs: line[i*2] + line[i*2+1]
    const khassaidName = path.basename(targetFile, '.txt').replace(/_/g, ' ').toUpperCase();
    const verses = [];
    for (let i = 0; i < verseCount && (i * 2 + 1) < lines.length; i++) {
      const h1 = lines[i * 2] || '';
      const h2 = lines[i * 2 + 1] || '';
      verses.push(`[Verset ${i + 1}]\n${h1}\n${h2}`);
    }

    if (verses.length > 0) {
      return `\n=== SOURCE DIRECTE: ${khassaidName} (${verses.length}/${totalVerses} versets) ===\n` +
             verses.join('\n');
    }
  } catch (e) {
    console.error('[Fallback] Error reading file:', e.message);
  }
  return null;
}


let _versetsCache = null;

import readline from 'readline';

async function loadVersets() {
  if (_versetsCache) return _versetsCache;
  try {
    const cachePath = path.join(ROOT_DIR, 'versets_cache.jsonl');
    if (fs.existsSync(cachePath)) {
      const start = Date.now();
      const fileStream = fs.createReadStream(cachePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      _versetsCache = [];
      for await (const line of rl) {
        if (line.trim()) _versetsCache.push(JSON.parse(line));
      }
      console.log(`[Cache] Loaded ${_versetsCache.length} versets in ${Date.now() - start}ms`);
    } else {
      console.warn("[Cache] versets_cache.jsonl not found.");
      _versetsCache = [];
    }
  } catch (err) {
    console.error("[Cache] Error loading versets_cache.jsonl:", err.message);
    _versetsCache = [];
  }
  return _versetsCache;
}

// Trigger initial load in background
loadVersets().catch(e => console.error("[Cache] Background load failed:", e.message));

async function searchVersets(queryText) {
  // 1. Always try direct file fallback first (fastest, most accurate)
  const direct = await getDirectVersesFallback(queryText);
  if (direct) return direct;

  const versets = await loadVersets();
  if (versets.length === 0) return '';

  try {
    const queryEmb = await embedText(queryText);
    const scored = versets
      .filter(v => v.e && v.e.length > 0)
      .map(v => ({ v, score: cosineSimilarity(queryEmb, v.e) }));
    
    scored.sort((a, b) => b.score - a.score);
    const pertinents = scored.filter(s => s.score > 0.5).slice(0, 6);
    
    if (pertinents.length > 0) {
      return '\n=== VERSETS KHASSAID EXACTS (À CITER) ===\n' + 
             pertinents.map(s => s.v.c).join('\n---\n');
    }
  } catch (err) {
    console.error('[Search] Vector error:', err.message);
  }
  
  // Keyword fallback — match any word in the query against verse titles/content
  const lower = queryText.toLowerCase();
  const words = lower.split(/\s+/).filter(w => w.length > 3);
  const matches = versets
    .filter(v => words.some(w => v.t?.toLowerCase().includes(w) || v.c?.toLowerCase().includes(w)))
    .slice(0, 5);
  if (matches.length > 0) return '\n=== VERSETS KHASSAID EXACTS ===\n' + matches.map(v => v.c).join('\n---\n');
  
  return '';
}

async function searchCorpus(queryText) {
  try {
    const versetsContext = await searchVersets(queryText);
    // Recherche dans la base documentaire classsique (summaries)
    const snap = await getDocs(collection(db, 'knowledge_base'));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    let docsContext = "";

    if (items.length > 0) {
      const lowerQuery = queryText.toLowerCase();
      let expandedKeywords = lowerQuery.split(/\s+/).filter(w => w.length > 2);
      expandedKeywords.push(lowerQuery);

      const scored = items.map(item => {
        const themes = (item.themes || []).join(' ');
        const searchable = `${item.title} ${item.frenchSummary || ''} ${item.wolofSummary || ''} ${themes}`.toLowerCase();
        let score = 0;
        for (const kw of expandedKeywords) {
          if (searchable.includes(kw)) score++;
          if (item.title?.toLowerCase().includes(kw)) score += 3;
        }
        return { item, score };
      }).filter(s => s.score > 0);

      if (scored.length > 0) {
        scored.sort((a, b) => b.score - a.score);
        docsContext = scored.slice(0, 3).map(s => {
          let entry = `[${s.item.category}] ${s.item.title}`;
          if (s.item.frenchSummary) entry += `\nRésumé: ${s.item.frenchSummary}`;
          return entry;
        }).join("\n---\n");
      }
    }

    if (versetsContext && docsContext) return versetsContext + '\n\n=== CONTEXTE DOCUMENTS ===\n' + docsContext;
    return versetsContext || docsContext;
  } catch (e) {
    console.error("[Corpus] Error:", e.message);
    return "";
  }
}


// ─── MEMORY ─────────────────────────────────────────────────────────────────────

async function getMemoryContext() {
  try {
    const q    = query(collection(db, 'ai_memory'), where('status', '==', 'active'));
    const snap = await getDocs(q);
    const memories = snap.docs.map(d => d.data());
    if (memories.length === 0) return "";

    const grouped = {};
    for (const m of memories) {
      const key = m.type || 'general';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(m.content);
    }

    let ctx = "=== MÉMOIRE PERMANENTE ===\n";
    for (const [type, items] of Object.entries(grouped)) {
      ctx += `\n[${type.toUpperCase()}]:\n`;
      ctx += items.map((c, i) => `${i + 1}. ${c}`).join('\n') + '\n';
    }
    return ctx;
  } catch (e) {
    console.error("[Memory] Error:", e.message);
    return "";
  }
}

// ─── WOLOF DETECTION ────────────────────────────────────────────────────────────

function isWolof(text) {
  const markers = ['nanga def', 'jërëjëf', 'ndax', 'bëgg', 'xam', 'wax', 'jàng',
    'liggéey', 'yàlla', 'serigne', 'ndeysaan', 'mbokk', 'touba', 'muñ', 'baal',
    'xassida', 'ndawsi', 'dama', 'lii', 'loolu', 'degg', 'waaw', 'nit', 'jëf', 'def'];
  const lower   = text.toLowerCase();
  const matches = markers.filter(w => lower.includes(w)).length;
  return matches >= 2 || (matches >= 1 && text.length < 50);
}

// ─── AI RESPONSE ────────────────────────────────────────────────────────────────

// Extract the last Khassaid mentioned in conversation history
// so that follow-up messages like "donne les 20 premiers vers" still search the right file
function extractLastKhassaidFromHistory(history) {
  // Look at last 6 messages (most recent first)
  const recent = [...history].reverse().slice(0, 6);
  const sorted = Object.entries(KHASSAID_SYNONYMS).sort((a, b) => b[0].length - a[0].length);
  for (const msg of recent) {
    const text = msg.parts?.[0]?.text?.toLowerCase() || '';
    for (const [alias] of sorted) {
      if (text.includes(alias)) return alias;
    }
  }
  return null;
}

async function getAIResponse(userText, chatId) {
  const history = getHistory(chatId);

  // If current message has no Khassaid name, enrich with last mentioned Khassaid from history
  let searchQuery = userText;
  if (!resolveKhassaidFile(userText.toLowerCase())) {
    const lastKhassaid = extractLastKhassaidFromHistory(history);
    if (lastKhassaid) {
      searchQuery = `${userText} ${lastKhassaid}`;
      console.log(`[Context] Enriched query with history Khassaid: "${lastKhassaid}"`);
    }
  }

  const [corpusContext, memoryContext] = await Promise.all([
    searchCorpus(searchQuery).catch(() => ""),
    getMemoryContext().catch(() => ""),
  ]);

  let fullInstruction = SYSTEM_INSTRUCTION;
  if (memoryContext) fullInstruction += `\n\n<MEMORY_SYSTEM>\n${memoryContext}\n</MEMORY_SYSTEM>`;
  fullInstruction += `\n\n<KHASSAIDS_METADATA>\n${KHASSAIDS_METADATA}\n</KHASSAIDS_METADATA>`;
  fullInstruction += `\n\n<CONTEXTE_RAG>\n${corpusContext || "Aucun résultat trouvé."}\n</CONTEXTE_RAG>`;

  const userWantsWolof = isWolof(userText);

  // Build multi-turn contents: history + current user message
  const contents = history.length > 0
    ? [...history, { role: 'user', parts: [{ text: userText }] }]
    : userText;

  // Step 1: Generate in French with Google Search grounding for factual questions
  const frInstruction = fullInstruction + `\n\nIMPORTANT: Réponds en FRANÇAIS. Inclus les références Khassaid et Coran du contexte bibliothèque. Pour les questions générales ou factuelles, utilise toutes tes connaissances disponibles et réponds complètement.`;

  console.log(`[Debug] Calling generateContent (French) for text: ${userText.substring(0, 30)}`);
  const frResponse = await ai.models.generateContent({
    model: CHAT_MODEL,
    contents,
    config: {
      systemInstruction: frInstruction,
      temperature: 0.7,
      tools: [{ googleSearch: {} }],  // Google Search grounding for factual queries
    },
  });
  console.log(`[Debug] generateContent returned properly.`);
  const frText = frResponse.text || '...';

  // Step 2: If user writes Wolof, translate to pure Wolof
  if (userWantsWolof) {
    const woResponse = await ai.models.generateContent({
      model: CHAT_MODEL,
      contents: `Translate this French text to pure Wolof (Wolof bu koor). Rules:
- Use authentic Wolof, minimize French loanwords
- Keep Arabic religious terms (Sourate, Ayah, Khassaid titles)
- Keep all Quran/Khassaid references exactly as they are
- Natural spoken Wolof tone, like a Griot speaking
- Output ONLY the Wolof translation, nothing else

French text:
${frText}`,
      config: { temperature: 0.3 },
    });
    return woResponse.text || frText;
  }

  return frText;
}

// ─── PCM → WAV ──────────────────────────────────────────────────────────────────

function pcmToWav(pcmBuffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const byteRate   = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize   = pcmBuffer.length;
  const wav        = Buffer.alloc(44 + dataSize);

  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(numChannels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(wav, 44);

  return wav;
}

// ─── TTS ────────────────────────────────────────────────────────────────────────

function prepareTTSText(text) {
  // 1. Strip Arabic script (TTS model can't pronounce it — causes 500 errors)
  let clean = text.replace(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]+/g, '');
  // 2. Strip Markdown formatting
  clean = clean.replace(/[*_`~#>]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // 3. Collapse multiple blank lines
  clean = clean.replace(/\n{3,}/g, '\n\n').trim();
  // 4. Cap at 800 chars, break at last sentence boundary
  if (clean.length > 800) {
    const cut = clean.substring(0, 800);
    const lastDot = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'), cut.lastIndexOf('\n'));
    clean = lastDot > 400 ? cut.substring(0, lastDot + 1) : cut + '...';
  }
  return clean.trim();
}

async function textToSpeech(text) {
  const ttsText = prepareTTSText(text);
  if (!ttsText || ttsText.length < 3) throw new Error('TTS text too short after cleaning');

  // Retry up to 3 times with 2s backoff (handles Gemini 500 errors)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: TTS_MODEL,
        contents: [{ parts: [{ text: ttsText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Orus' }
            }
          }
        }
      });

      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioData) throw new Error('No audio data in response');

      // Gemini TTS returns raw PCM (audio/L16, 24kHz, mono) — convert to WAV
      const pcmBuffer = Buffer.from(audioData, 'base64');
      return pcmToWav(pcmBuffer, 24000, 1, 16);

    } catch (err) {
      if (attempt < 3) {
        console.warn(`[TTS] Attempt ${attempt} failed: ${err.message} — retrying in 2s...`);
        await new Promise(r => setTimeout(r, 2000));
      } else {
        throw err; // rethrow on final attempt
      }
    }
  }
}


// ─── DOWNLOAD FILE ──────────────────────────────────────────────────────────────

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const handler = (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    };
    (url.startsWith('https') ? https : http).get(url, handler).on('error', reject);
  });
}

// ─── TRANSCRIBE ─────────────────────────────────────────────────────────────────

async function transcribeVoice(fileBuffer, mimeType) {
  const response = await ai.models.generateContent({
    model: CHAT_MODEL,
    contents: {
      parts: [
        { inlineData: { mimeType, data: fileBuffer.toString('base64') } },
        { text: "Transcris cet audio exactement tel que parlé. Garde la langue originale (Wolof, Français ou Anglais). Retourne UNIQUEMENT la transcription." }
      ]
    },
    config: { temperature: 0.1 }
  });
  return response.text?.trim() || "";
}

// ─── SEND VOICE (WAV buffer) ─────────────────────────────────────────────────────

async function sendWavVoice(chatId, wavBuffer) {
  await bot.sendVoice(chatId, wavBuffer, {}, { filename: 'voice.wav', contentType: 'audio/wav' });
}

// ─── HANDLERS ───────────────────────────────────────────────────────────────────

bot.onText(/\/start/, (msg) => {
  const name = msg.from?.first_name || 'Disciple';
  bot.sendMessage(msg.chat.id,
    `As-salamu alaykum ${name}\n\n` +
    `Je suis LAMP AI, ton guide spirituel Mouride.\n\n` +
    `Comment m'utiliser :\n` +
    `- Écris-moi un message texte\n` +
    `- Envoie-moi un message vocal\n\n` +
    `Je te répondrai en texte ET en vocal.\n\n` +
    `Essaie : "Parle-moi du pardon chez Serigne Touba"\n\n` +
    `Commandes :\n/clear — effacer l'historique de la conversation`
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `LAMP AI — Guide\n\n` +
    `Écris ou envoie un vocal sur l'Islam, le Mouridisme, Cheikh Ahmadou Bamba, le Coran, les Khassaid...\n\n` +
    `Exemples :\n` +
    `- "Parle-moi de la patience dans les Khassaid"\n` +
    `- "Que dit le Coran sur le pardon ?"\n` +
    `- "Serigne Touba wax na ci liggéey?"\n` +
    `- "Donne-moi le Mawahibou complet"\n\n` +
    `/clear — recommencer une nouvelle conversation`
  );
});

bot.onText(/\/clear/, (msg) => {
  clearHistory(msg.chat.id);
  bot.sendMessage(msg.chat.id, "Historique effacé. Nouvelle conversation commencée. As-salamu alaykum.");
});

// ─── DIRECT CITATION BYPASS ─────────────────────────────────────────────────────
// For "sans traduction" requests: bypass AI entirely, read corpus directly

function isVerseRequest(text) {
  return /(cite|donne|montre|liste|rappelle|lis|copie|écris|transcris|avant|suivant|prem|vers|verset|ayat|complet|intégral|sans traduction|arabe|first|show me|give me|recite)/i.test(text);
}

async function getDirectCitationResponse(userText, chatId) {
  const lower = userText.toLowerCase();
  
  let targetFile = resolveKhassaidFile(lower);
  if (!targetFile) {
    const history = getHistory(chatId);
    const lastKhassaid = extractLastKhassaidFromHistory(history);
    if (lastKhassaid) targetFile = resolveKhassaidFile(lastKhassaid);
  }
  
  if (!targetFile || !fs.existsSync(targetFile)) return null;
  
  try {
    const content = fs.readFileSync(targetFile, 'utf8');
    const lines = content.split('\n').filter(l => l.trim().length > 5);
    // Each verse = 2 lines (hemistich 1 + hemistich 2)
    const totalVerses = Math.floor(lines.length / 2);

    // "tout", "complet", "intégral", "all", "entier" = full Khassaid
    const wantAll = /(tout|complet|intégral|intégrale|entier|all|full)/i.test(lower);

    let verseCount = wantAll ? totalVerses : 10;
    // 'le premier vers' = exactly 1 verse
    if (/\ble\s*premier\b/i.test(lower) || /\b1er\b/i.test(lower)) verseCount = 1;
    else {
      const numMatch = lower.match(/(\d+)\s*(?:\w+\s*)?(?:1er|prem|vers|verset|ayat|premier|ligne|suiv)/i);
      if (numMatch && !wantAll) verseCount = Math.min(parseInt(numMatch[1]), totalVerses);
      else {
        const anyNum = lower.match(/\b(\d+)\b/);
        if (anyNum) verseCount = Math.min(parseInt(anyNum[1]), totalVerses);
      }
    }

    const khassaidName = path.basename(targetFile, '.txt').replace(/_/g, ' ').toUpperCase();
    
    // Build numbered verse pairs
    const verses = [];
    for (let i = 0; i < verseCount && (i * 2 + 1) < lines.length; i++) {
      const h1 = lines[i * 2] || '';
      const h2 = lines[i * 2 + 1] || '';
      verses.push(`${i + 1}. ${h1}\n   ${h2}`);
    }

    if (verses.length === 0) return null;

    return `📖 *${khassaidName}* — ${verses.length}/${totalVerses} versets\n\n` +
           verses.join('\n\n');
    
  } catch (e) {
    console.error('[DirectCitation] Error:', e.message);
    return null;
  }
}

// Text messages
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;

  try {
    bot.sendChatAction(chatId, 'typing');
    console.log(`[Message] Reçu: ${msg.text}`);

    // DIRECT BYPASS: for "X vers sans traduction" — skip AI, read corpus directly
    let aiResponse = null;
    const noTranslation = /(sans traduction|arabe seulement|arabic only|juste l.arabe|just arabic|without translation)/i.test(msg.text);
    if (noTranslation && isVerseRequest(msg.text)) {
      aiResponse = await getDirectCitationResponse(msg.text, chatId);
      if (aiResponse) console.log(`[DirectCitation] Served from corpus directly.`);
    }

    // Fallback to AI for everything else
    if (!aiResponse) {
      aiResponse = await getAIResponse(msg.text, chatId);
    }
    
    console.log(`[Message] AI a répondu.`);

    addToHistory(chatId, 'user', msg.text);
    addToHistory(chatId, 'model', aiResponse);
    logInteraction(chatId, msg.from?.username || msg.from?.first_name, msg.text, aiResponse);


    await bot.sendMessage(chatId, aiResponse, { parse_mode: 'Markdown' }).catch(() =>
      bot.sendMessage(chatId, aiResponse) // fallback without markdown if parse fails
    );

    try {
      bot.sendChatAction(chatId, 'record_voice');
      const wavBuffer = await textToSpeech(aiResponse);
      await sendWavVoice(chatId, wavBuffer);
    } catch (ttsErr) {
      console.warn("[TTS] Failed:", ttsErr.message);
    }
  } catch (err) {
    console.error("[Text] Error:", err.message);
    bot.sendMessage(chatId, "Baal ma, erreur technique. Réessayez.");
  }
});


// Voice messages
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  try {
    bot.sendChatAction(chatId, 'typing');
    const file    = await bot.getFile(msg.voice.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
    const fileBuffer = await downloadFile(fileUrl);

    const transcription = await transcribeVoice(fileBuffer, msg.voice.mime_type || 'audio/ogg');
    if (!transcription) {
      await bot.sendMessage(chatId, "Je n'ai pas compris. Pouvez-vous répéter ?");
      return;
    }

    await bot.sendMessage(chatId, `"${transcription}"`);
    bot.sendChatAction(chatId, 'typing');
    const aiResponse = await getAIResponse(transcription, chatId);

    addToHistory(chatId, 'user', transcription);
    addToHistory(chatId, 'model', aiResponse);

    await bot.sendMessage(chatId, aiResponse);

    try {
      bot.sendChatAction(chatId, 'record_voice');
      const wavBuffer = await textToSpeech(aiResponse);
      await sendWavVoice(chatId, wavBuffer);
    } catch (ttsErr) {
      console.warn("[TTS] Failed:", ttsErr.message);
    }
  } catch (err) {
    console.error("[Voice] Error:", err.message);
    bot.sendMessage(chatId, "Baal ma, erreur technique. Réessayez.");
  }
});

// Audio files
bot.on('audio', async (msg) => {
  const chatId = msg.chat.id;
  try {
    bot.sendChatAction(chatId, 'typing');
    const file    = await bot.getFile(msg.audio.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
    const fileBuffer = await downloadFile(fileUrl);

    const transcription = await transcribeVoice(fileBuffer, msg.audio.mime_type || 'audio/mpeg');
    if (!transcription) { await bot.sendMessage(chatId, "Je n'ai pas compris."); return; }

    await bot.sendMessage(chatId, `"${transcription}"`);
    bot.sendChatAction(chatId, 'typing');
    const aiResponse = await getAIResponse(transcription, chatId);

    addToHistory(chatId, 'user', transcription);
    addToHistory(chatId, 'model', aiResponse);

    await bot.sendMessage(chatId, aiResponse);

    try {
      bot.sendChatAction(chatId, 'record_voice');
      const wavBuffer = await textToSpeech(aiResponse);
      await sendWavVoice(chatId, wavBuffer);
    } catch (ttsErr) {
      console.warn("[TTS] Failed:", ttsErr.message);
    }
  } catch (err) {
    console.error("[Audio] Error:", err.message);
    bot.sendMessage(chatId, "Erreur technique. Réessayez.");
  }
});

// Keep-alive log every 5 minutes
setInterval(() => {
  console.log(`[LAMP Bot] Alive — ${new Date().toISOString()} — ${chatHistories.size} active chats`);
}, 5 * 60 * 1000);

console.log('[LAMP Bot] Ready.');
