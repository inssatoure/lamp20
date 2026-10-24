// LAMP AI — password-protected dashboard (login: admin / LAMP_ADMIN_PASSWORD).
//   /admin                 overview: questions, AI credits, checks, errors
//   /admin/conversations   every person's conversations and the bot's memory of them
//   /admin/cles            Gemini keys: add, remove, order, test
//   /admin/comportement    instructions and teachings LAMP follows
//   /admin/limites         questions per person per day, people without limit
// Runs inside the bot process, on the same web server as Telegram's webhook.
import http from 'http';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { ADMIN_PASSWORD, PORT, WEBHOOK_URL, MODELS } from './config.js';
import { listUsers, getMessages, backend } from './store.js';
import { usedToday, unlimited } from './quota.js';
import * as settings from './settings.js';
import { report } from './stats.js';
import { keyStatus, testKey } from './ai.js';
import { adminGuidance } from './prompt.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const same = (a, b) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const date = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Africa/Dakar', dateStyle: 'short', timeStyle: 'short' }) : '');
const num = (n) => Number(n || 0).toLocaleString('fr-FR');
const todayUse = (id) => (unlimited(id) ? ' · sans limite' : ` · aujourd'hui : ${usedToday(id)}/${settings.dailyLimit()} questions`);
// a form field only this dashboard knows: a page from another site cannot make the browser change settings
const sign = (what) => crypto.createHmac('sha256', settings.adminSecret()).update(what).digest('hex');
const csrf = () => sign('form').slice(0, 32);

// ─── access: password (browser login box) or the permanent magic link (a cookie) ───
const COOKIE = 'lamp_admin';
const cookieValue = () => sign(`link:${settings.adminLinkToken()}`);   // a new link makes old cookies useless
const cookieOk = (req) => (req.headers.cookie || '').split(/;\s*/).some((c) => c.startsWith(`${COOKIE}=`) && same(c.slice(COOKIE.length + 1), cookieValue()));
const accessOn = () => !!ADMIN_PASSWORD || settings.hasAdminPassword();
// too many wrong passwords or links from one address: blocked for 15 minutes
const failures = new Map();   // ip -> { n, until }
// the host's proxy adds the real address last: earlier entries could be made up by the visitor
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim();
const blocked = (ip) => (failures.get(ip)?.until || 0) > Date.now();
function failed(ip) {
  const f = failures.get(ip) || { n: 0, until: 0 };
  f.n += 1; if (f.n >= 8) { f.until = Date.now() + 15 * 60_000; f.n = 0; console.warn(`[Admin] ${ip} blocked 15 min (wrong passwords)`); }
  failures.set(ip, f);
}
const hidden = () => `<input type="hidden" name="csrf" value="${csrf()}">`;

const TABS = [['/admin', 'Vue d’ensemble'], ['/admin/conversations', 'Conversations'], ['/admin/cles', 'Clés Gemini'],
  ['/admin/comportement', 'Comportement'], ['/admin/limites', 'Limites'], ['/admin/acces', 'Accès']];

