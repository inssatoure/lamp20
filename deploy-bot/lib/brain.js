// LAMP AI — how a question becomes an answer
//   1. understand : language, standalone question, topic, Khassaid, search words (1 light call)
//   2. retrieve   : Coran + hadiths + Khassaids from the verified library (no AI)
//   3. answer     : the model writes the answer and may consult the library again (tools)
//   4. check      : every reference in the answer must come from the library, otherwise it is rewritten
import { generate, generateText, parseJson, groqTranscribe, elevenTranscribe } from './ai.js';
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

// "Lis-moi le dernier vers de X", "tous les vers de X", "explique X"… read from the words themselves:
// the understanding model sometimes gets these wrong, and they decide between copying the library
// text and explaining it.
const EXPLAIN = /(expli|leeral|firi|parle|wax ma|wax ci|connais|xam nga|sens|signifi|enseign|pourquoi|comment|teach|explain|meaning)/i;
const NUM = '(\\d{1,3})';
export function readingRequest(text) {
  const t = String(text).toLowerCase();
  if (EXPLAIN.test(t)) return { texte_seul: false };
  let m;
  const read = /(écri|ecri|lis\b|lire|donne|montre|affiche|récite|recite|bind|jàng|jang|vers|distique|bëyit|beyit)/i.test(t);
  if (!read) return null;
  if (/(tous les|ensemble des|en entier|tout le|toute la|texte complet|complet|lépp|yépp|yepp)/.test(t)) return { texte_seul: true, debut: 1, fin: 100000 };
  if ((m = t.match(new RegExp(`${NUM}\\s*derniers`)))) return { texte_seul: true, debut: -Number(m[1]), fin: -1 };
  if (/dernier/.test(t)) return { texte_seul: true, debut: -1, fin: -1 };
  if ((m = t.match(new RegExp(`${NUM}\\s*premiers`)))) return { texte_seul: true, debut: 1, fin: Number(m[1]) };
  if ((m = t.match(new RegExp(`(?:du|de|vers|distique)\\s*${NUM}\\s*(?:au|à|a|-)\\s*(?:vers\\s*|distique\\s*)?${NUM}`)))) return { texte_seul: true, debut: Number(m[1]), fin: Number(m[2]) };
  if (/premier/.test(t)) return { texte_seul: true, debut: 1, fin: 1 };
  if ((m = t.match(new RegExp(`(?:vers|distique|bëyit|beyit)\\s*(?:n°|numéro|no\\.?)?\\s*${NUM}`)))) return { texte_seul: true, debut: Number(m[1]), fin: Number(m[1]) };
  return null;
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
- lang : langue voulue pour la RÉPONSE = la langue du message : "fr" français, "en" anglais, "wo" wolof (ou si la personne demande une langue précise). "Serigne Touba", "Khassaid", "Mouride", les titres de Khassaids sont des noms propres : ils ne donnent pas la langue. Si le message ne contient qu'un nom ou un titre (ex. "Jawartu"), garde la langue des messages précédents.
- question : la question reformulée en français, complète et autonome (wolof : « leeral » = expliquer, « firi » = traduire/expliquer, « wax ma ci » = parle-moi de, « nanga def » = comment vas-tu) (résous les suites comme "explique le premier vers" grâce à l'historique).
- topic : le sujet en 3 à 7 mots.
- khassaid : titre du Khassaid concerné (message ou historique), sinon "".
- mots_cles : 3 à 6 mots-clés FRANÇAIS pour chercher dans les hadiths (ex: "patience épreuve endurance").
- coran : 0 à 3 références "sourate:verset" de versets qui parlent DIRECTEMENT du sujet (ex: ["2:153","2:155"]). Seulement celles dont tu es sûr, sinon [].
- texte_seul : true seulement si la personne veut juste lire le texte d'un Khassaid sans explication (« écris / lis / donne-moi les vers », « tous les vers »). false si elle veut comprendre : « explique », « parle-moi de », « leeral ma », « firi », « wax ma ci », « tu connais ».
- debut / fin : distiques demandés. Exemples : "le premier vers" → 1 et 1 ; "les 10 premiers" → 1 et 10 ;
  "du vers 20 au vers 30" → 20 et 30 ; "le dernier vers" → -1 et -1 ; "les 3 derniers" → -3 et -1 ;
  "le Khassaid en entier" / "tout" → 1 et 100000. Sinon null.`,
    config: { temperature: 0.1, responseMimeType: 'application/json' },
  }, 'light', true);
  try {
    const o = parseJson(raw);
    // a title counts only if the person said it (in this message or the last ones): the understanding
    // model sometimes names a Khassaid nobody mentioned
    const said = [text, ...history.slice(-4).map((m) => m.text)];
    const fromModel = S.findKhassaid(o.khassaid);
    // a title from the previous messages counts only for a real follow-up ("explique le premier vers",
    // "et le dernier ?"), not for a new subject asked after it
    const followUp = text.trim().split(/\s+/).length <= 8 || /(\bvers\b|distique|bëyit|beyit|ce (?:khassaid|poème|texte)|ce xassida|\bil\b|\bel\b|\bsuite\b|premier|dernier|explique|sens)/i.test(text);
    const khassaid = S.findKhassaid(text) || (fromModel && followUp && said.some((t) => S.findKhassaid(t) === fromModel) ? fromModel : '');
    const asked = readingRequest(text);                       // clear wording beats the model's guess
    if (asked && khassaid) Object.assign(o, asked);
    // a Khassaid named in the question but absent from the library (or invented): said explicitly
    const plain = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const firstWord = plain(o.khassaid || '').split(/[^a-z]+/).find((w) => w.length >= 4) || '';
    const unknownKhassaid = !khassaid && !fromModel && firstWord && plain(text).includes(firstWord) ? String(o.khassaid).trim() : '';
    return {
      unknownKhassaid,
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
    const r = S.readKhassaid(u.khassaid, u.debut ?? 1, u.fin ?? (u.debut != null ? u.debut : 10));
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
    { name: 'lire_khassaid', description: 'Texte arabe exact de distiques d\'un Khassaid (max 40) et son nombre total de distiques. Nombres négatifs = depuis la fin : debut -1 et fin -1 = dernier distique ; debut -3 et fin -1 = les 3 derniers.',
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

// ─── memory of the person ────────────────────────────────────────────────────
function personText({ memory, name, pauseDays, returning } = {}, history = []) {
  const lines = [];
  if (name) lines.push(`Prénom/nom Telegram : ${name}`);
  if (returning && !history.length && pauseDays != null) {
    lines.push(pauseDays >= 1 ? `Elle revient après ${pauseDays} jour(s) sans échange.` : 'Elle revient après quelques heures.');
  }
  if (memory) lines.push(`Ce que tu sais d'elle (conversations passées) :\n${memory}`);
  else if (!returning) lines.push("C'est votre première conversation.");
  return lines.join('\n');
}

/** Rewrites the long-term memory of a person from the last messages. Returns '' on failure. */
export async function updateMemory(oldMemory, recent, name) {
  const talk = recent.map((m) => `${m.role === 'user' ? 'Personne' : 'LAMP'}: ${m.text.slice(0, 600)}`).join('\n');
  const out = await generateText({
    contents: `Tu tiens le carnet de mémoire de LAMP AI (assistant mouride) sur une personne${name ? ` (${name})` : ''}.

Carnet actuel :
${oldMemory || '(vide)'}

Derniers échanges :
${talk}

Réécris le carnet complet en 10 lignes maximum, en français, une info par ligne commençant par "- " :
- comment l'appeler, langue préférée (wolof/français/anglais), ce qu'elle dit d'elle-même si c'est utile (ex. étudiant, commerçant, vit à Touba)
- les sujets et Khassaids dont vous avez parlé, ce qu'elle cherche ou apprend, les questions restées ouvertes
- ses préférences (réponses courtes, en vocal…)
Garde les infos anciennes encore utiles, ajoute les nouvelles, enlève les détails inutiles.
N'écris RIEN sur la santé, l'argent, la vie intime, les conflits familiaux ou d'autres détails sensibles, même s'ils ont été dits.
N'invente rien. Réponds uniquement par le carnet.`,
    config: { temperature: 0.2 },
  }, 'light', true);
  return out.length > 10 && out.length < 2500 ? out.trim() : '';
}

// ─── Arabic quotations: only the library's exact text ─────────────────────────
// The model sometimes miscopies a verse (a letter changed, a Latin "D" inside a word) or writes
// Arabic from memory. Every Arabic passage of 3+ words is checked against the library: exact → kept,
// miscopied → replaced by the library text, unknown → removed. Common formulas are allowed.
const AR = '\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF';
// one line at a time: a quote written over two lines is two passages (two hemistichs)
const ARABIC_RUN = new RegExp(`[${AR}](?:[${AR} \\t\\u00a0\\u200c-\\u200f]|[A-Za-z](?=[${AR}]))*`, 'g');
const FORMULAS = ['صلى الله عليه وسلم', 'بسم الله الرحمن الرحيم', 'السلام عليكم ورحمة الله وبركاته', 'سبحانه وتعالى',
  'رضي الله عنه', 'رحمه الله', 'إن شاء الله', 'الحمد لله رب العالمين', 'لا إله إلا الله محمد رسول الله', 'الله أكبر',
  'لا حول ولا قوة إلا بالله', 'جزاك الله خيرا', 'عليه السلام', 'خادم الرسول', 'سبحان الله', 'أستغفر الله'].map(S.arabicSkeleton);

// (accented words: \b does not work with é, so letter look-arounds and the u flag are used)
const VAGUE_AUTHORITY = /(?<!\p{L})(?:(?:selon|d'après|d’après|établie?s? par|cité(?:e|s)? par|répertorié(?:e|s)? par|reconnue? par|admis par|attesté(?:e|s)? par)\s+(?:les|des|de nombreux|plusieurs|certains)?\s*(?:chercheurs|érudits|spécialistes|bibliographes|historiens|savants|universitaires|experts|biographes)|fait autorité|consensus (?:des|parmi|chez)|selon la tradition|la tradition (?:mouride )?(?:établit|affirme|rapporte que)|les (?:chercheurs|érudits|spécialistes|historiens) (?:ont|s'accordent|estiment|établissent))(?!\p{L})/iu;

/** What the checks had to repair (per process): used by the exam and the quality tracking. */
export const checkStats = { arabicFixed: 0, arabicRemoved: 0, refRewrites: 0 };

export function checkArabic(reply) {
  const report = { fixed: 0, removed: [] };
  // unusual spaces (narrow no-break space…) between Arabic words would split a passage into
  // 1–2-word pieces that escape the check: make them normal spaces first
  reply = String(reply).replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ')
    // some models leak their English reasoning before the answer ("We need a hadith… Let's search.")
    .replace(/^(?:(?:We|I) (?:need|should|must|will)[^\n]*?(?:search|look)[^\n]*?\.\s*|Let's (?:search|look)[^\n]*?\.\s*)+/, '');
  const out = reply.replace(ARABIC_RUN, (run) => {
    const lead = run.match(/^\s*/)[0]; const trail = run.match(/\s*$/)[0];
    const core = run.trim();
    if (core.split(/\s+/).length < 3) return run;
    const sk = S.arabicSkeleton(core);
    if (FORMULAS.some((f) => f && (sk === f || (f.length > 8 && sk.includes(f) && sk.length < f.length + 12)))) return run;
    const v = S.verifyArabic(core);
    if (v.status === 'exact') return run;
    if (v.status === 'fixed') { report.fixed++; return lead + v.text + trail; }
    report.removed.push(core.slice(0, 60));
    return `${lead}[texte arabe retiré : introuvable dans la bibliothèque]${trail}`;
  });
  checkStats.arabicFixed += report.fixed; checkStats.arabicRemoved += report.removed.length;
  if (report.fixed || report.removed.length) console.warn(`[Check] Arabic: ${report.fixed} corrected, ${report.removed.length} removed ${report.removed.join(' | ')}`);
  return out;
}

// ─── answers without AI ──────────────────────────────────────────────────────
const CACHE = new Map();     // same first question within 24 h → same answer (new conversations only)
setInterval(() => { const now = Date.now(); for (const [k, v] of CACHE) if (v.until < now) CACHE.delete(k); }, 3600_000).unref();

const GREETING = /^\s*(?:(?:as+)?-?sa?l[ae]+m(?:ou|u)?(?:\s*-?\s*al[ae]?[iy]?k(?:ou|u)?m)?|salut|bonjour|bonsoir|hello|hi|hey|nanga\s*def|na\s*nga\s*def|jamm\s*nga\s*am|mbaa\s*jamm|wa\s*alaykum\s*salam)[\s,!.?]*(?:(?:nanga|na nga)\s*def|ça\s*va|comment\s*(?:vas|allez)[- ]\w+|how\s+are\s+you|lamp|serigne|sëriñ)?[\s,!.?]*$/i;
const QURAN_REF = /(?:sourate|surah|sura|coran|quran)?\s*(\d{1,3})\s*[:.]\s*(\d{1,3})(?:\s*[-–à]\s*(\d{1,3}))?/i;

export function directAnswer(text, history = [], person = {}) {
  const t = String(text).trim();
  const lang = guessLang(t);
  // greetings
  if (GREETING.test(t)) {
    const name = (person.name || '').split(' ')[0];
    const g = /^\s*(hello|hi|hey)\b/i.test(t) ? 'en' : lang;
    const hi = /s+a?l[ae]+m/i.test(t) ? (g === 'wo' ? 'Wa alaykum salaam' : 'Wa alaykum as-salam') : 'As-salamu alaykum';
    return { lang: g, direct: true, text: {
      wo: `${hi}${name ? ` ${name}` : ''} 🤍 Maa ngi fi, jàmm rekk, alxamdulillaah. Lan laa la mën a dimbali tey ?`,
      en: `${hi}${name ? ` ${name}` : ''} 🤍 I'm here, alhamdulillah. How can I help you today?`,
      fr: `${hi}${name ? ` ${name}` : ''} 🤍 Je vais bien, alhamdulillah. Comment puis-je t'aider aujourd'hui ?`,
    }[g] || '' };
  }
  // a Quran verse asked by its number ("2:153", "sourate 2 verset 153"), and nothing else
  const m = t.match(/^\s*(?:lis(?:-moi)?|donne(?:-moi)?|montre(?:-moi)?|read|show)?\s*(?:le\s+|the\s+)?(?:verset|verse|aaya)?\s*(?:sourate|surah|sura)?\s*(\d{1,3})\s*(?:[:.]|\s+verset\s+|\s+verse\s+)\s*(\d{1,3})(?:\s*[-–à]\s*(\d{1,3}))?\s*[?.!]*\s*$/i);
  if (m) {
    const r = S.readQuran(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null);
    if (!r.versets) return { lang, direct: true, text: r.erreur };
    return { lang, direct: true, text: `📖 **Coran — ${r.sourate}**\n\n` +
      r.versets.map((v) => `**${v.reference}**\n${v.arabe}\n« ${v.francais} »`).join('\n\n') + `\n\n_Traduction : ${r.traduction}_` };
  }
  // the list of the library's Khassaids
  if (/(liste|énum[eè]r|enumer|lister|quels sont|donne.{0,10}(?:tous|toutes)|tous les|combien de)\b.{0,40}(?:x|kh?|q)as+[aâ][iï]?d|(?:x|kh?|q)as+[aâ][iï]?d.{0,30}(?:dans ta base|dans ta biblioth|que tu (?:as|connais))/i.test(t) && !S.findKhassaid(t)) {
    const all = S.listKhassaids().split(', ');
    return { lang, direct: true, text: `📚 **Les ${all.length} Khassaids de ma bibliothèque** (nombre de distiques)\n` +
      '_C\'est le contenu de ma bibliothèque, pas le nombre total des écrits de Serigne Touba._\n\n' +
      all.map((x, i) => `${i + 1}. ${x}`).join('\n') };
  }
  // reading a Khassaid ("tous les vers de X", "le dernier vers de X"): no understanding step needed
  const stem = S.findKhassaid(t);
  const asked = readingRequest(t);
  if (stem && asked?.texte_seul && asked.debut != null) return readingAnswer(stem, asked.debut, asked.fin, lang);
  return null;
}

function readingAnswer(stem, debut, fin, lang) {
  // the whole text when asked ("tous les vers", "en entier"): Telegram splits it into several messages
  const r = S.readKhassaid(stem, debut ?? 1, fin ?? (debut != null ? debut : 10), 1000);
  if (!r.distiques) return { lang, direct: true, text: r.erreur };
  const body = r.distiques.map((d) => `${d.numero}. ${d.texte.replace('\n', '\n    ')}`).join('\n\n');
  const range = r.premier === r.dernier ? `distique ${r.premier}` : `distiques ${r.premier} à ${r.dernier}`;
  return { lang, direct: true,
    text: `📖 **${r.titre}** — ${range} sur ${r.nombre_de_distiques}\n\n${body}${r.suite ? `\n\n➡️ ${r.suite}` : ''}` };
}

// ─── French quotations: a quote must match the verse / hadith it cites ────────
// The model may put words in quotation marks and cite a real reference that says something else,
// or quote "the Prophet" with no reference at all. Quotes of the Quran are replaced by the
// library translation of the cited verse; hadith quotes that the library can't confirm are removed.
// how much of the quote appears, in order, in the source: share of the quote's word pairs found
// there (single shared words prove nothing in a long hadith)
const wordList = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[’']/g, ' ').split(/[^a-z]+/).filter((w) => w.length >= 3);
const overlap = (quote, source) => {
  const q = wordList(quote); const src = wordList(source);
  if (q.length < 3) return 1;
  const pairs = new Set(src.slice(1).map((w, i) => `${src[i]} ${w}`));
  let n = 0; for (let i = 1; i < q.length; i++) if (pairs.has(`${q[i - 1]} ${q[i]}`)) n++;
  return n / (q.length - 1);
};
const PROPHET = /(proph[eè]te|ﷺ|messager d'allah|hadith|a dit|disait|enseign[ée])[^«\n]{0,60}$/i;
const QREF = /^[^«\n]{0,60}?(?:\(|\*\*|coran|sourate)?\s*(\d{1,3})\s*:\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?/i;
const HREF = /^[^«\n]{0,80}?(bukh?ari|boukhari|muslim|dawud|daoud|malik|muwatta|nawawi)[^«\n]{0,40}?(?:n°|no\.|num[ée]ro|#)\s*(\d{1,5})/i;

export const quoteStats = { quranReplaced: 0, hadithRemoved: 0 };
export function checkQuotes(reply) {
  return String(reply).replace(/«([^»\n]{12,700})»/g, (whole, quote, offset, all) => {
    if (/[\u0600-\u06FF]/.test(quote) || quote.includes('[texte arabe retiré')) return whole;   // Arabic: checked elsewhere
    const after = all.slice(offset + whole.length, offset + whole.length + 120);
    const before = all.slice(Math.max(0, offset - 80), offset);
    const q = after.match(QREF);
    if (q) {
      const r = S.readQuran(Number(q[1]), Number(q[2]), q[3] ? Number(q[3]) : null);
      if (!r.versets) return whole;                      // unknown verse: the reference check handles it
      const text = r.versets.map((v) => v.francais).join(' ');
      if (overlap(quote, text) >= 0.6) return whole;
      quoteStats.quranReplaced++;
      console.warn(`[Check] quote does not match ${q[1]}:${q[2]} → library translation`);
      return `« ${text} »`;
    }
    const h = after.match(HREF);
    if (h) {
      const r = S.readHadith(h[1], Number(h[2]));
      if (r.texte && overlap(quote, r.texte) >= 0.5) return whole;
      quoteStats.hadithRemoved++;
      console.warn(`[Check] quote not found in hadith ${h[1]} n°${h[2]} → removed`);
      return '« [citation retirée : elle ne correspond pas au texte de ce hadith dans la bibliothèque] »';
    }
    if (PROPHET.test(before)) {                          // a saying of the Prophet with no number: must exist somewhere
      const best = S.searchHadith(quote, null, 8).reduce((m, x) => Math.max(m, overlap(quote, S.readHadith(x.recueil, x.numero).texte || '')), 0);
      if (best >= 0.6) return whole;
      quoteStats.hadithRemoved++;
      console.warn('[Check] saying of the Prophet not found in the hadith library → removed');
      return '« [parole retirée : introuvable dans les recueils de hadiths de la bibliothèque] »';
    }
    return whole;
  });
}

// ─── main ────────────────────────────────────────────────────────────────────
/**
 * history: [{ role: 'user'|'model', text }] of the current conversation
 * person: { memory, name, pauseDays, returning } from lib/history.js
 * Returns { text, lang, direct }
 */
export async function answer(text, history = [], person = {}) {
  const t0 = Date.now();
  // 0. answers that need no AI at all (0 tokens)
  const quick = directAnswer(text, history, person);
  if (quick) { console.log('[Brain] direct answer (no AI)'); return quick; }
  const cacheKey = !history.length ? `${guessLang(text)}|${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}` : '';
  const cached = cacheKey && CACHE.get(cacheKey);
  if (cached && cached.until > Date.now()) { console.log('[Brain] same question as before → saved answer'); return cached.r; }

  const u = await understand(text, history);
  const guessed = guessLang(text);                       // clear Wolof / English words beat the model's guess
  if (u.lang === 'fr' && (guessed === 'en' || guessed === 'wo')) u.lang = guessed;
  console.log(`[Brain] lang=${u.lang} khassaid=${u.khassaid || '-'} topic="${u.topic}" q="${u.question.slice(0, 80)}"`);

  // Reading a Khassaid text only: served straight from the file, no AI involved.
  if (u.texte_seul) return readingAnswer(u.khassaid, u.debut, u.fin, u.lang);

  const refs = new Set();
  const [sources, notes] = await Promise.all([retrieve(u, refs), S.reviewedNotes().catch(() => '')]);
  const warning = u.unknownKhassaid
    ? `\nATTENTION : aucun Khassaid nommé « ${u.unknownKhassaid} » n'existe dans la bibliothèque des ${S.listKhassaids().split(', ').length} Khassaids. ` +
      "Dis clairement que tu ne le trouves pas. Ne décris pas son contenu, ne dis pas qu'il existe, n'invente ni titre ni sujet. " +
      "Tu peux proposer un Khassaid de la bibliothèque qui parle du même sujet, en le nommant correctement."
    : '';
  const systemInstruction = buildContext({ ...u, khassaid: u.khassaid ? S.khassaidInfo(u.khassaid).titre : '', sources: (sources || '') + warning, notes, person: personText(person, history) });

  const contents = [
    // the last 4 messages; the bot's own long answers shortened (the memory note keeps the rest)
    ...history.slice(-4).map((m) => ({ role: m.role, parts: [{ text: m.role === 'model' && m.text.length > 400 ? `${m.text.slice(0, 400)}…` : m.text }] })),
    { role: 'user', parts: [{ text }] },
  ];
  const config = { systemInstruction, temperature: 0.3, tools: TOOLS };

  let reply = '';
  // last round: searching is switched off (tools still declared, calls forbidden) and the model is told
  // to answer with what it found — otherwise it may return only a search request and no text
  const finalConfig = { systemInstruction, temperature: 0.3, tools: TOOLS, toolConfig: { functionCallingConfig: { mode: 'NONE' } } };
  const answerNow = { role: 'user', parts: [{ text: 'Tu as assez cherché : réponds maintenant à la question avec les sources déjà trouvées, sans nouvelle recherche.' }] };
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    if (round === MAX_TOOL_ROUNDS) contents.push(answerNow);
    const r = await generate({
      deadline: t0 + 60_000,                                     // one time budget for the whole answer (all rounds)
      preferGroq: Date.now() - t0 > 60_000,                      // Google too slow for this answer: finish with Groq
      contents,
      config: round === MAX_TOOL_ROUNDS ? finalConfig : config,
      toolRunner: (name, args) => runTool(name, args, refs),     // lets Groq use the library too
    }, 'answer');
    const calls = r.groq ? [] : (r.functionCalls || []);
    if (!calls.length) { reply = (r.text || '').trim(); break; }
    contents.push(r.candidates[0].content);
    const responses = [];
    for (const c of calls) responses.push({ functionResponse: { name: c.name, ...(c.id ? { id: c.id } : {}), response: await runTool(c.name, c.args || {}, refs) } });
    contents.push({ role: 'user', parts: responses });
  }
  if (!reply) {                                              // a model returned nothing: ask once more, Groq if needed
    console.warn('[Brain] empty answer → one more try');
    if (contents.at(-1) !== answerNow) contents.push(answerNow);
    reply = (await generateText({ contents, config: finalConfig, preferGroq: true }, 'answer', true))
      || (await generateText({ contents, config: finalConfig }, 'answer', true));
  }
  if (!reply) throw new Error('Empty answer');

  // Any number that did not come from the library → one rewrite without it
  const bad = unverifiedRefs(reply, refs);
  if (bad.length) {
    console.warn(`[Check] unverified references: ${bad.join(', ')} → rewrite`);
    checkStats.refRewrites++;
    const fixed = await generateText({
      contents: [...contents, { role: 'model', parts: [{ text: reply }] },
        { role: 'user', parts: [{ text: `Vérification : ces références ne viennent pas de la bibliothèque : ${bad.join(', ')}. Réécris ta réponse complète en gardant tout le reste, mais enlève ces références (ou remplace-les par le sens général sans numéro). Ne mentionne pas cette vérification.` }] }],
      config: { systemInstruction, temperature: 0.2 },
    }, 'answer', true);
    if (fixed && unverifiedRefs(fixed, refs).length < bad.length) reply = fixed;
  }
  // Vague authority ("les chercheurs ont établi…", "selon la tradition…") is how a model dresses up a fact it
  // invented: one rewrite without it.
  if (VAGUE_AUTHORITY.test(reply)) {
    checkStats.vagueRewrites = (checkStats.vagueRewrites || 0) + 1;
    console.warn(`[Check] vague authority: "${reply.match(VAGUE_AUTHORITY)[0]}" → rewrite`);
    const fixed = await generateText({
      contents: [...contents, { role: 'model', parts: [{ text: reply }] },
        { role: 'user', parts: [{ text: `Vérification : ta réponse appuie une information sur une autorité vague (« ${reply.match(VAGUE_AUTHORITY)[0]} »). Réécris ta réponse complète : retire toute affirmation qui ne vient pas de la bibliothèque (Coran, hadiths, Khassaids fournis), ne nomme aucun chercheur, livre, catalogue ou date que la bibliothèque ne donne pas, et si tu n'as pas de source dis simplement « Je n'ai pas de source pour cela dans ma bibliothèque ». Ne mentionne pas cette vérification.` }] }],
      config: { systemInstruction, temperature: 0.2 },
    }, 'answer', true);
    if (fixed && !VAGUE_AUTHORITY.test(fixed)) reply = fixed;
  }
  reply = checkQuotes(checkArabic(reply));
  console.log(`[Brain] answered in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const result = { text: reply, lang: u.lang, direct: false };
  if (cacheKey) CACHE.set(cacheKey, { until: Date.now() + 24 * 3600_000, r: result });
  return result;
}

/** Speech → text (Gemini hears Wolof, French, Arabic). */
// Words a speaker of LAMP is likely to say: helps both speech engines spell them right.
const VOICE_WORDS = 'Serigne Touba, Cheikh Ahmadou Bamba, Khassaïd, Khassida, Mouride, Touba, Magal, Daara, ' +
  'talibé, Borom Touba, Mame Diarra Bousso, Serigne Saliou, Yàlla, jërëjëf, dama bëgg, nanga def, yaw yay kan, ' +
  'Wa kaana haqqan, Mawahibu, Jazbul Qulub, Matlabul Fawzayni, Nuru Darayni, Jalibatul Maraghib, Mafatihul Bishri, ' +
  'Tazawudu Sighar, Masalikul Jinan, Asma ul Husna, Bismillah, Alhamdulillah, Inshallah, hadith, sourate, Coran.';

export async function transcribe(buffer, mimeType) {
  let raw = '';
  try {
    raw = await transcribeGemini(buffer, mimeType);
  } catch (e) {
    console.warn('[Brain] Gemini transcription failed:', e.message.slice(0, 80));
  }
  raw = cleanTranscript(raw);
  if (!raw) raw = cleanTranscript(await elevenTranscribe(buffer, mimeType));               // knows Wolof
  if (!raw) raw = cleanTranscript(await groqTranscribe(buffer, mimeType, VOICE_WORDS));     // Whisper, last resort
  if (!raw) return '';
  const fixed = await fixTranscript(raw);
  console.log(`[Voice] heard "${raw.slice(0, 120)}"${fixed !== raw ? ` → corrected "${fixed.slice(0, 120)}"` : ''}`);
  return fixed;
}

// "[Silence]", "(inaudible)", "[Musique]"… are not questions
function cleanTranscript(t) {
  const s = String(t || '').replace(/[[(][^\])]{0,30}[\])]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.replace(/[^\p{L}\p{N}]/gu, '').length >= 2 ? s : '';
}

async function transcribeGemini(buffer, mimeType) {
  return generateText({
    contents: [{ role: 'user', parts: [
      { inlineData: { mimeType, data: buffer.toString('base64') } },
      { text: `Transcris exactement ce qui est dit, dans la langue parlée (souvent du wolof mêlé de français et d'arabe). Écris le wolof avec l'orthographe sénégalaise habituelle, sans traduire. Vocabulaire fréquent : ${VOICE_WORDS} Réponds uniquement par la transcription. Si rien n'est audible, réponds par un texte vide.` },
    ] }],
    config: { temperature: 0 },
  }, 'answer');
}

// Speech engines mishear Wolof and Arabic titles ("Ouakka Lahakam" for "Wa kaana haqqan").
// A quick text pass puts back the right words, using the real list of Khassaid titles.
export async function fixTranscript(raw) {
  const fixed = await generateText({
    contents: `Transcription automatique d'un message vocal d'un Sénégalais qui parle à un assistant sur l'islam et le mouridisme (wolof, français, arabe mélangés). Le moteur se trompe souvent sur le wolof et les mots arabes.

Transcription : "${raw}"

Corrige seulement les mots mal entendus, en gardant la langue et le sens d'origine (ne traduis pas, ne réponds pas à la question) :
- un titre de Khassaid mal entendu → remplace-le par le bon titre. Titres qui sonnent le plus proche de ce message : ${S.soundAlikes(raw, 6).map((x) => x.title).join(', ')}. Liste complète : ${S.listKhassaids().replace(/ \(\d+\)/g, '')}
- du wolof que le moteur a pris pour une autre langue (indonésien, malais, anglais…) → réécris-le en wolof d'après les sons
- « verbes » est souvent « vers » (les distiques d'un Khassaid)
- noms et termes religieux : ${VOICE_WORDS}
Si la transcription est déjà correcte, renvoie-la telle quelle. Réponds uniquement par le texte corrigé.`,
    config: { temperature: 0 },
  }, 'light', true);
  let out = fixed.replace(/^["«\s]+|["»\s]+$/g, '').trim();
  // a Khassaid title the person said clearly is never swapped for another one
  const said = S.findKhassaid(raw);
  if (out && said && S.findKhassaid(out) !== said) out = raw;
  // keep the correction only if it stays close in length (no answer, no explanation)
  return out && out.length < raw.length * 2 + 40 ? out : raw;
}
