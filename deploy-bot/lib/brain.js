// LAMP AI — how a question becomes an answer
//   1. understand : language, standalone question, topic, Khassaid, search words (1 light call)
//   2. retrieve   : Coran + hadiths + Khassaids from the verified library (no AI)
//   3. answer     : the model writes the answer and may consult the library again (tools)
//   4. check      : every reference in the answer must come from the library, otherwise it is rewritten
import { generate, generateText, parseJson } from './ai.js';
import { buildContext } from './prompt.js';
import { MAX_TOOL_ROUNDS } from './config.js';
import * as S from './sources.js';

// ─── 1. understand ───────────────────────────────────────────────────────────
function historyText(history, max = 6) {
  return history.slice(-max).map((m) => `${m.role === 'user' ? 'Utilisateur' : 'LAMP'}: ${m.text.slice(0, 300)}`).join('\n');
}

const WOLOF_WORDS = /(?<![\p{L}])(naka|nanga|nga|dafa|dama|dañu|danu|bëgg|begg|xam|xamul|wax|lan|lu|ndax|mooy|moo|dina|jërëjëf|jerejef|waaw|déedéet|deedeet|yàlla|yalla|ci|ak|bi|yi|gi|li|dundee|dund|gisé|gise|liggéey|ligeey|jàng|jang|sama|yow|moom|ñoom|amul|mën|men|wolof)(?![\p{L}])/giu;
export function guessLang(text) {
  if (/\b(r[ée]ponds?|wax|explique|parle)\b.{0,15}\bwolof\b/i.test(text)) return 'wo';
  const hits = (text.match(WOLOF_WORDS) || []).length;
  if (hits >= 2 || (hits === 1 && text.split(/\s+/).length <= 4)) return 'wo';
  if (/\b(what|how|why|who|is|the|please|tell me)\b/i.test(text) && !/\b(le|la|les|est|quoi|qui)\b/i.test(text)) return 'en';
  return 'fr';
}

export async function understand(text, history) {
  const fallback = {
    lang: guessLang(text), question: text, topic: '', khassaid: S.findKhassaid(text) || '',
    mots_cles: S.keywords(text).join(' '), coran: [], texte_seul: false, debut: null, fin: null,
  };
  const raw = await generateText({
    contents: `${history.length ? `Historique :\n${historyText(history)}\n\n` : ''}Nouveau message : "${text}"

Analyse le message (dans le contexte de l'historique) et réponds en JSON :
{"lang":"fr|wo|en", "question":"...", "topic":"...", "khassaid":"...", "mots_cles":"...", "coran":[], "texte_seul":false, "debut":null, "fin":null}
- lang : langue voulue pour la RÉPONSE. "wo" si le message est en wolof ou demande le wolof. "Serigne Touba", "Khassaid", "Mouride" sont des noms propres, pas du wolof.
- question : la question reformulée en français, complète et autonome (résous les suites comme "explique le premier vers" grâce à l'historique).
- topic : le sujet en 3 à 7 mots.
- khassaid : titre du Khassaid concerné (message ou historique), sinon "".
- mots_cles : 3 à 6 mots-clés FRANÇAIS pour chercher dans les hadiths (ex: "patience épreuve endurance").
- coran : 0 à 3 références "sourate:verset" de versets qui parlent DIRECTEMENT du sujet (ex: ["2:153","2:155"]). Seulement celles dont tu es sûr, sinon [].
- texte_seul : true seulement si la personne veut juste lire le texte d'un Khassaid sans explication.
- debut / fin : numéros de distiques demandés (ex: "le premier vers" → 1 et 1 ; "les 10 premiers" → 1 et 10), sinon null.`,
    config: { temperature: 0.1, responseMimeType: 'application/json' },
  }, 'light', true);
  try {
    const o = parseJson(raw);
    const khassaid = S.findKhassaid(o.khassaid) || S.findKhassaid(text) || '';
    return {
      lang: ['fr', 'wo', 'en'].includes(o.lang) ? o.lang : fallback.lang,
      question: String(o.question || text).trim(),
      topic: String(o.topic || '').trim(),
      khassaid,
      mots_cles: String(o.mots_cles || fallback.mots_cles),
      coran: (Array.isArray(o.coran) ? o.coran : []).map(String).filter((r) => /^\d{1,3}:\d{1,3}$/.test(r)).slice(0, 3),
      texte_seul: o.texte_seul === true && !!khassaid,
      debut: Number.isInteger(o.debut) ? o.debut : null,
      fin: Number.isInteger(o.fin) ? o.fin : null,
    };
  } catch {
    if (raw) console.warn('[Brain] understanding not parsable, using fallback');
    // follow-up without a name: reuse the Khassaid of the conversation
    if (!fallback.khassaid) fallback.khassaid = [...history].reverse().map((m) => S.findKhassaid(m.text)).find(Boolean) || '';
    return fallback;
  }
}

