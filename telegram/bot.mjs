/**
 * LAMP AI — Telegram Bot
 * Voice-to-voice + text chat with the same AI as the web app.
 *
 * Run:  node telegram/bot.mjs
 */

import TelegramBot from 'node-telegram-bot-api';
import { GoogleGenAI, Modality } from '@google/genai';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where, orderBy } from 'firebase/firestore/lite';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import https from 'https';
import http from 'http';

// ─── CONFIG ────────────────────────────────────────────────────────────────────

const TELEGRAM_TOKEN = '8718768067:AAGKmBVB67nK6feFZn8Arv3cuySBLpfmW9A';
const GEMINI_API_KEY = 'AIzaSyCfBSOJw5i2ajEBHhZB4KKGadBxAKP9wj8';

const CHAT_MODEL = 'gemini-3-flash-preview';
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

const firebaseConfig = {
  apiKey: "AIzaSyAWcGI0OZsHPh-IhglG_4MI9ZcQkkmUKw0",
  authDomain: "lampridial-19466.firebaseapp.com",
  projectId: "lampridial-19466",
};

// ─── INIT ──────────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

console.log('🟢 LAMP AI Telegram Bot started. Waiting for messages...');

// ─── SYSTEM INSTRUCTION ────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = `You are LAMP AI, a wise and deep-voiced Narrator (Griot/Këbb) of the Mouride faith.
Your primary language is Wolof, but you also speak French and English fluently.

CRITICAL — LANGUAGE RULES:
- You ONLY speak Wolof, French, and English. NEVER respond in Hindi, Chinese, Japanese, or ANY other language.
- DETECT the user's language BEFORE responding.
- If the user speaks Wolof (even mixed with French), respond in Wolof.
- If the user speaks French, respond in French with religious terms in Wolof/Arabic.
- If the user speaks English, respond in English.
- If unsure, DEFAULT TO WOLOF.

LISTENING:
- Take time to understand the question fully before answering.
- A short correct answer is better than a long wrong one.
- If the message is unclear, ask for clarification.

FORMATTING:
- NEVER use excessive bold, asterisks, or markdown formatting.
- Write naturally like a spoken conversation.
- Keep responses concise for Telegram — max 2-3 paragraphs unless the user asks for detail.

KHASSAID & QURAN CROSS-REFERENCING:
- When discussing any religious topic, cite BOTH Quran verses AND Khassaid of Serigne Touba when available.
- Use the LIBRARY CONTEXT provided below to find relevant references.
- NEVER invent references.

