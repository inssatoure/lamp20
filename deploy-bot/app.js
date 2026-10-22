/**
 * LAMP AI — Telegram bot (polling, no webhook needed)
 * Start:   node app.js        Env: TELEGRAM_TOKEN, GEMINI_API_KEY  (optional: GROQ_API_KEY, LAMP_ROOT_DIR)
 *
 * This file only talks to Telegram. The rest lives in lib/:
 *   brain.js   understand → sources → answer → check references
 *   sources.js Coran, hadiths, Khassaids (verified texts only)
 *   prompt.js  who LAMP is and its rules
 *   ai.js      model calls with timeout and fallback
 *   voice.js   voice replies · history.js memory · telegram-format.js safe messages
 */
import TelegramBot from 'node-telegram-bot-api';
import { TELEGRAM_TOKEN, GEMINI_API_KEY, VOICE_REPLY } from './lib/config.js';

if (!TELEGRAM_TOKEN || !GEMINI_API_KEY) {
  console.error('[LAMP] Missing env vars: TELEGRAM_TOKEN and GEMINI_API_KEY are required');
  process.exit(1);
}

const { answer, transcribe } = await import('./lib/brain.js');
const { warmUp, listKhassaids } = await import('./lib/sources.js');
const { getContext, addExchange, newSession, forgetUser, activeChats } = await import('./lib/history.js');
const { startAdmin } = await import('./lib/admin.js');
const { toTelegramHtml, toPlain, splitMessage } = await import('./lib/telegram-format.js');
const { speak } = await import('./lib/voice.js');

// ─── never die on an unexpected error ────────────────────────────────────────
process.on('unhandledRejection', (e) => console.error('[LAMP] unhandled rejection:', e?.message || e));
process.on('uncaughtException', (e) => console.error('[LAMP] uncaught exception:', e?.message || e));

warmUp();
const STARTED = Math.floor(Date.now() / 1000);
const bot = new TelegramBot(TELEGRAM_TOKEN, {
  polling: { interval: 1000, autoStart: false, params: { timeout: 30, allowed_updates: ['message'] } },
});
// Started at the END of this file, once every handler is registered (no message lost).

// ─── polling health ──────────────────────────────────────────────────────────
let restarting = false;
bot.on('polling_error', async (err) => {
  const msg = err?.message || String(err);
  if (/409|Conflict/i.test(msg)) {
    console.error('[LAMP] 409 Conflict: another copy of this bot is running with the same token. Stop it (old server, pm2, cPanel).');
    return;
  }
  if (/401|Unauthorized/i.test(msg)) {
    console.error('[LAMP] 401: TELEGRAM_TOKEN is invalid or revoked. Exiting.');
    process.exit(1);
  }
  console.warn('[LAMP] polling error:', msg.slice(0, 160));
  if (/EFATAL/i.test(msg) && !restarting) {          // network drop: restart polling cleanly
    restarting = true;
    try { await bot.stopPolling({ cancel: true }); } catch { /* ignore */ }
    setTimeout(async () => {
      try { await bot.startPolling({ restart: true }); console.log('[LAMP] polling restarted'); } catch (e) { console.error('[LAMP] restart failed:', e.message); }
      restarting = false;
    }, 5000);
  }
});

setInterval(() => console.log(`[LAMP] alive — ${new Date().toISOString()} — ${activeChats()} chats`), 5 * 60_000).unref();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`[LAMP] ${sig} — stopping`);
    try { await bot.stopPolling(); } catch { /* ignore */ }
    process.exit(0);
  });
}

// ─── sending (safe) ──────────────────────────────────────────────────────────
async function send(chatId, md, opts = {}) {
  for (const part of splitMessage(md)) {
    try {
      await bot.sendMessage(chatId, toTelegramHtml(part), { parse_mode: 'HTML', disable_web_page_preview: true, ...opts });
    } catch {
      try { await bot.sendMessage(chatId, toPlain(part), { disable_web_page_preview: true, ...opts }); }
      catch (e) { console.error('[Send] failed:', e.message); }
    }
  }
}