const page = (title, active, body, flash = '') => `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root{--bg:#f4f1ea;--card:#fffdf8;--ink:#1f2a24;--muted:#6b756f;--green:#1e5b3f;--gold:#b0812a;--red:#a23b2a;--line:#e2ddd1}
@media (prefers-color-scheme:dark){:root{--bg:#121714;--card:#1a211d;--ink:#e8ece9;--muted:#9aa59f;--green:#7cc79e;--gold:#d9b25e;--red:#e08b7a;--line:#2b342f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 Georgia,serif}
main{max-width:920px;margin:0 auto;padding:20px 16px 48px}h1{font-size:28px;margin:4px 0}h2{font-size:21px;margin:28px 0 8px}
a{color:var(--green)}.muted{color:var(--muted);font-size:14px}
nav{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}nav a{padding:6px 12px;border-radius:999px;border:1px solid var(--line);text-decoration:none;color:var(--ink);font-size:15px;background:var(--card)}
nav a.on{background:var(--green);border-color:var(--green);color:var(--bg)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:10px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px}.stat b{display:block;font-size:30px;color:var(--green);line-height:1.2}
.stat span{font-size:13px;color:var(--muted)}
.tbl{width:100%;border-collapse:collapse;font-size:14px}.tbl th,.tbl td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.scroll{overflow-x:auto}
.u{display:block;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 16px;margin:8px 0;text-decoration:none;color:inherit}.u b{color:var(--green)}
.mem{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.m{border-radius:14px;padding:10px 14px;margin:8px 0;max-width:85%;white-space:pre-wrap;word-wrap:break-word}
.user{background:var(--green);color:var(--bg);margin-left:auto}.model{background:var(--card);border:1px solid var(--line)}
.sess{color:var(--muted);font-size:13px;margin:22px 0 4px;border-top:1px solid var(--line);padding-top:8px}
.flash{padding:10px 14px;border-radius:12px;margin:10px 0;border:1px solid var(--line);background:var(--card)}.flash.ok{border-color:var(--green)}.flash.bad{border-color:var(--red);color:var(--red)}
input,select,textarea{font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:8px 10px;max-width:100%}
textarea{width:100%;min-height:90px}
button{font:inherit;font-size:14px;border-radius:999px;border:1px solid var(--green);background:var(--green);color:var(--bg);padding:6px 14px;cursor:pointer}
button.ghost{background:transparent;color:var(--green)}button.danger{border-color:var(--red);background:transparent;color:var(--red)}
form.inline{display:inline}.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.tag{display:inline-block;font-size:12px;padding:1px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.tag.ok{border-color:var(--green);color:var(--green)}.tag.bad{border-color:var(--red);color:var(--red)}.tag.gold{border-color:var(--gold);color:var(--gold)}
.off{opacity:.55}details summary{cursor:pointer;color:var(--green)}pre{white-space:pre-wrap;font-size:13px}
</style></head><body><main>
<nav>${TABS.map(([href, label]) => `<a href="${href}"${href === active ? ' class="on"' : ''}>${label}</a>`).join('')}</nav>
${flash}${body}</main></body></html>`;

const flashOf = (url) => {
  const ok = url.searchParams.get('ok'); const bad = url.searchParams.get('err');
  return ok ? `<div class="flash ok">${esc(ok)}</div>` : bad ? `<div class="flash bad">${esc(bad)}</div>` : '';
};

// the code version running now (shown on /health, to check that automatic updates arrived)
const VERSION = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }).trim(); } catch { return 'inconnue'; } })();

// ─── pages ───────────────────────────────────────────────────────────────────
const CHECK_LABELS = {
  arabicFixed: 'arabe corrigé (petite différence avec la bibliothèque)', arabicRemoved: 'arabe retiré (introuvable dans la bibliothèque)',
  refRewrites: 'références inventées retirées', vagueRewrites: 'autorités vagues retirées',
  quranReplaced: 'traductions du Coran remplacées par le texte exact', hadithRemoved: 'hadiths non vérifiés retirés',
};