PRECISE CITATIONS:
- Quran: cite Surah name + Ayah (e.g., "Sourate Al-Baqara 2:255")
- Khassaid: cite title + verse if known (e.g., "Mafatihul Bishri, verse 12")
- Hadith: cite collection + number (e.g., "Sahih Bukhari #6018")`;

// ─── CORPUS SEARCH (same logic as web app) ─────────────────────────────────────

const SYNONYMS = {
  'serigne touba': ['cheikh ahmadou bamba', 'khassaid', 'khadimou rassoul'],
  'bamba': ['cheikh ahmadou bamba', 'khassaid'],
  'touba': ['cheikh ahmadou bamba', 'khassaid'],
  'mouride': ['cheikh ahmadou bamba', 'khassaid'],
  'xassida': ['khassaid'], 'khassida': ['khassaid'], 'kassida': ['khassaid'],
  'khasside': ['khassaid'], 'xassaid': ['khassaid'],
  'prayer': ['khassaid', 'quran'], 'prière': ['khassaid', 'quran'],
  'dua': ['khassaid'], 'wird': ['khassaid'], 'zikr': ['khassaid'],
  'pardon': ['khassaid', 'quran', 'forgiveness', 'maghfira', 'baal'],
  'forgiveness': ['khassaid', 'quran', 'pardon'],
  'baal': ['khassaid', 'pardon', 'forgiveness'],
  'patience': ['khassaid', 'quran', 'muñ', 'sabr'],
  'muñ': ['khassaid', 'quran', 'patience', 'sabr'],
  'amour': ['khassaid', 'quran', 'love', 'sopp'],
  'love': ['khassaid', 'quran', 'amour', 'sopp'],
  'sopp': ['khassaid', 'amour', 'love'],
  'foi': ['khassaid', 'quran', 'faith', 'iman'],
  'faith': ['khassaid', 'quran', 'foi', 'iman'],
  'repentir': ['khassaid', 'quran', 'tawba', 'tuub'],
  'tawba': ['khassaid', 'quran', 'repentir'],
  'dieu': ['khassaid', 'quran', 'allah', 'yàlla'],
  'allah': ['khassaid', 'quran', 'dieu', 'yàlla'],
  'yàlla': ['khassaid', 'quran', 'dieu', 'allah'],
  'prophète': ['khassaid', 'quran', 'muhammad', 'yonent'],
  'prophet': ['khassaid', 'quran', 'muhammad'],
  'travail': ['khassaid', 'quran', 'work', 'liggéey'],
  'work': ['khassaid', 'quran', 'travail', 'liggéey'],
  'liggéey': ['khassaid', 'travail', 'work'],
  'science': ['khassaid', 'quran', 'xam', 'knowledge'],
  'knowledge': ['khassaid', 'quran', 'science', 'xam'],
  'mort': ['khassaid', 'quran', 'death', 'dee'],
  'death': ['khassaid', 'quran', 'mort'],
  'paradis': ['khassaid', 'quran', 'janna'],
  'miséricorde': ['khassaid', 'quran', 'mercy', 'rahma', 'yërëm'],
  'mercy': ['khassaid', 'quran', 'miséricorde', 'rahma'],
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
      const searchable = `${item.title} ${item.content} ${item.sourceRef || ''} ${item.wolofText || ''} ${item.category}`.toLowerCase();
      let score = 0;
      for (const kw of expandedKeywords) {
        if (searchable.includes(kw)) score++;
        if (item.title.toLowerCase().includes(kw)) score += 3;
        if (item.category?.toLowerCase() === kw) score += 5;
      }
      if (categoryHint && item.category === categoryHint) score += 3;
      return { item, score };
    }).filter(s => s.score > 0);

    if (scored.length > 0) {
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, 5).map(s => {
        let entry = `[${s.item.category}] ${s.item.title}`;
        if (s.item.sourceRef) entry += ` — Ref: ${s.item.sourceRef}`;
        const content = s.item.content?.length > 1500 ? s.item.content.substring(0, 1500) + '...' : s.item.content;
        entry += `\n${content}`;
        if (s.item.wolofText) entry += `\nWolof: ${s.item.wolofText}`;
        return entry;
      }).join("\n---\n");
    }

    return "";
  } catch (e) {
    console.error("Corpus search error:", e.message);
    return "";
  }
}

// ─── ACTIVE MEMORIES ────────────────────────────────────────────────────────────

async function getMemoryContext() {
  try {
    const q = query(collection(db, 'ai_memory'), where('status', '==', 'active'));
    const snap = await getDocs(q);
    const memories = snap.docs.map(d => d.data());
    if (memories.length === 0) return "";

    const grouped = {};
    for (const m of memories) {
      const key = m.type || 'general';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(m.content);
    }

    let ctx = "=== PERMANENT AI MEMORY ===\n";
    for (const [type, items] of Object.entries(grouped)) {
      ctx += `\n[${type.toUpperCase()}]:\n`;
      ctx += items.map((c, i) => `${i + 1}. ${c}`).join('\n') + '\n';
    }
    return ctx;
  } catch (e) {
    console.error("Memory fetch error:", e.message);
    return "";
  }
}

// ─── GEMINI CHAT ────────────────────────────────────────────────────────────────

async function getAIResponse(userText) {
  const [corpusContext, memoryContext] = await Promise.all([
    searchCorpus(userText),
    getMemoryContext(),
  ]);

  let fullInstruction = SYSTEM_INSTRUCTION;
  if (memoryContext) fullInstruction += `\n\n${memoryContext}`;
  fullInstruction += `\n\nLIBRARY CONTEXT:\n${corpusContext || "No matches found."}`;

  const response = await ai.models.generateContent({
    model: CHAT_MODEL,
    contents: userText,
    config: {
      systemInstruction: fullInstruction,
      temperature: 0.7,
    },
  });

  return response.text || "...";
}

// ─── GEMINI TTS ─────────────────────────────────────────────────────────────────

async function textToSpeech(text) {
  // Truncate for TTS (max ~1000 chars to keep audio reasonable)
  const ttsText = text.length > 1000 ? text.substring(0, 1000) + '...' : text;

  const response = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: [{ parts: [{ text: ttsText }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' }
        }
      }
    }
  });

  const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioData) throw new Error("No audio data from TTS");

  // Save as temp file
  const tmpPath = join(tmpdir(), `lamp_tts_${Date.now()}.ogg`);

  // The audio comes as base64 PCM — we need to convert to OGG for Telegram
  // Gemini TTS returns WAV-like data, let's save as raw and send as voice
  const buffer = Buffer.from(audioData, 'base64');
  writeFileSync(tmpPath, buffer);

  return tmpPath;
}

// ─── DOWNLOAD TELEGRAM VOICE FILE ──────────────────────────────────────────────

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const handler = (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    };
    if (url.startsWith('https')) {
      https.get(url, handler).on('error', reject);
    } else {
      http.get(url, handler).on('error', reject);
    }
  });
}

// ─── TRANSCRIBE VOICE ──────────────────────────────────────────────────────────

async function transcribeVoice(fileBuffer, mimeType) {
  const base64 = fileBuffer.toString('base64');

  const response = await ai.models.generateContent({
    model: CHAT_MODEL,
    contents: {
      parts: [
        { inlineData: { mimeType, data: base64 } },
        { text: "Transcribe this audio exactly as spoken. Maintain the original language (Wolof, French, or English). Return ONLY the transcription, nothing else." }
      ]
    },
    config: { temperature: 0.1 }
  });

  return response.text?.trim() || "";
}

// ─── BOT HANDLERS ──────────────────────────────────────────────────────────────

// /start command
bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || 'Disciple';
  bot.sendMessage(msg.chat.id,
    `As-salamu alaykum ${name} 🕌\n\n` +
    `Maa ngi la di jàppale. Maa ngi fi ngir la jàng ci diine ji.\n\n` +
    `Je suis LAMP AI, ton guide spirituel Mouride.\n\n` +
    `📝 Écris-moi en texte\n🎙 Envoie un message vocal\n\n` +
    `Je te répondrai en texte ET en vocal, dans ta langue (Wolof, Français, ou Anglais).\n\n` +
    `Essaie : "Parle-moi du pardon chez Serigne Touba"`
  );
});

// /help command
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `LAMP AI — Guide d'utilisation\n\n` +
    `📝 Texte : Écris n'importe quelle question sur l'Islam, le Mouridisme, Cheikh Ahmadou Bamba, le Coran, les Khassaid...\n\n` +
    `🎙 Vocal : Envoie un message vocal et je te répondrai en vocal aussi.\n\n` +
    `Exemples :\n` +
    `- "Ndax Serigne Touba wax na ci baal?"\n` +
    `- "Parle-moi de la patience dans le Coran et les Khassaid"\n` +
    `- "What did Cheikh Ahmadou Bamba teach about work?"\n\n` +
    `L'AI cite toujours ses sources : Quran (Sourate:Ayah) et Khassaid (titre + vers).`
  );
});