// ─── 2. retrieve ─────────────────────────────────────────────────────────────
function fmtKhassaid(r) {
  if (r.erreur && !r.distiques) return `[Khassaid] ${r.erreur}`;
  return `[Khassaid ${r.titre} — ${r.nombre_de_distiques} distiques au total]${r.erreur ? ` ${r.erreur}` : ''}\n` +
    (r.distiques || []).map((d) => `Distique ${d.numero} :\n${d.texte}`).join('\n');
}

async function retrieve(u, refs) {
  const parts = [];
  const tasks = [];
  if (u.khassaid) {
    const r = S.readKhassaid(u.khassaid, u.debut || 1, u.fin || (u.debut ? u.debut : 10));
    (r.distiques || []).forEach((d) => refs.add(`distique ${d.numero}`));
    if (r.nombre_de_distiques) refs.add(String(r.nombre_de_distiques));
    parts.push(fmtKhassaid(r));
    tasks.push(S.khassaidSummary(u.khassaid).then((s) => {
      if (s?.resume || s?.themes?.length) parts.push(`[Résumé du ${S.khassaidInfo(u.khassaid).titre} (base LAMP)] ${s.resume} ${s.themes?.length ? `Thèmes : ${s.themes.join(', ')}` : ''}`);
    }).catch(() => {}));
  }
  const topic = [u.topic, u.question].filter(Boolean).join('. ');
  tasks.push(S.searchKhassaid(topic, u.khassaid ? 3 : 5).then((hits) => {
    if (hits.length) parts.push('[Khassaids sur ce sujet]\n' + hits.map((h) => {
      refs.add(`distique ${h.distique}`);
      return `${h.khassaid}, distique ${h.distique} :\n${h.texte}`;
    }).join('\n'));
  }).catch(() => {}));
  // Coran: verses the model suggested, read from the real text (a wrong reference just reads another verse),
  // completed by a keyword search
  const proposed = u.coran.flatMap((ref) => {
    const [s, v] = ref.split(':');
    const r = S.readQuran(s, v);
    return (r.versets || []).map((x) => ({ ...x, sourate: r.sourate.replace(/^\d+\.\s*/, '').replace(/\s*\(.*$/, '') }));
  });
  const q = [...proposed, ...S.searchQuran(u.mots_cles, 2).filter((x) => !proposed.some((p) => p.reference === x.reference))].slice(0, 4);
  if (q.length) parts.push('[Coran]\n' + q.map((v) => { refs.add(v.reference); return `${v.reference} (${v.sourate}) : ${v.arabe}\n« ${v.francais} »`; }).join('\n'));
  const h = S.searchHadith(u.mots_cles, null, 3);
  if (h.length) parts.push('[Hadiths]\n' + h.map((x) => { refs.add(String(x.numero)); return `${x.recueil} n°${x.numero}${x.authenticite ? ` [${x.authenticite}]` : ''} : « ${x.texte} »`; }).join('\n'));
  await Promise.all(tasks);
  return parts.join('\n\n');
}

// ─── tools the model can call during the answer ──────────────────────────────
const TOOLS = [{
  functionDeclarations: [
    { name: 'chercher_coran', description: 'Cherche des versets du Coran par mots-clés français. Renvoie référence, arabe et traduction Hamidullah.',
      parameters: { type: 'object', properties: { mots_cles: { type: 'string' } }, required: ['mots_cles'] } },
    { name: 'lire_coran', description: 'Texte exact d\'un ou plusieurs versets (max 10).',
      parameters: { type: 'object', properties: { sourate: { type: 'string', description: 'numéro ou nom' }, verset: { type: 'integer' }, jusqua: { type: 'integer' } }, required: ['sourate', 'verset'] } },
    { name: 'chercher_hadith', description: 'Cherche des hadiths par mots-clés français dans Bukhari, Muslim, Abu Dawud, Malik, Nawawi.',
      parameters: { type: 'object', properties: { mots_cles: { type: 'string' }, recueil: { type: 'string' } }, required: ['mots_cles'] } },
    { name: 'lire_hadith', description: 'Texte exact d\'un hadith par recueil et numéro.',
      parameters: { type: 'object', properties: { recueil: { type: 'string' }, numero: { type: 'integer' } }, required: ['recueil', 'numero'] } },
    { name: 'chercher_khassaid', description: 'Cherche dans les Khassaids de Serigne Touba les distiques qui parlent d\'un sujet (recherche par le sens).',
      parameters: { type: 'object', properties: { sujet: { type: 'string' } }, required: ['sujet'] } },
    { name: 'lire_khassaid', description: 'Texte arabe exact de distiques d\'un Khassaid (max 40) et son nombre total de distiques.',
      parameters: { type: 'object', properties: { titre: { type: 'string' }, debut: { type: 'integer' }, fin: { type: 'integer' } }, required: ['titre'] } },
  ],
}];

async function runTool(name, a, refs) {
  let out;
  switch (name) {
    case 'chercher_coran': out = S.searchQuran(a.mots_cles, 5); out.forEach((v) => refs.add(v.reference)); break;
    case 'lire_coran': out = S.readQuran(a.sourate, a.verset, a.jusqua); (out.versets || []).forEach((v) => refs.add(v.reference)); break;
    case 'chercher_hadith': out = S.searchHadith(a.mots_cles, a.recueil, 4); out.forEach((h) => refs.add(String(h.numero))); break;
    case 'lire_hadith': out = S.readHadith(a.recueil, a.numero); if (out.numero) refs.add(String(out.numero)); break;
    case 'chercher_khassaid': out = await S.searchKhassaid(a.sujet, 6); out.forEach((h) => refs.add(`distique ${h.distique}`)); break;
    case 'lire_khassaid': out = S.readKhassaid(a.titre, a.debut || 1, a.fin);
      (out.distiques || []).forEach((d) => refs.add(`distique ${d.numero}`)); if (out.nombre_de_distiques) refs.add(String(out.nombre_de_distiques)); break;
    default: out = { erreur: `outil inconnu ${name}` };
  }
  console.log(`[Tool] ${name}(${JSON.stringify(a).slice(0, 80)}) → ${Array.isArray(out) ? out.length + ' résultat(s)' : out.erreur ? 'erreur' : 'ok'}`);
  return Array.isArray(out) ? { resultats: out, ...(out.length ? {} : { note: 'Aucun résultat. Essaie d\'autres mots-clés ou réponds sans citation.' }) } : out;
}

// ─── 4. check references ─────────────────────────────────────────────────────
// Finds Coran references (2:153), hadith numbers (n° 1283) and distique numbers that did not come from the library.
export function unverifiedRefs(answer, refs) {
  const bad = new Set();
  const quran = (s, v) => { if (Number(s) >= 1 && Number(s) <= 114 && !refs.has(`${s}:${v}`)) bad.add(`${s}:${v}`); };
  for (const m of answer.matchAll(/\b(\d{1,3}):(\d{1,3})\b/g)) quran(m[1], m[2]);
  for (const m of answer.matchAll(/sourate\s*(\d{1,3})\s*,?\s*(?:verset|ayah?|v\.)\s*(\d{1,3})/gi)) quran(m[1], m[2]);
  for (const m of answer.matchAll(/(?:hadith|bukh?ari|boukhari|muslim|dawud|malik|nawawi|tirmidhi)[^.\n]{0,40}?(?:n°|no\.|num[ée]ro|#)\s*(\d{1,5})\b/gi)) {
    if (!refs.has(m[1])) bad.add(`hadith n°${m[1]}`);
  }
  for (const m of answer.matchAll(/distiques?\s*(?:n°\s*)?(\d{1,4})\b/gi)) {
    if (!refs.has(`distique ${m[1]}`) && !refs.has(m[1])) bad.add(`distique ${m[1]}`);
  }
  return [...bad];
}

// ─── main ────────────────────────────────────────────────────────────────────
/** history: [{ role: 'user'|'model', text }]. Returns { text, lang, direct } */
export async function answer(text, history = []) {
  const t0 = Date.now();
  const u = await understand(text, history);
  console.log(`[Brain] lang=${u.lang} khassaid=${u.khassaid || '-'} topic="${u.topic}" q="${u.question.slice(0, 80)}"`);

  // Reading a Khassaid text only: served straight from the file, no AI involved.
  if (u.texte_seul) {
    const r = S.readKhassaid(u.khassaid, u.debut || 1, u.fin || (u.debut ? u.debut : 10));
    const body = (r.distiques || []).map((d) => `${d.numero}. ${d.texte.replace('\n', '\n    ')}`).join('\n\n');
    return { lang: u.lang, direct: true, text: `📖 **${r.titre}** — distiques ${r.distiques?.[0]?.numero || ''}${r.distiques?.length > 1 ? `-${r.distiques.at(-1).numero}` : ''} sur ${r.nombre_de_distiques}${r.erreur ? `\n${r.erreur}` : ''}\n\n${body}` };
  }

  const refs = new Set();
  const [sources, notes] = await Promise.all([retrieve(u, refs), S.reviewedNotes().catch(() => '')]);
  const systemInstruction = buildContext({ ...u, khassaid: u.khassaid ? S.khassaidInfo(u.khassaid).titre : '', sources, notes, khassaidList: S.listKhassaids() });

  const contents = [
    ...history.slice(-8).map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: 'user', parts: [{ text }] },
  ];
  const config = { systemInstruction, temperature: 0.3, tools: TOOLS };

  let reply = '';
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const r = await generate({ contents, config: round === MAX_TOOL_ROUNDS ? { systemInstruction, temperature: 0.3 } : config }, 'answer');
    const calls = r.groq ? [] : (r.functionCalls || []);
    if (!calls.length) { reply = (r.text || '').trim(); break; }
    contents.push(r.candidates[0].content);
    const responses = [];
    for (const c of calls) responses.push({ functionResponse: { name: c.name, ...(c.id ? { id: c.id } : {}), response: await runTool(c.name, c.args || {}, refs) } });
    contents.push({ role: 'user', parts: responses });
  }
  if (!reply) throw new Error('Empty answer');

  // Any number that did not come from the library → one rewrite without it
  const bad = unverifiedRefs(reply, refs);
  if (bad.length) {
    console.warn(`[Check] unverified references: ${bad.join(', ')} → rewrite`);
    const fixed = await generateText({
      contents: [...contents, { role: 'model', parts: [{ text: reply }] },
        { role: 'user', parts: [{ text: `Vérification : ces références ne viennent pas de la bibliothèque : ${bad.join(', ')}. Réécris ta réponse complète en gardant tout le reste, mais enlève ces références (ou remplace-les par le sens général sans numéro). Ne mentionne pas cette vérification.` }] }],
      config: { systemInstruction, temperature: 0.2 },
    }, 'answer', true);
    if (fixed && unverifiedRefs(fixed, refs).length < bad.length) reply = fixed;
  }
  console.log(`[Brain] answered in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { text: reply, lang: u.lang, direct: false };
}

/** Speech → text (Gemini hears Wolof, French, Arabic). */
export async function transcribe(buffer, mimeType) {
  return generateText({
    contents: [{ role: 'user', parts: [
      { inlineData: { mimeType, data: buffer.toString('base64') } },
      { text: 'Transcris exactement ce qui est dit, dans la langue parlée (wolof, français, arabe ou anglais). Réponds uniquement par la transcription. Si rien n\'est audible, réponds par un texte vide.' },
    ] }],
    config: { temperature: 0 },
  }, 'answer');
}
