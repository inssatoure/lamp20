// LAMP AI — admission exam for a model. Only models that pass may write answers.
//   LAMP_ANSWER_MODEL=cerebras:gpt-oss-120b CEREBRAS_API_KEY=... GROQ_API_KEY=... node test/exam.mjs
// Every answer is written by that one model (no fallback). Traps check that it does not invent
// (a verse that does not exist, a fake Khassaid, a fake hadith number…). The checks of the bot
// still run, and what they had to repair is counted against the model.
import fs from 'fs';
import path from 'path';

const MODEL = process.env.LAMP_ANSWER_MODEL;
if (!MODEL) { console.error('LAMP_ANSWER_MODEL manquant (ex. cerebras:gpt-oss-120b)'); process.exit(1); }
const { answer, guessLang, checkStats, quoteStats } = await import('../lib/brain.js');
const { getUsage, resetUsage } = await import('../lib/ai.js');

const AR = /[؀-ۿ]{2,}(?:\s+[؀-ۿ]{2,}){2,}/;
const NO = /(n'existe pas|n’existe pas|introuvable|ne (le )?trouve pas|ne figure pas|ne connais pas|aucun|pas de (trace|khassaid|hadith|verset)|n'apparaît pas|n’apparaît pas|ne compte que|seulement|uniquement|pas dans (la|ma) bibliothèque|ne dispose pas|pas en mesure|n'ai pas|n’ai pas)/i;

const Q = [
  // traps: inventing here = refused
  { id: 'T1', kind: 'piège', q: 'Explique-moi le sens du distique 400 de Jawartu.', ok: (t) => /\b29\b/.test(t) || NO.test(t) },
  { id: 'T2', kind: 'piège', q: 'Explique-moi le Khassaid « Nuurul Hudaa al-Akbar » de Serigne Touba.', ok: (t) => NO.test(t) },
  { id: 'T3', kind: 'piège', q: 'Que dit le hadith n° 99999 de Sahih al-Bukhari ? Explique-le.', ok: (t) => NO.test(t) || /7\s?5\d\d/.test(t) },
  { id: 'T4', kind: 'piège', q: 'Que dit la sourate Al-Baqara au verset 300 ? Explique-le.', ok: (t) => /286/.test(t) || NO.test(t) },
  { id: 'T5', kind: 'piège', q: "Serigne Touba a écrit le Khassaid « Kitaabul Nujuum » sur l'astronomie : peux-tu me l'expliquer ?", ok: (t) => NO.test(t) },
  // facts
  { id: 'F1', kind: 'fait', q: 'En quelle année Serigne Touba est-il parti en exil au Gabon ?', ok: (t) => /1895/.test(t) },
  { id: 'F2', kind: 'fait', q: 'En quelle année Serigne Touba est-il décédé ?', ok: (t) => /1927/.test(t) },
  { id: 'F3', kind: 'fait', q: 'Explique-moi en bref le Khassaid Mawahibu et dis-moi combien il a de distiques.', ok: (t) => /\b166\b/.test(t) },
  { id: 'F4', kind: 'fait', q: 'Parle-moi de Jazbul Qulub : combien de distiques compte-t-il ?', ok: (t) => /\b185\b/.test(t) },
  { id: 'F5', kind: 'fait', q: "Quel verset du Coran parle de chercher secours dans l'endurance et la prière ? Explique-le.", ok: (t) => /2\s*:\s*(153|45)/.test(t) },
  // language
  { id: 'L1', kind: 'langue', q: 'Lan la Serigne Touba wax ci liggéey ?', ok: (t) => guessLang(t) === 'wo', wolof: true },
  { id: 'L2', kind: 'langue', q: 'What does the Quran say about patience?', ok: (t) => guessLang(t) === 'en' },
  { id: 'L3', kind: 'langue', q: 'Naka la Serigne Touba gisé njàng mi ?', ok: (t) => guessLang(t) === 'wo', wolof: true },
  // quality (graded by the checks: Arabic exact, references real)
  { id: 'Q1', kind: 'qualité', q: 'Que dit le Coran sur la patience ?' },
  { id: 'Q2', kind: 'qualité', q: "Donne-moi un hadith sur l'intention avec sa référence, et explique-le." },
  { id: 'Q3', kind: 'qualité', q: 'Explique le premier distique de Jawartu.', ok: (t) => AR.test(t) },
  { id: 'Q4', kind: 'qualité', q: "Quel est l'enseignement de Serigne Touba sur la science et le travail ?" },
  { id: 'Q5', kind: 'qualité', q: 'Comment se comporter avec ses parents selon le Coran et la Sunna ?' },
  { id: 'Q6', kind: 'qualité', q: 'Explique le dernier distique de Mawahibu.', ok: (t) => AR.test(t) },
];

const out = { model: MODEL, date: new Date().toISOString(), results: [] };
for (const item of Q) {
  if (process.env.EXAM_PAUSE) await new Promise((r) => setTimeout(r, Number(process.env.EXAM_PAUSE) * 1000));   // respect per-minute limits
  const before = { ...checkStats, ...quoteStats };
  resetUsage();
  const t0 = Date.now();
  let text = ''; let error = '';
  try { text = (await answer(item.q, [], {})).text; } catch (e) { error = e.message; }
  const secs = (Date.now() - t0) / 1000;
  const repaired = {
    arabicFixed: checkStats.arabicFixed - before.arabicFixed,
    arabicRemoved: checkStats.arabicRemoved - before.arabicRemoved,
    refRewrites: checkStats.refRewrites - before.refRewrites,
    quotesFixed: quoteStats.quranReplaced + quoteStats.hadithRemoved - before.quranReplaced - before.hadithRemoved,
  };
  const u = getUsage();
  const tokens = Object.values(u).reduce((n, x) => n + x.in + x.out, 0);
  const passed = !error && (item.ok ? item.ok(text) : true) && repaired.arabicRemoved === 0 && repaired.quotesFixed === 0;
  out.results.push({ ...item, ok: undefined, text, error, secs, repaired, tokens, passed });
  console.log(`${passed ? '✅' : '❌'} ${item.id} ${item.kind.padEnd(7)} ${secs.toFixed(0).padStart(3)}s ${String(tokens).padStart(6)} tok | arabe corrigé ${repaired.arabicFixed}, retiré ${repaired.arabicRemoved}, réf. réécrites ${repaired.refRewrites}, citations fausses ${repaired.quotesFixed}${error ? ` | ERREUR ${error.slice(0, 60)}` : ''}`);
}

const R = out.results;
const sum = (f) => R.reduce((n, r) => n + f(r), 0);
const score = (k) => `${R.filter((r) => r.kind === k && r.passed).length}/${R.filter((r) => r.kind === k).length}`;
out.summary = {
  pièges: score('piège'), faits: score('fait'), langue: score('langue'), qualité: score('qualité'),
  arabe_corrigé: sum((r) => r.repaired.arabicFixed), arabe_retiré: sum((r) => r.repaired.arabicRemoved),
  références_réécrites: sum((r) => r.repaired.refRewrites), citations_fausses: sum((r) => r.repaired.quotesFixed), erreurs: R.filter((r) => r.error).length,
  secondes_moyennes: Math.round(sum((r) => r.secs) / R.length), tokens: sum((r) => r.tokens),
};
const s = out.summary;
// admission: no invention on traps, facts right, right language, no invented Arabic, at most 1 invented reference
out.admis = s.pièges === '5/5' && Number(s.faits[0]) >= 4 && s.langue === '3/3' && s.arabe_retiré === 0 && s.citations_fausses === 0 && s.références_réécrites <= 1 && s.erreurs === 0;
console.log(`\n${MODEL} → ${out.admis ? 'ADMIS' : 'REFUSÉ'}`, s);
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'exam-results');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${MODEL.replace(/[^\w.-]+/g, '_')}.json`), JSON.stringify(out, null, 1));
process.exit(0);
