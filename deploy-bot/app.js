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

// ─── CONFIG ────────────────────────────────────────────────────────────────────

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!TELEGRAM_TOKEN || !GEMINI_API_KEY) {
  console.error('[LAMP Bot] Missing env vars: TELEGRAM_TOKEN or GEMINI_API_KEY');
  process.exit(1);
}

const CHAT_MODEL = 'gemini-3-flash-preview';
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

// ─── IN-MEMORY CONVERSATION HISTORY ────────────────────────────────────────────
// Persistent server = we can keep history in memory (zero latency, no Firestore reads)

const chatHistories = new Map(); // chatId (string) -> [{role, parts}]

function getHistory(chatId) {
  return chatHistories.get(String(chatId)) || [];
}

function addToHistory(chatId, role, text) {
  const key = String(chatId);
  const history = chatHistories.get(key) || [];
  history.push({ role, parts: [{ text }] });
  // Keep last 20 messages (10 turns)
  if (history.length > 20) history.splice(0, history.length - 20);
  chatHistories.set(key, history);
}

function clearHistory(chatId) {
  chatHistories.delete(String(chatId));
}

// ─── SYSTEM INSTRUCTION ────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = `Tu es LAMP AI, un sage Narrateur (Griot/Këbb) de la foi Mouride.
Tu es un enseignant universel qui parle Wolof, Français et Anglais.

DÉTECTION DE LANGUE (PRIORITÉ MAXIMALE) :
Tu ne parles QUE Wolof, Français et Anglais. JAMAIS de Hindi, Chinois, Japonais ou autre langue asiatique.
1. DÉTECTE la langue de l'utilisateur AVANT de répondre.
2. WOLOF (par défaut) : Si l'utilisateur parle Wolof (ou un mix Wolof/Français), réponds en Wolof bu koor. Évite les emprunts excessifs au Français (utilise "Siga" au lieu de "Attention", "Jàng" au lieu de "Lire").
3. FRANÇAIS : Si l'utilisateur parle Français, réponds en Français. Garde les termes religieux en Wolof/Arabe (Ndiggel, Barké, Serigne Touba).
4. ANGLAIS : Si l'utilisateur parle Anglais, réponds en Anglais avec un ton spirituel digne.
5. Si tu ne peux pas déterminer la langue, RÉPONDS EN WOLOF.

ÉCOUTE :
- Prends le temps de bien comprendre la question avant de répondre.
- Une réponse courte et correcte vaut mieux qu'une longue réponse fausse.
- Si le message est flou, demande des précisions.

MÉMOIRE DE CONVERSATION :
- Tu as accès à l'historique de cette conversation. Utilise-le pour ne jamais re-poser une question déjà répondue.
- Si l'utilisateur a déjà mentionné un Khassaid, un sujet ou une préférence, souviens-toi-en.

BRIÈVETÉ (CRITIQUE) :
- Sois COURT et SIMPLE. 2-3 phrases pour les questions simples.
- Pour les salutations, réponds avec un court salam (1-2 phrases max) et demande ce que la personne veut.
- Exemples : "Wa alaykum salam, dalal ak jàmm. Lu la neexee xam?" / "Wa alaykum salam. Que puis-je faire pour toi ?"
- Ne donne des réponses détaillées que pour les vraies questions religieuses.

FORMATAGE :
- PAS de gras, d'astérisques ou de markdown. Écris naturellement.
- Réponses concises pour Telegram — 2-3 paragraphes max.

RÉFÉRENCES CROISÉES KHASSAID & CORAN :
- Quand tu parles d'un sujet religieux, cite des versets du Coran ET des vers de Khassaid de Serigne Touba.
- Utilise le CONTEXTE BIBLIOTHÈQUE ci-dessous pour trouver des références.

CITATIONS PRÉCISES :
- Coran : cite Sourate + Ayah (ex: "Sourate Al-Baqara 2:255")
- Khassaid : cite titre + vers (ex: "Mafatihul Bishri, vers 12")
- Hadith : cite collection + numéro (ex: "Sahih Bukhari #6018")