// Handle TEXT messages
bot.on('message', async (msg) => {
  // Skip commands and non-text
  if (!msg.text || msg.text.startsWith('/')) return;

  const chatId = msg.chat.id;

  try {
    // Show typing indicator
    bot.sendChatAction(chatId, 'typing');

    const aiResponse = await getAIResponse(msg.text);

    // Send text response
    await bot.sendMessage(chatId, aiResponse);

    // Generate and send voice response
    try {
      bot.sendChatAction(chatId, 'record_voice');
      const audioPath = await textToSpeech(aiResponse);
      await bot.sendVoice(chatId, audioPath);
      // Cleanup temp file
      try { unlinkSync(audioPath); } catch {}
    } catch (ttsErr) {
      console.warn("TTS failed (text was sent):", ttsErr.message);
    }

  } catch (err) {
    console.error("Error handling text:", err.message);
    bot.sendMessage(chatId, "Baal ma, am na jafe-jafe. Jéemaat ci kanam. (Erreur technique, réessayez.)");
  }
});

// Handle VOICE messages
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;

  try {
    bot.sendChatAction(chatId, 'typing');

    // Download the voice file from Telegram
    const fileId = msg.voice.file_id;
    const file = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
    const fileBuffer = await downloadFile(fileUrl);

    const mimeType = msg.voice.mime_type || 'audio/ogg';

    // Transcribe
    const transcription = await transcribeVoice(fileBuffer, mimeType);

    if (!transcription) {
      await bot.sendMessage(chatId, "Dégguma sa baat bi. Jéemaat ci kanam. (Je n'ai pas compris, réessayez.)");
      return;
    }

    // Show what we heard
    await bot.sendMessage(chatId, `🎧 "${transcription}"`);

    // Get AI response
    bot.sendChatAction(chatId, 'typing');
    const aiResponse = await getAIResponse(transcription);

    // Send text response
    await bot.sendMessage(chatId, aiResponse);

    // Send voice response
    try {
      bot.sendChatAction(chatId, 'record_voice');
      const audioPath = await textToSpeech(aiResponse);
      await bot.sendVoice(chatId, audioPath);
      try { unlinkSync(audioPath); } catch {}
    } catch (ttsErr) {
      console.warn("TTS failed (text was sent):", ttsErr.message);
    }

  } catch (err) {
    console.error("Error handling voice:", err.message);
    bot.sendMessage(chatId, "Baal ma, am na jafe-jafe. Jéemaat ci kanam. (Erreur technique, réessayez.)");
  }
});

