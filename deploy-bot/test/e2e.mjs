// LAMP AI — end-to-end test: runs real questions through the same steps as the Telegram bot
// (understand → answer → Arabic check → Telegram formatting → memory → voice + recitations)
// and checks the result automatically. Run before every deployment:
//   GEMINI_API_KEYS=... GROQ_API_KEY=... node test/e2e.mjs [--voice]
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.LAMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lamp-e2e-'));
const WITH_VOICE = process.argv.includes('--voice');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);

const { answer } = await import('../lib/brain.js');
const { getContext, addExchange } = await import('../lib/history.js');
const { toTelegramHtml, splitMessage } = await import('../lib/telegram-format.js');
const { speak } = await import('../lib/voice.js');
const { recitations, quotedTexts } = await import('../lib/recite.js');
const S = await import('../lib/sources.js');
const { getUsage, resetUsage } = await import('../lib/ai.js');
const total = { calls: 0, in: 0, out: 0 };

const AR = '؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿';
// one line at a time: a quote written over two lines is two passages (two hemistichs)
const ARABIC_RUN = new RegExp(`[${AR}](?:[${AR} \\t\\u00a0\\u200c-\\u200f]|[A-Za-z](?=[${AR}]))*`, 'g');

// Telegram accepts only these tags, properly nested
function htmlProblems(html) {
  const stack = [];
  for (const m of html.matchAll(/<\/?([a-z]+)[^>]*>/g)) {
    const [tag, name] = m;
    if (!['b', 'i', 'u', 's', 'code', 'pre', 'a', 'blockquote', 'tg-spoiler'].includes(name)) return `balise interdite <${name}>`;
    if (tag.startsWith('</')) { if (stack.pop() !== name) return `balise mal fermée </${name}>`; } else stack.push(name);
  }
  return stack.length ? `balise non fermée <${stack.at(-1)}>` : '';
}

function checks(text, expect) {
  const problems = [];
  if (!text || text.length < 2) problems.push('réponse vide');
  for (const run of text.replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ').match(ARABIC_RUN) || []) {
    if (run.trim().split(/\s+/).length < 3) continue;
    const v = S.verifyArabic(run.trim());
    if (v.status !== 'exact') problems.push(`arabe ${v.status} : ${run.trim().slice(0, 40)}`);
  }
  if (/[A-Za-z][؀-ۿ]|[؀-ۿ][A-Za-z]/.test(text)) problems.push('lettre latine collée à de l\'arabe');
  if (text.includes('[texte arabe retiré')) problems.push('citation arabe retirée (le modèle a écrit un texte hors bibliothèque)');
  for (const part of splitMessage(text)) {
    if (part.length > 4096) problems.push(`message trop long (${part.length})`);
    const p = htmlProblems(toTelegramHtml(part));
    if (p) problems.push(`HTML : ${p}`);
  }
  if (expect.khassaid) {
    const { stem, from, to } = expect.khassaid;
    const ref = S.readKhassaid(stem, from, to, 1000);
    for (const d of ref.distiques || []) {
      const [h1, h2] = d.texte.split('\n');
      if (!text.includes(h1) || (h2 && !text.includes(h2))) { problems.push(`distique ${d.numero} manquant ou modifié`); break; }
    }
    const n = (ref.distiques || []).length;
    if (expect.khassaid.count && n !== expect.khassaid.count) problems.push(`attendu ${expect.khassaid.count} distiques, bibliothèque ${n}`);
  }
  if (expect.explained && expect.direct) problems.push('a seulement recopié le texte au lieu d\'expliquer');
  if (expect.lang && expect.gotLang !== expect.lang) problems.push(`langue ${expect.gotLang} au lieu de ${expect.lang}`);
  if (expect.mentions) for (const w of expect.mentions) if (!text.toLowerCase().includes(w.toLowerCase())) problems.push(`ne mentionne pas « ${w} »`);
  return problems;
}