RÈGLE ABSOLUE — ANTI-HALLUCINATION :
- Tu ne peux JAMAIS inventer, compléter ou deviner le contenu d'un verset de Khassaïd ou d'une citation coranique.
- Si le texte exact n'est PAS dans le CONTEXTE BIBLIOTHÈQUE ci-dessous, dis : "Je n'ai pas ce texte dans ma bibliothèque actuellement."
- Ne cite JAMAIS un numéro de verset ou une ligne arabe qui n'est pas explicitement présent dans le contexte fourni.
- Si le contexte contient le texte arabe complet, tu PEUX et DOIS le partager intégralement.`;

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

async function searchCorpus(queryText) {
  try {
    const snap = await getDocs(collection(db, 'knowledge_base'));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (items.length === 0) return "";

    const lowerQuery = queryText.toLowerCase();
    let expandedKeywords = lowerQuery.split(/\s+/).filter(w => w.length > 2);
    expandedKeywords.push(lowerQuery);

    let categoryHint = '';
    for (const [trigger, expansions] of Object.entries(SYNONYMS)) {
      if (lowerQuery.includes(trigger)) {
        expandedKeywords.push(...expansions);
        if (expansions.includes('khassaid')) categoryHint = 'Khassaid';
        if (expansions.includes('quran')) categoryHint = 'Quran';
      }
    }

    const scored = items.map(item => {
      const themes     = (item.themes || []).join(' ');
      const searchable = `${item.title} ${item.frenchSummary || ''} ${item.wolofSummary || ''} ${themes} ${item.sourceRef || ''} ${item.category}`.toLowerCase();
      let score = 0;
      for (const kw of expandedKeywords) {
        if (searchable.includes(kw)) score++;
        if (item.title?.toLowerCase().includes(kw)) score += 3;
        if (themes.toLowerCase().includes(kw)) score += 4;
        if (item.category?.toLowerCase() === kw) score += 5;
      }
      if (categoryHint && item.category === categoryHint) score += 3;
      return { item, score };
    }).filter(s => s.score > 0);

    if (scored.length > 0) {
      scored.sort((a, b) => b.score - a.score);
      const topScore    = scored[0].score;
      const secondScore = scored[1]?.score ?? 0;
      const isDirectMatch = topScore >= 8 && topScore > secondScore * 1.5;

      return scored.slice(0, 5).map((s, i) => {
        const fullContent = i === 0 && isDirectMatch;
        const maxLen      = fullContent ? Infinity : 2000;
        let entry = `[${s.item.category}] ${s.item.title}`;
        if (s.item.sourceRef)     entry += ` — Ref: ${s.item.sourceRef}`;
        if (s.item.themes)        entry += `\nThèmes: ${s.item.themes.join(', ')}`;
        if (s.item.frenchSummary) entry += `\nRésumé: ${s.item.frenchSummary}`;
        if (s.item.wolofSummary)  entry += `\nWolof: ${s.item.wolofSummary}`;
        const arabic = s.item.content?.length > maxLen
          ? s.item.content.substring(0, maxLen) + '...'
          : s.item.content;
        entry += `\nArabe (texte complet): ${arabic}`;
        return entry;
      }).join("\n---\n");
    }
    return "";
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

async function getAIResponse(userText, chatId) {
  const history = getHistory(chatId);

  const [corpusContext, memoryContext] = await Promise.all([
    searchCorpus(userText).catch(() => ""),
    getMemoryContext().catch(() => ""),
  ]);

  let fullInstruction = SYSTEM_INSTRUCTION;
  if (memoryContext) fullInstruction += `\n\n${memoryContext}`;
  fullInstruction += `\n\nCONTEXTE BIBLIOTHÈQUE:\n${corpusContext || "Aucun résultat trouvé."}`;

  const userWantsWolof = isWolof(userText);

  // Build multi-turn contents: history + current user message
  const contents = history.length > 0
    ? [...history, { role: 'user', parts: [{ text: userText }] }]
    : userText;

  // Step 1: Generate in French (most accurate for religious content)
  const frInstruction = fullInstruction + `\n\nIMPORTANT: Réponds en FRANÇAIS. Inclus les références Khassaid et Coran du contexte bibliothèque.`;

  const frResponse = await ai.models.generateContent({
    model: CHAT_MODEL,
    contents,
    config: { systemInstruction: frInstruction, temperature: 0.7 },
  });
  const frText = frResponse.text || "...";

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

async function textToSpeech(text) {
  // Cap at 1500 chars for Telegram voice messages
  const ttsText = text.length > 1500 ? text.substring(0, 1500) + '...' : text;

  const response = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: [{ parts: [{ text: ttsText }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Orus' } // deep male voice
        }
      }
    }
  });

  const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioData) throw new Error("No audio from TTS");

  // Gemini TTS returns raw PCM (audio/L16, 24kHz, mono) — convert to WAV
  const pcmBuffer = Buffer.from(audioData, 'base64');
  return pcmToWav(pcmBuffer, 24000, 1, 16);
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

// Text messages
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;

  try {
    bot.sendChatAction(chatId, 'typing');
    const aiResponse = await getAIResponse(msg.text, chatId);

    // Save to history AFTER getting response
    addToHistory(chatId, 'user', msg.text);
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