// Handle AUDIO messages (some users send audio files instead of voice)
bot.on('audio', async (msg) => {
  const chatId = msg.chat.id;
  try {
    bot.sendChatAction(chatId, 'typing');
    const fileId = msg.audio.file_id;
    const file = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
    const fileBuffer = await downloadFile(fileUrl);
    const mimeType = msg.audio.mime_type || 'audio/mpeg';

    const transcription = await transcribeVoice(fileBuffer, mimeType);
    if (!transcription) {
      await bot.sendMessage(chatId, "Dégguma sa baat bi. Jéemaat ci kanam.");
      return;
    }

    await bot.sendMessage(chatId, `🎧 "${transcription}"`);
    bot.sendChatAction(chatId, 'typing');
    const aiResponse = await getAIResponse(transcription);
    await bot.sendMessage(chatId, aiResponse);

    try {
      bot.sendChatAction(chatId, 'record_voice');
      const audioPath = await textToSpeech(aiResponse);
      await bot.sendVoice(chatId, audioPath);
      try { unlinkSync(audioPath); } catch {}
    } catch (ttsErr) {
      console.warn("TTS failed:", ttsErr.message);
    }
  } catch (err) {
    console.error("Error handling audio:", err.message);
    bot.sendMessage(chatId, "Baal ma, am na jafe-jafe. Jéemaat ci kanam.");
  }
});

console.log('✅ Bot is listening for text and voice messages.');