const SCENARIOS = [
  { user: 'u1', q: 'Écris-moi tous les vers de Jawartu, n\'en saute aucun.', expect: { khassaid: { stem: 'jawartu', from: 1, to: 1000, count: 29 } } },
  { user: 'u1', q: 'Le dernier vers de Mawahibou', expect: { khassaid: { stem: 'mawahibu', from: -1, to: -1 } } },
  { user: 'u2', q: 'Serigne, nanga leeral ma sa ci Khassida Jawartu.', expect: { lang: 'wo', explained: true }, voice: true },
  { user: 'u2', q: 'Jawartu', expect: { mentions: ['Jawartu'] } },
  { user: 'u3', q: 'Que dit le Coran sur la patience ?', expect: { lang: 'fr' }, voice: true },
  { user: 'u3', q: 'Donne-moi le hadith sur l\'intention.', expect: { lang: 'fr' } },
  { user: 'u3', q: 'Tu te souviens de ce dont on a parlé ?', expect: { mentions: ['patience'] } },
  { user: 'u4', q: 'Écris-moi l\'ensemble des vers de Jazbu, n\'en saute aucun.', expect: { khassaid: { stem: 'jazbu', from: 1, to: 1000, count: 185 } } },
  { user: 'u5', q: 'What did Serigne Touba teach about work?', expect: { lang: 'en' } },
  { user: 'u6', q: 'Salamalekum, nanga def?', expect: { lang: 'wo' } },
];

const from = (u) => ({ first_name: `Test ${u}`, username: u });
let failures = 0;
for (const sc of SCENARIOS) {
  if (ONLY.length && !ONLY.includes(sc.user)) continue;
  const t0 = Date.now();
  resetUsage();
  let r; let problems = [];
  try {
    const ctx = await getContext(sc.user);
    r = await answer(sc.q, ctx.history, ctx);
    await addExchange(sc.user, from(sc.user), sc.q, r.text, { lang: r.lang });
    problems = checks(r.text, { ...sc.expect, gotLang: r.lang, direct: r.direct });
  } catch (e) {
    problems = [`erreur : ${e.message}`];
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (secs > 45) problems.push(`trop lent (${secs}s)`);
  let voice = '';
  if (WITH_VOICE && sc.voice && r) {
    const quoted = quotedTexts(r.text);
    const [a, rec] = await Promise.all([speak(r.text, r.lang, quoted.length > 0), quoted.length ? recitations(r.text) : []]);
    voice = ` | vocal: ${a ? 'oui' : 'NON'} | récitations: ${rec.length}/${quoted.length}`;
    if (!a) problems.push('pas de vocal');
    if (rec.length < quoted.length) problems.push(`${quoted.length - rec.length} récitation(s) manquante(s)`);
  }
  // let background work (memory update) finish before counting
  await new Promise((res) => setTimeout(res, 4000));
  const u = getUsage(); const tok = { calls: u.gemini.calls + u.groq.calls, in: u.gemini.in + u.groq.in, out: u.gemini.out + u.groq.out };
  for (const k of Object.keys(total)) total[k] += tok[k];
  voice += ` | ${tok.calls} appels IA, ${tok.in + tok.out} tokens`;
  if (problems.length) failures++;
  console.log(`${problems.length ? '❌' : '✅'} [${sc.user}] ${sc.q} (${secs}s, ${r?.text?.length || 0} car.)${voice}`);
  for (const p of problems) console.log(`     – ${p}`);
  fs.appendFileSync(path.join(process.env.LAMP_DATA_DIR, 'answers.md'), `\n\n## ${sc.q}\n\n${r?.text || ''}\n`);
}
console.log(`\nTOTAL : ${total.calls} appels IA, ${total.in} tokens envoyés + ${total.out} tokens produits = ${total.in + total.out}`);
console.log(`\n${SCENARIOS.length - failures}/${SCENARIOS.length} scénarios OK — réponses complètes : ${path.join(process.env.LAMP_DATA_DIR, 'answers.md')}`);
process.exit(failures ? 1 : 0);