function overview() {
  const { days, errors } = report(7);
  const t = days[0];
  const tokens = (d) => Object.values(d.ai).reduce((n, a) => n + a.in + a.out, 0);
  const calls = (d) => Object.values(d.ai).reduce((n, a) => n + a.calls, 0);
  const keys = keyStatus();
  const checks = Object.entries(t.checks).filter(([, v]) => v > 0);
  return `<h1>LAMP AI — vue d’ensemble</h1>
<p class="muted">Aujourd’hui (${t.day}, heure de Dakar) · version du bot ${esc(VERSION)} · limite : ${settings.dailyLimit() || 'aucune'} questions par personne et par jour</p>
<div class="grid">
<div class="stat"><b>${num(t.questions)}</b><span>questions (${num(t.voice)} en vocal)</span></div>
<div class="stat"><b>${num(t.people.length)}</b><span>personnes</span></div>
<div class="stat"><b>${num(t.answered)}</b><span>réponses (${num(t.withoutAI)} sans IA)</span></div>
<div class="stat"><b>${num(t.busy)}</b><span>« occupé » (pas de réponse)</span></div>
<div class="stat"><b>${num(t.limited)}</b><span>refus : limite du jour</span></div>
<div class="stat"><b>${num(tokens(t))}</b><span>tokens IA (${num(calls(t))} appels)</span></div>
</div>
<h2>Crédits IA aujourd’hui</h2>
<div class="card scroll"><table class="tbl"><tr><th>Service</th><th>Appels</th><th>Tokens envoyés</th><th>Tokens produits</th></tr>
${Object.entries(t.ai).filter(([, a]) => a.calls).map(([w, a]) => `<tr><td>${w === 'gemini' ? 'Gemini' : w === 'groq' ? 'Groq' : 'Cerebras'}</td><td>${num(a.calls)}</td><td>${num(a.in)}</td><td>${num(a.out)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aucun appel aujourd’hui.</td></tr>'}
</table>
<p class="muted">Modèles qui ont écrit les réponses : ${Object.entries(t.models).map(([m, n]) => `${esc(m.replace(/^gemini:/, ''))} (${n})`).join(', ') || '—'}. Modèles autorisés : ${MODELS.answer.map(esc).join(', ')}.</p></div>
<h2>Vérifications automatiques aujourd’hui</h2>
<div class="card">${checks.length ? `<p class="muted">Ce que les contrôles ont dû corriger dans les réponses du modèle :</p><ul>${checks.map(([k, v]) => `<li>${num(v)} × ${esc(CHECK_LABELS[k] || k)}</li>`).join('')}</ul>` : '<p class="muted">Rien à corriger aujourd’hui.</p>'}</div>
<h2>Clés Gemini</h2>
<div class="card">${keys.map((k) => `<div>Clé n°${k.n} <span class="muted">${esc(k.masked)}</span> — ${keyTag(k)}</div>`).join('')}
<p class="muted"><a href="/admin/cles">Gérer les clés →</a></p></div>
<h2>Les 7 derniers jours</h2>
<div class="card scroll"><table class="tbl"><tr><th>Jour</th><th>Questions</th><th>Personnes</th><th>Réponses</th><th>Occupé</th><th>Limite</th><th>Tokens IA</th></tr>
${days.map((d) => `<tr><td>${d.day}</td><td>${num(d.questions)}</td><td>${num(d.people.length)}</td><td>${num(d.answered)}</td><td>${num(d.busy)}</td><td>${num(d.limited)}</td><td>${num(tokens(d))}</td></tr>`).join('')}
</table></div>
<h2>Dernières erreurs</h2>
<div class="card scroll">${errors.length ? `<table class="tbl">${errors.slice(0, 15).map((e) => `<tr><td class="muted">${date(e.at)}</td><td>${esc(e.where)}</td><td>${esc(e.message)}</td></tr>`).join('')}</table>` : '<p class="muted">Aucune erreur enregistrée.</p>'}</div>`;
}

function keyTag(k) {
  if (k.pausedUntil) return `<span class="tag bad">en pause jusqu’à ${date(k.pausedUntil).split(' ')[1] || ''} (refusée)</span>`;
  if (k.errorAt && (!k.okAt || k.errorAt > k.okAt)) return `<span class="tag gold">dernière erreur ${date(k.errorAt)}</span>`;
  if (k.okAt) return `<span class="tag ok">marche (dernier succès ${date(k.okAt)})</span>`;
  return '<span class="tag">pas encore utilisée depuis le redémarrage</span>';
}

function keysPage() {
  const keys = keyStatus();
  return `<h1>Clés Gemini</h1>
<p class="muted">Le bot utilise la première clé qui marche, dans cet ordre. Une clé refusée ou sans quota est sautée automatiquement.
${settings.keysFromAdmin() ? 'Cette liste est gérée ici.' : 'Ces clés viennent des variables cPanel. Dès que tu modifies la liste ici, c’est la liste de cette page qui compte (les variables cPanel ne sont plus utilisées pour les clés).'}</p>
${keys.map((k, i) => `<div class="card"><div class="row"><b>Clé n°${k.n}</b><span class="muted">${esc(k.masked)}</span>${keyTag(k)}</div>
${k.error ? `<p class="muted">Dernière erreur : ${esc(k.error)}</p>` : ''}
<div class="row" style="margin-top:8px">
<form class="inline" method="post" action="/admin/action">${hidden()}<input type="hidden" name="do" value="key-test"><input type="hidden" name="i" value="${i}"><button>Tester</button></form>
${i > 0 ? `<form class="inline" method="post" action="/admin/action">${hidden()}<input type="hidden" name="do" value="key-up"><input type="hidden" name="i" value="${i}"><button class="ghost">Monter</button></form>` : ''}
${i < keys.length - 1 ? `<form class="inline" method="post" action="/admin/action">${hidden()}<input type="hidden" name="do" value="key-down"><input type="hidden" name="i" value="${i}"><button class="ghost">Descendre</button></form>` : ''}
${keys.length > 1 ? `<form class="inline" method="post" action="/admin/action" onsubmit="return confirm('Retirer la clé n°${k.n} ?')">${hidden()}<input type="hidden" name="do" value="key-remove"><input type="hidden" name="i" value="${i}"><button class="danger">Retirer</button></form>` : ''}
</div></div>`).join('')}
<h2>Ajouter une clé</h2>
<form class="card" method="post" action="/admin/action">${hidden()}<input type="hidden" name="do" value="key-add">
<p class="muted">Colle une clé Gemini (Google AI Studio → Get API key). Elle est testée avant d’être ajoutée, puis enregistrée sur le serveur seulement (jamais sur GitHub).</p>
<div class="row"><input type="password" name="key" placeholder="Clé Gemini" autocomplete="off" style="flex:1;min-width:220px" required><button>Tester et ajouter</button></div></form>`;
}

function behaviourPage() {
  const items = settings.guidance();
  const item = (g) => `<div class="card${g.active ? '' : ' off'}"><div class="row"><span class="tag ${g.type === 'consigne' ? 'ok' : 'gold'}">${g.type}</span>
<span class="muted">${g.active ? 'active' : 'désactivée'} · ajoutée le ${date(g.created)}${g.edited ? ` · modifiée le ${date(g.edited)}` : ''}</span></div>
<form method="post" action="/admin/action" style="margin-top:8px">${hidden()}<input type="hidden" name="do" value="g-edit"><input type="hidden" name="id" value="${esc(g.id)}">
<textarea name="text" maxlength="2000">${esc(g.text)}</textarea><div class="row" style="margin-top:6px"><button class="ghost">Enregistrer la modification</button></div></form>
<div class="row" style="margin-top:6px">
<form class="inline" method="post" action="/admin/action">${hidden()}<input type="hidden" name="do" value="g-toggle"><input type="hidden" name="id" value="${esc(g.id)}"><button class="ghost">${g.active ? 'Désactiver' : 'Activer'}</button></form>
<form class="inline" method="post" action="/admin/action" onsubmit="return confirm('Supprimer définitivement ?')">${hidden()}<input type="hidden" name="do" value="g-delete"><input type="hidden" name="id" value="${esc(g.id)}"><button class="danger">Supprimer</button></form>
</div></div>`;
  const preview = adminGuidance();
  return `<h1>Comportement de LAMP</h1>
<p class="muted">Ce que tu écris ici est ajouté aux instructions de LAMP pour toutes les nouvelles réponses, tout de suite (sans redémarrage).
Les règles de base restent prioritaires : LAMP ne peut pas inventer de citation, de source ou de numéro, même si une consigne le demande.</p>
<ul class="muted"><li><b>Consigne</b> : comment répondre. Ex. « Réponds en 5 phrases maximum. » · « Termine par une courte invocation. »</li>
<li><b>Enseignement</b> : une chose que LAMP doit savoir et transmettre avec ses mots, sans la présenter comme une citation. Ex. « Serigne Touba insiste sur l’alliance du travail et de l’adoration. »</li></ul>
<h2>Ajouter</h2>
<form class="card" method="post" action="/admin/action">${hidden()}<input type="hidden" name="do" value="g-add">
<div class="row"><select name="type"><option value="consigne">Consigne</option><option value="enseignement">Enseignement</option></select></div>
<textarea name="text" maxlength="2000" placeholder="Écris la consigne ou l’enseignement…" required style="margin-top:8px"></textarea>
<div class="row" style="margin-top:6px"><button>Ajouter</button></div></form>
<h2>Consignes et enseignements (${items.length})</h2>
${items.map(item).join('') || '<p class="muted">Rien pour l’instant : LAMP suit seulement ses règles de base.</p>'}
<details class="card"><summary>Voir exactement ce que LAMP reçoit en plus</summary><pre>${esc(preview || '(rien)')}</pre></details>`;
}

function limitsPage() {
  const ids = [...settings.unlimitedIds()].join(', ');
  return `<h1>Limites</h1>
<p class="muted">Chaque question (écrite ou vocale) compte pour 1. Au-delà de la limite, LAMP répond poliment que le compteur repart à minuit (heure de Dakar), sans utiliser l’IA. Une question à laquelle LAMP n’a pas pu répondre ne compte pas.</p>
<form class="card" method="post" action="/admin/action">${hidden()}<input type="hidden" name="do" value="limits">
<p><label>Questions par personne et par jour (0 = sans limite)<br><input type="number" name="limit" min="0" max="1000" value="${settings.dailyLimit()}" required></label></p>
<p><label>Personnes sans limite : identifiants Telegram, séparés par des virgules<br><input name="ids" value="${esc(ids)}" style="width:100%" placeholder="ex. 5187893100"></label></p>
<p class="muted">L’identifiant de chaque personne est affiché sur sa page, dans Conversations.</p>
<button>Enregistrer</button></form>`;
}

function accessPage(req) {
  const link = `https://${req.headers.host}/admin/lien/${settings.adminLinkToken()}`;
  return `<h1>Accès au tableau de bord</h1>
<h2>Lien magique</h2>
<div class="card"><p class="muted">Ce lien ouvre le tableau de bord sans mot de passe, sur n’importe quel appareil, et reste valable tant que tu ne le changes pas.
Garde-le comme un mot de passe : toute personne qui l’a peut tout gérer (clés, consignes, conversations).</p>
<p><input readonly value="${esc(link)}" style="width:100%" onclick="this.select()"></p>
<form class="inline" method="post" action="/admin/action" onsubmit="return confirm('Créer un nouveau lien ? L’ancien lien ne marchera plus, sur tous les appareils.')">${hidden()}<input type="hidden" name="do" value="link-renew"><button class="danger">Changer le lien</button></form>
<a href="/admin/deconnexion" style="margin-left:10px">Se déconnecter sur cet appareil</a></div>
<h2>Mot de passe</h2>
<form class="card" method="post" action="/admin/action">${hidden()}<input type="hidden" name="do" value="password">
<p class="muted">Identifiant : <b>admin</b>. ${settings.hasAdminPassword() ? 'Le mot de passe actuel a été choisi ici.' : 'Le mot de passe actuel vient de la variable cPanel LAMP_ADMIN_PASSWORD. Dès que tu le changes ici, c’est celui-ci qui compte.'}</p>
<p><input type="password" name="pw" placeholder="Nouveau mot de passe (6 caractères minimum)" autocomplete="new-password" required></p>
<p><input type="password" name="pw2" placeholder="Le même, une deuxième fois" autocomplete="new-password" required></p>
<button>Changer le mot de passe</button></form>`;
}

async function conversationsPage(url) {
  const q = (url.searchParams.get('q') || '').toLowerCase().trim();
  const users = (await listUsers()).filter((u) => !q || `${u.profile.name} ${u.profile.username} ${u.id}`.toLowerCase().includes(q));
  return `<h1>Conversations</h1>
<p class="muted">${users.length} personne(s) · stockage : ${backend === 'firestore' ? 'Firestore' : 'fichiers du serveur'}</p>
<form class="row" method="get" action="/admin/conversations"><input name="q" value="${esc(q)}" placeholder="Chercher un nom, un @, un identifiant" style="flex:1;min-width:200px"><button class="ghost">Chercher</button></form>
${users.map((u) => `<a class="u" href="/admin/conversations?u=${encodeURIComponent(u.id)}"><b>${esc(u.profile.name || 'Sans nom')}</b>
${u.profile.username ? ` · @${esc(u.profile.username)}` : ''}<br><span class="muted">${u.profile.count || 0} message(s) · dernier : ${date(u.profile.last_seen)} · langue : ${esc(u.profile.lang || '?')}${todayUse(u.id)}</span></a>`).join('')}`;
}

async function personPage(id) {
  const [users, msgs] = await Promise.all([listUsers(), getMessages(id)]);
  const u = users.find((x) => x.id === id) || { profile: {}, memory: '' };
  let lastSession = null;
  const body = msgs.map((m) => {
    const head = m.session !== lastSession ? `<div class="sess">Conversation ${esc(m.session || 1)} · ${date(m.ts)}</div>` : '';
    lastSession = m.session;
    return `${head}<div dir="auto" class="m ${m.role === 'user' ? 'user' : 'model'}">${m.voice ? '🎙️ ' : ''}${esc(m.text)}</div>`;
  }).join('');
  return `<p><a href="/admin/conversations">← toutes les conversations</a></p>
<h1>${esc(u.profile.name || 'Sans nom')}</h1><p class="muted">${u.profile.username ? `@${esc(u.profile.username)} · ` : ''}identifiant Telegram : ${esc(id)} · première visite : ${date(u.profile.first_seen)}${todayUse(id)}</p>
<h2>Mémoire du bot</h2><div class="mem">${esc(u.memory || '(rien encore)')}</div><h2>Messages</h2>${body || '<p class="muted">Aucun message.</p>'}`;
}

// ─── actions (forms) ─────────────────────────────────────────────────────────
async function action(f) {
  const i = Number(f.i);
  switch (f.do) {
    case 'key-add': {
      const key = String(f.key || '').trim();
      settings.addGeminiKey(key);                                   // checks the format and duplicates
      const index = settings.geminiKeys().indexOf(key);
      const t = await testKey(index);
      if (!t.ok && !/quota|saturé/.test(t.text)) { settings.removeGeminiKey(index); throw new Error(`Clé non ajoutée : ${t.text}.`); }
      return ['/admin/cles', `Clé ajoutée (n°${index + 1}). Test : ${t.text}`];
    }
    case 'key-test': { const t = await testKey(i); return ['/admin/cles', `Clé n°${i + 1} : ${t.text}`, !t.ok]; }
    case 'key-up': settings.moveGeminiKey(i, -1); return ['/admin/cles', 'Ordre des clés modifié.'];
    case 'key-down': settings.moveGeminiKey(i, +1); return ['/admin/cles', 'Ordre des clés modifié.'];
    case 'key-remove': settings.removeGeminiKey(i); return ['/admin/cles', 'Clé retirée.'];
    case 'g-add': settings.addGuidance(f.type, f.text); return ['/admin/comportement', 'Ajouté. LAMP en tient compte dès la prochaine question.'];
    case 'g-edit': settings.editGuidance(f.id, f.text); return ['/admin/comportement', 'Modification enregistrée.'];
    case 'g-toggle': settings.toggleGuidance(f.id); return ['/admin/comportement', 'C’est fait.'];
    case 'g-delete': settings.deleteGuidance(f.id); return ['/admin/comportement', 'Supprimé.'];
    case 'limits': settings.setLimits(f.limit, f.ids); return ['/admin/limites', 'Limites enregistrées. Elles s’appliquent tout de suite.'];
    case 'password':
      if (f.pw !== f.pw2) throw new Error('Les deux mots de passe ne sont pas pareils.');
      settings.setAdminPassword(f.pw); return ['/admin/acces', 'Mot de passe changé. Ton navigateur va peut-être te le redemander.'];
    case 'link-renew': settings.adminLinkToken(true); return ['/admin/acces', 'Nouveau lien créé. L’ancien ne marche plus.'];
    default: throw new Error('Action inconnue.');
  }
}

async function readForm(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 20_000) throw new Error('trop long'); }
  return Object.fromEntries(new URLSearchParams(body));
}