async function sendVoiceReply(chatId, text) {
  if (!VOICE_REPLY) return;
  try {
    bot.sendChatAction(chatId, 'record_voice').catch(() => {});
    const audio = await speak(text);
    if (!audio) return;
    const fileOpts = { filename: audio.filename, contentType: audio.contentType };
    if (audio.isVoice) await bot.sendVoice(chatId, audio.buffer, {}, fileOpts);
    else await bot.sendAudio(chatId, audio.buffer, { title: 'LAMP AI', performer: 'LAMP' }, fileOpts);
  } catch (e) {
    console.warn('[Voice] reply skipped:', e.message.slice(0, 120));    // text was already sent: never an error for the user
  }
}

function keepTyping(chatId) {
  bot.sendChatAction(chatId, 'typing').catch(() => {});
  const t = setInterval(() => bot.sendChatAction(chatId, 'typing').catch(() => {}), 4500);
  return () => clearInterval(t);
}

const BUSY_MSG = {
  fr: "Baal ma, LAMP est très sollicité en ce moment. Réessaie dans une minute, s'il te plaît.",
  wo: 'Baal ma, LAMP dafa xèy lool léegi. Jéemaatal ci benn simili.',
  en: 'Sorry, LAMP is very busy right now. Please try again in a minute.',
};

// ─── one message at a time per chat (keeps the conversation in order) ────────
const queues = new Map();
function enqueue(chatId, job) {
  const prev = queues.get(chatId) || Promise.resolve();
  const next = prev.then(job, job).catch((e) => console.error('[Queue]', e?.message || e));
  queues.set(chatId, next);
  next.finally(() => { if (queues.get(chatId) === next) queues.delete(chatId); });
}

async function handleQuestion(msg, question, { fromVoice = false } = {}) {
  const chatId = msg.chat.id;
  const stop = keepTyping(chatId);
  let lang = 'fr';
  try {
    const ctx = await getContext(chatId);
    const r = await answer(question, ctx.history, ctx);
    lang = r.lang;
    stop();
    await send(chatId, r.text);
    await addExchange(chatId, msg.from, question, r.text, { lang, voice: fromVoice });
    if (!r.direct) await sendVoiceReply(chatId, r.text);
  } catch (e) {
    stop();
    console.error('[Answer] failed:', e?.message || e);
    await send(chatId, BUSY_MSG[lang] || BUSY_MSG.fr);
  }
}

const isStale = (msg) => msg.date < STARTED - 120;     // ignore the backlog piled up while the bot was off

// ─── commands ────────────────────────────────────────────────────────────────
bot.onText(/^\/start\b/, (msg) => {
  const name = msg.from?.first_name || '';
  send(msg.chat.id,
    `As-salamu alaykum ${name} 🤍\n\n` +
    `Je suis **LAMP AI**, un talibé de Serigne Touba. Je réponds à tes questions à la lumière du **Coran**, ` +
    `de la **Sunna** du Prophète (ﷺ) et des **enseignements de Cheikh Ahmadou Bamba**.\n\n` +
    `Écris-moi ou envoie un vocal, en français, en wolof ou en anglais.\n\n` +
    `Essaie :\n• Que disent les Khassaids sur la patience ?\n• Lis-moi les 5 premiers distiques de Jazbul Qulub\n• Naka la Serigne Touba gisé liggéey ?\n\n` +
    `Je me souviens de nos échanges d'une fois sur l'autre. Nos conversations sont enregistrées pour cela et pour améliorer LAMP.\n\n` +
    `/khassaids — la liste des Khassaids de la bibliothèque\n/clear — nouvelle conversation\n/oublie — effacer tout ce que je sais de toi`);
});

