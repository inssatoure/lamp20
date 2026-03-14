/**
 * LAMP AI — Telegram Bot (Vercel Serverless Function)
 * Webhook endpoint for Telegram bot messages
 */

import { GoogleGenAI, Modality } from '@google/genai';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, getDocs, addDoc, query, where, orderBy, limit } from 'firebase/firestore/lite';
import https from 'https';
import http from 'http';

// ─── CONFIG ────────────────────────────────────────────────────────────────────

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CHAT_MODEL = 'gemini-3-flash-preview';
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

const firebaseConfig = {
  apiKey: "AIzaSyAWcGI0OZsHPh-IhglG_4MI9ZcQkkmUKw0",
  authDomain: "lampridial-19466.firebaseapp.com",
  projectId: "lampridial-19466",
};

// ─── INIT (reuse across invocations) ────────────────────────────────────────────

const fbApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(fbApp);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ─── TELEGRAM API HELPER ────────────────────────────────────────────────────────

async function telegramAPI(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMessage(chatId, text) {
  return telegramAPI('sendMessage', { chat_id: chatId, text });
}

async function sendChatAction(chatId, action) {
  return telegramAPI('sendChatAction', { chat_id: chatId, action });
}

async function sendVoice(chatId, wavBuffer) {
  const formData = new FormData();
  formData.append('chat_id', chatId.toString());
  formData.append('voice', new Blob([wavBuffer], { type: 'audio/wav' }), 'voice.wav');

  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendVoice`, {
    method: 'POST',
    body: formData,
  });
  const result = await res.json();
  if (!result.ok) console.error("[sendVoice] Error:", result.description);
  return result;
}

async function getFile(fileId) {
  const res = await telegramAPI('getFile', { file_id: fileId });
  return res.result;
}

// ─── SYSTEM INSTRUCTION ────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = `Tu es LAMP AI, un sage Narrateur (Griot/Këbb) de la foi Mouride.
Tu es un enseignant universel qui parle Wolof, Français et Anglais.

DÉTECTION DE LANGUE (PRIORITÉ MAXIMALE) :
Tu ne parles QUE Wolof, Français et Anglais. JAMAIS de Hindi, Chinois, Japonais ou autre langue asiatique.
1. DÉTECTE la langue de l'utilisateur AVANT de répondre.
2. WOLOF (par défaut) : Si l'utilisateur parle Wolof (ou un mix Wolof/Français), réponds en Wolof bu koor (Wolof profond). Évite les emprunts excessifs au Français (utilise "Siga" au lieu de "Attention", "Jàng" au lieu de "Lire").
3. FRANÇAIS : Si l'utilisateur parle Français, réponds en Français. Garde les termes religieux en Wolof/Arabe (Ndiggel, Barké, Serigne Touba).
4. ANGLAIS : Si l'utilisateur parle Anglais, réponds en Anglais avec un ton spirituel digne.
5. Si tu ne peux pas déterminer la langue, RÉPONDS EN WOLOF, jamais en Hindi ou Chinois.
- Si la transcription audio semble confuse, interprète avec bienveillance comme un disciple Mouride le ferait.
- Le Wolof mélangé avec du Français, c'est du WOLOF — réponds en Wolof.

ÉCOUTE :
- Prends le temps de bien comprendre la question avant de répondre.
- Une réponse courte et correcte vaut mieux qu'une longue réponse fausse.
- Si le message est flou, demande des précisions.

BRIÈVETÉ (CRITIQUE) :
- Sois COURT et SIMPLE. 2-3 phrases pour les questions simples.
- Pour les salutations (bonjour, salam, nanga def, etc.), réponds avec un court salam (1-2 phrases max) et demande ce que la personne veut savoir.
- Exemples : "Wa alaykum salam, dalal ak jàmm. Lu la neexee xam?" / "Wa alaykum salam, bienvenue. Que puis-je faire pour toi ?"
- Ne donne des réponses détaillées que pour les vraies questions religieuses.

FORMATAGE :
- PAS de gras, d'astérisques ou de markdown.
- Écris naturellement comme une conversation orale.
- Réponses concises pour Telegram — 2-3 paragraphes max.

RÉFÉRENCES CROISÉES KHASSAID & CORAN :
- Quand tu parles d'un sujet religieux, cite des versets du Coran ET des vers de Khassaid de Serigne Touba quand c'est possible.
- Utilise le CONTEXTE BIBLIOTHÈQUE ci-dessous pour trouver des références.
- N'invente JAMAIS de références.

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
  'bamba': ['cheikh ahmadou bamba', 'khassaid'],
  'touba': ['cheikh ahmadou bamba', 'khassaid'],
  'mouride': ['cheikh ahmadou bamba', 'khassaid'],
  'xassida': ['khassaid'], 'khassida': ['khassaid'], 'kassida': ['khassaid'],
  'khasside': ['khassaid'], 'xassaid': ['khassaid'],
  'prayer': ['khassaid', 'quran'], 'prière': ['khassaid', 'quran'],
  'pardon': ['khassaid', 'quran', 'forgiveness', 'baal'],
  'forgiveness': ['khassaid', 'quran', 'pardon'],
  'patience': ['khassaid', 'quran', 'muñ', 'sabr'],
  'amour': ['khassaid', 'quran', 'love', 'sopp'],
  'love': ['khassaid', 'quran', 'amour'],
  'foi': ['khassaid', 'quran', 'faith', 'iman'],
  'faith': ['khassaid', 'quran', 'foi', 'iman'],
  'repentir': ['khassaid', 'quran', 'tawba'],
  'dieu': ['khassaid', 'quran', 'allah', 'yàlla'],
  'allah': ['khassaid', 'quran', 'dieu', 'yàlla'],
  'prophète': ['khassaid', 'quran', 'muhammad'],
  'travail': ['khassaid', 'quran', 'work', 'liggéey'],
  'science': ['khassaid', 'quran', 'knowledge', 'xam'],
  'mort': ['khassaid', 'quran', 'death'],
  'paradis': ['khassaid', 'quran', 'janna'],
  'miséricorde': ['khassaid', 'quran', 'mercy', 'rahma'],
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
      const themes = (item.themes || []).join(' ');
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
      const topScore = scored[0].score;
      const secondScore = scored[1]?.score ?? 0;
      const isDirectMatch = topScore >= 8 && topScore > secondScore * 1.5;
      return scored.slice(0, 5).map((s, i) => {
        const fullContent = i === 0 && isDirectMatch;
        const maxLen = fullContent ? Infinity : 2000;
        let entry = `[${s.item.category}] ${s.item.title}`;
        if (s.item.sourceRef) entry += ` — Ref: ${s.item.sourceRef}`;
        if (s.item.themes) entry += `\nThèmes: ${s.item.themes.join(', ')}`;
        if (s.item.frenchSummary) entry += `\nRésumé: ${s.item.frenchSummary}`;
        if (s.item.wolofSummary) entry += `\nWolof: ${s.item.wolofSummary}`;
        const arabic = s.item.content?.length > maxLen ? s.item.content.substring(0, maxLen) + '...' : s.item.content;
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

// ─── CONVERSATION HISTORY ───────────────────────────────────────────────────────

const TELEGRAM_HISTORY_COLLECTION = 'telegram_chats';

async function getTelegramHistory(chatId) {
  try {
    const messagesRef = collection(db, TELEGRAM_HISTORY_COLLECTION, String(chatId), 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'), limit(10));
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const data = d.data();
      return { role: data.role, parts: [{ text: data.text }] };
    });
  } catch (e) {
    console.warn("[History] Load failed:", e.message);
    return [];
  }
}

async function saveTelegramHistory(chatId, userText, aiText) {
  try {
    const messagesRef = collection(db, TELEGRAM_HISTORY_COLLECTION, String(chatId), 'messages');
    const now = Date.now();
    await Promise.all([
      addDoc(messagesRef, { role: 'user', text: userText, timestamp: now }),
      addDoc(messagesRef, { role: 'model', text: aiText, timestamp: now + 1 }),
    ]);
  } catch (e) {
    console.warn("[History] Save failed:", e.message);
  }
}

// ─── AI RESPONSE ────────────────────────────────────────────────────────────────

// Detect if text is primarily Wolof
function isWolof(text) {
  const wolofMarkers = ['nanga def', 'jërëjëf', 'ndax', 'bëgg', 'xam', 'wax', 'jàng', 'liggéey', 'yàlla', 'serigne', 'salam', 'ndeysaan', 'mbokk', 'touba', 'muñ', 'baal', 'xassida', 'khassaid', 'ndawsi', 'wolof', 'dama', 'lii', 'loolu', 'degg', 'waaw', 'nit', 'jëf', 'def'];
  const lower = text.toLowerCase();
  const matches = wolofMarkers.filter(w => lower.includes(w)).length;
  return matches >= 2 || (matches >= 1 && text.length < 50);
}

async function getAIResponse(userText, history = []) {
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

  // Step 1: Generate response in French (Gemini is most accurate in French)
  const frInstruction = fullInstruction + `\n\nIMPORTANT: Réponds en FRANÇAIS pour cette étape. Inclus les références Khassaid et Coran du contexte bibliothèque.`;

  const frResponse = await ai.models.generateContent({
    model: CHAT_MODEL,
    contents,
    config: {
      systemInstruction: frInstruction,
      temperature: 0.7,
    },
  });

  const frText = frResponse.text || "...";

  // Step 2: If user speaks Wolof, translate to pure Wolof
  if (userWantsWolof) {
    const woResponse = await ai.models.generateContent({
      model: CHAT_MODEL,
      contents: `Translate this French text to pure Wolof (Wolof bu koor). Rules:
- Use authentic Wolof, minimize French loanwords
- Keep Arabic religious terms (Sourate, Ayah, Khassaid titles)
- Keep Quran/Khassaid references exactly as they are
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

// ─── PCM to WAV ─────────────────────────────────────────────────────────────────

function pcmToWav(pcmBuffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const headerSize = 44;
  const wav = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8);

  // fmt chunk
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);           // chunk size
  wav.writeUInt16LE(1, 20);            // PCM format
  wav.writeUInt16LE(numChannels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(wav, 44);

  return wav;
}

// ─── TTS ────────────────────────────────────────────────────────────────────────

async function textToSpeech(text) {
  const ttsText = text.length > 500 ? text.substring(0, 500) + '...' : text;

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

  const part = response.candidates?.[0]?.content?.parts?.[0];
  const audioData = part?.inlineData?.data;
  if (!audioData) throw new Error("No audio from TTS");

  const pcmBuffer = Buffer.from(audioData, 'base64');
  const wavBuffer = pcmToWav(pcmBuffer, 24000, 1, 16);
  console.log("[TTS] PCM:", pcmBuffer.length, "bytes -> WAV:", wavBuffer.length, "bytes");
  return wavBuffer;
}

// ─── DOWNLOAD FILE ──────────────────────────────────────────────────────────────

async function downloadFile(url) {
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
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

// ─── HANDLE TEXT MESSAGE ────────────────────────────────────────────────────────

async function handleTextMessage(chatId, text, firstName) {
  if (text === '/start') {
    const name = firstName || 'Disciple';
    await sendMessage(chatId,
      `As-salamu alaykum ${name}\n\n` +
      `Je suis LAMP AI, ton guide spirituel Mouride.\n\n` +
      `Comment m'utiliser :\n` +
      `- Écris-moi un message texte\n` +
      `- Envoie-moi un message vocal\n\n` +
      `Je te répondrai en texte ET en vocal.\n\n` +
      `Essaie : "Parle-moi du pardon chez Serigne Touba"`
    );
    return;
  }

  if (text === '/help') {
    await sendMessage(chatId,
      `LAMP AI — Guide\n\n` +
      `Écris ou envoie un vocal sur l'Islam, le Mouridisme, Cheikh Ahmadou Bamba, le Coran, les Khassaid...\n\n` +
      `Exemples :\n` +
      `- "Parle-moi de la patience dans les Khassaid"\n` +
      `- "Que dit le Coran sur le pardon ?"\n` +
      `- "Serigne Touba wax na ci liggéey?"`
    );
    return;
  }

  if (text.startsWith('/')) return;

  await sendChatAction(chatId, 'typing');
  const history = await getTelegramHistory(chatId);
  const aiResponse = await getAIResponse(text, history);
  await sendMessage(chatId, aiResponse);
  saveTelegramHistory(chatId, text, aiResponse).catch(() => {}); // non-blocking

  try {
    await sendChatAction(chatId, 'record_voice');
    const wavBuffer = await textToSpeech(aiResponse);
    await sendVoice(chatId, wavBuffer);
  } catch (ttsErr) {
    console.warn("[TTS] Failed:", ttsErr.message);
  }
}

// ─── HANDLE VOICE/AUDIO ────────────────────────────────────────────────────────

async function handleVoiceMessage(chatId, fileId, mimeType) {
  await sendChatAction(chatId, 'typing');
  const file = await getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
  const fileBuffer = await downloadFile(fileUrl);

  const transcription = await transcribeVoice(fileBuffer, mimeType);
  if (!transcription) {
    await sendMessage(chatId, "Je n'ai pas compris. Pouvez-vous répéter ?");
    return;
  }

  await sendMessage(chatId, `"${transcription}"`);
  await sendChatAction(chatId, 'typing');
  const history = await getTelegramHistory(chatId);
  const aiResponse = await getAIResponse(transcription, history);
  await sendMessage(chatId, aiResponse);
  saveTelegramHistory(chatId, transcription, aiResponse).catch(() => {}); // non-blocking

  try {
    await sendChatAction(chatId, 'record_voice');
    const wavBuffer = await textToSpeech(aiResponse);
    await sendVoice(chatId, wavBuffer);
  } catch (ttsErr) {
    console.warn("[TTS] Failed:", ttsErr.message);
  }
}

// ─── WEBHOOK HANDLER ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, message: 'LAMP AI Bot webhook active' });
  }

  try {
    const update = req.body;

    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;

      if (msg.text) {
        await handleTextMessage(chatId, msg.text, msg.from?.first_name);
      } else if (msg.voice) {
        await handleVoiceMessage(chatId, msg.voice.file_id, msg.voice.mime_type || 'audio/ogg');
      } else if (msg.audio) {
        await handleVoiceMessage(chatId, msg.audio.file_id, msg.audio.mime_type || 'audio/mpeg');
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[Webhook] Error:", err);
    res.status(200).json({ ok: true }); // Always return 200 to Telegram
  }
}