let extraRoute = null;   // (req, res, url) => true when handled (Telegram webhook)

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (extraRoute && (await extraRoute(req, res, url))) return;
  if (url.pathname === '/' || url.pathname === '/health') { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(`LAMP AI ok — version ${VERSION}`); return; }
  if (!url.pathname.startsWith('/admin')) { res.statusCode = 404; res.end(); return; }
  if (!accessOn()) { res.statusCode = 404; res.end(); return; }          // no password at all: no dashboard
  const ip = ipOf(req);
  if (blocked(ip)) { res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Trop d’essais. Réessaie dans 15 minutes.'); return; }
  // magic link: /admin/lien/<token> → a cookie for this browser, then the dashboard
  const linkMatch = url.pathname.match(/^\/admin\/lien\/([\w-]+)$/);
  if (linkMatch) {
    if (!same(linkMatch[1], settings.adminLinkToken())) { failed(ip); res.statusCode = 404; res.end('Lien invalide'); return; }
    res.writeHead(303, { 'Set-Cookie': `${COOKIE}=${cookieValue()}; Path=/admin; Max-Age=${400 * 86400}; HttpOnly; Secure; SameSite=Lax`, Location: '/admin', 'Referrer-Policy': 'no-referrer' });
    res.end(); return;
  }
  if (url.pathname === '/admin/deconnexion') {
    res.writeHead(200, { 'Set-Cookie': `${COOKIE}=; Path=/admin; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page('LAMP', '', '<h1>Déconnecté sur cet appareil</h1><p class="muted">Pour revenir : ton lien magique, ou <a href="/admin">identifiant et mot de passe</a>.</p>'));
    return;
  }
  const auth = req.headers.authorization || '';
  if (!cookieOk(req)) {
    const pair = Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString(); const cut = pair.indexOf(':');
    const user = pair.slice(0, cut); const pass = pair.slice(cut + 1);
    const good = auth.startsWith('Basic ') && user === 'admin' && settings.checkAdminPassword(pass, ADMIN_PASSWORD);
    if (!good) {
      if (auth) failed(ip);
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="LAMP admin", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Accès refusé'); return;
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (url.pathname === '/admin/action') {
    if (req.method !== 'POST') { res.writeHead(303, { Location: '/admin' }); res.end(); return; }
    let to = '/admin'; let msg; let bad = false; let f = {};
    try {
      f = await readForm(req);
      if (!f.csrf || !same(f.csrf, csrf())) throw new Error('Formulaire expiré : recharge la page et recommence.');
      [to, msg, bad] = await action(f);
    } catch (e) {
      msg = e.message; bad = true;
      to = /^key-/.test(f.do) ? '/admin/cles' : /^g-/.test(f.do) ? '/admin/comportement' : f.do === 'limits' ? '/admin/limites'
        : ['password', 'link-renew'].includes(f.do) ? '/admin/acces' : '/admin';
    }
    if (!to.startsWith('/admin')) to = '/admin';
    res.writeHead(303, { Location: `${to}?${bad ? 'err' : 'ok'}=${encodeURIComponent(msg)}` }); res.end();
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const flash = flashOf(url);
  const id = url.searchParams.get('u');
  if (id && (url.pathname === '/admin' || url.pathname === '/admin/conversations')) {
    res.end(page('LAMP — conversation', '/admin/conversations', await personPage(id))); return;
  }
  switch (url.pathname.replace(/\/+$/, '') || '/admin') {
    case '/admin': res.end(page('LAMP — vue d’ensemble', '/admin', overview(), flash)); return;
    case '/admin/conversations': res.end(page('LAMP — conversations', '/admin/conversations', await conversationsPage(url), flash)); return;
    case '/admin/cles': res.end(page('LAMP — clés Gemini', '/admin/cles', keysPage(), flash)); return;
    case '/admin/comportement': res.end(page('LAMP — comportement', '/admin/comportement', behaviourPage(), flash)); return;
    case '/admin/limites': res.end(page('LAMP — limites', '/admin/limites', limitsPage(), flash)); return;
    case '/admin/acces': res.end(page('LAMP — accès', '/admin/acces', accessPage(req), flash)); return;
    default: res.statusCode = 404; res.end(page('LAMP', '', '<p>Page introuvable.</p>'));
  }
}

/** One web server for the admin page and, in webhook mode, Telegram's calls. */
export function startAdmin(route = null) {
  extraRoute = route;
  // under cPanel/Passenger the port is chosen by the host: listen() on anything works
  const port = PORT || (WEBHOOK_URL ? 3000 : 0);
  if (!port && !process.env.PASSENGER_APP_ENV) return;
  http.createServer((req, res) => handle(req, res).catch((e) => { console.error('[Admin]', e.message); res.statusCode = 500; res.end('Erreur'); }))
    .listen(port || 3000, () => console.log(`[Web] listening on ${port || 3000} — /admin ${accessOn() ? 'on' : 'off (no LAMP_ADMIN_PASSWORD)'}${WEBHOOK_URL ? ' — Telegram webhook on' : ''}`));
}