bot.onText(/^\/help\b/, (msg) => send(msg.chat.id,
  `**LAMP AI** — pose ta question par écrit ou en vocal.\n\n` +
  `• Questions sur l'islam, le Coran, les hadiths, la vie de Serigne Touba, la voie mouride, la vie de tous les jours\n` +
  `• Texte d'un Khassaid : « Donne-moi les 10 premiers distiques de Mawahibu »\n` +
  `• Wolof : « Lan la Serigne Touba wax ci muñ ? »\n\n` +
  `Les citations viennent d'une bibliothèque vérifiée (Coran, Bukhari, Muslim, Abu Dawud, Malik, Nawawi, 122 Khassaids).\n\n` +
  `/khassaids — liste · /clear — nouvelle conversation · /oublie — tout effacer`));

bot.onText(/^\/clear\b/, async (msg) => {
  await newSession(msg.chat.id).catch(() => {});
  send(msg.chat.id, 'Nouvelle conversation. Je garde en mémoire ce que je sais de toi (/oublie pour tout effacer). As-salamu alaykum.');
});

bot.onText(/^\/oublie\b/, async (msg) => {
  try {
    await forgetUser(msg.chat.id);
    send(msg.chat.id, "C'est fait : j'ai effacé nos conversations et tout ce que je savais de toi.");
  } catch (e) {
    console.error('[Forget]', e.message);
    send(msg.chat.id, "Je n'ai pas pu tout effacer. Réessaie dans un instant.");
  }
});

bot.onText(/^\/khassaids\b/, (msg) => send(msg.chat.id, `📚 **Khassaids de la bibliothèque** (nombre de distiques) :\n\n${listKhassaids()}`));

// ─── messages ────────────────────────────────────────────────────────────────
bot.on('message', (msg) => {
  if (isStale(msg)) return;
  const chatId = msg.chat.id;

  if (msg.text) {
    if (msg.text.startsWith('/')) return;              // commands handled above
    console.log(`[Message] ${chatId}: ${msg.text.slice(0, 80)}`);
    enqueue(chatId, () => handleQuestion(msg, msg.text.trim()));
    return;
  }

  const media = msg.voice || msg.audio || msg.video_note;
  if (media) {
    enqueue(chatId, async () => {
      const stop = keepTyping(chatId);
      try {
        if (media.file_size && media.file_size > 19 * 1024 * 1024) { stop(); return send(chatId, 'Ce fichier audio est trop long. Envoie un vocal plus court, s\'il te plaît.'); }
        const link = await bot.getFileLink(media.file_id);
        const res = await fetch(link);
        if (!res.ok) throw new Error(`download ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const mime = msg.voice ? 'audio/ogg' : msg.video_note ? 'video/mp4' : (media.mime_type || 'audio/mpeg');
        const said = (await transcribe(buf, mime)).trim();
        stop();
        if (!said) return send(chatId, "Je n'ai pas bien entendu. Peux-tu répéter ou l'écrire ?");
        console.log(`[Voice] ${chatId}: ${said.slice(0, 80)}`);
        await send(chatId, `🎙️ _${said}_`);
        await handleQuestion(msg, said, { fromVoice: true });
      } catch (e) {
        stop();
        console.error('[Voice] failed:', e?.message || e);
        await send(chatId, BUSY_MSG.fr);
      }
    });
    return;
  }

  if (msg.photo || msg.document || msg.sticker || msg.video) {
    send(chatId, 'Je comprends le texte et les messages vocaux. Écris-moi ou envoie un vocal 🙂');
  }
});

// ─── start ───────────────────────────────────────────────────────────────────
// An old webhook on this token would block polling (409): remove it first.
bot.deleteWebHook()
  .catch((e) => console.warn('[LAMP] deleteWebHook:', e.message))
  .finally(() => {
    bot.startPolling().catch((e) => console.error('[LAMP] startPolling:', e.message));
    bot.getMe().then((me) => console.log(`[LAMP] Started — polling Telegram as @${me.username}`))
      .catch((e) => console.error('[LAMP] getMe failed:', e.message));
  });

// Admin page to read the conversations (only if LAMP_ADMIN_PASSWORD and PORT are set)
startAdmin();
