// LAMP AI — small password-protected page to read users' conversations.
//   http://<server>:<PORT>/admin   (login: admin / LAMP_ADMIN_PASSWORD)
// Runs inside the bot process; on Railway, PORT is given automatically.
import http from 'http';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { ADMIN_PASSWORD, PORT, WEBHOOK_URL } from './config.js';
import { listUsers, getMessages, backend } from './store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const same = (a, b) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const date = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Africa/Dakar', dateStyle: 'short', timeStyle: 'short' }) : '');

const page = (title, body) => `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root{--bg:#f4f1ea;--card:#fffdf8;--ink:#1f2a24;--muted:#6b756f;--green:#1e5b3f;--line:#e2ddd1}
@media (prefers-color-scheme:dark){:root{--bg:#121714;--card:#1a211d;--ink:#e8ece9;--muted:#9aa59f;--green:#7cc79e;--line:#2b342f}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 Georgia,serif}
main{max-width:860px;margin:0 auto;padding:24px 16px}h1{font-size:28px;margin:0 0 4px}a{color:var(--green)}
.muted{color:var(--muted);font-size:14px}.u{display:block;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:10px 0;text-decoration:none;color:inherit}
.u b{color:var(--green)}.mem{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.m{border-radius:14px;padding:10px 14px;margin:8px 0;max-width:85%;white-space:pre-wrap;word-wrap:break-word}
.user{background:var(--green);color:#fff;margin-left:auto}.model{background:var(--card);border:1px solid var(--line)}
.sess{text-align:left;color:var(--muted);font-size:13px;margin:22px 0 4px;border-top:1px solid var(--line);padding-top:8px}
</style></head><body><main>${body}</main></body></html>`;

// the code version running now (shown on /health, to check that automatic updates arrived)
const VERSION = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }).trim(); } catch { return 'inconnue'; } })();

let extraRoute = null;   // (req, res, url) => true when handled (Telegram webhook)

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (extraRoute && (await extraRoute(req, res, url))) return;
  if (url.pathname === '/' || url.pathname === '/health') { res.end(`LAMP AI ok — version ${VERSION}`); return; }
  if (!url.pathname.startsWith('/admin')) { res.statusCode = 404; res.end(); return; }
  const [user, pass] = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString().split(':');
  if (!ADMIN_PASSWORD || user !== 'admin' || !same(pass || '', ADMIN_PASSWORD)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="LAMP admin"' }); res.end('Accès refusé'); return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const id = url.searchParams.get('u');
  if (!id) {
    const users = await listUsers();
    res.end(page('LAMP — conversations', `<h1>Conversations LAMP AI</h1>
<p class="muted">${users.length} personne(s) · stockage : ${backend === 'firestore' ? 'Firestore' : 'fichiers du serveur'}</p>
${users.map((u) => `<a class="u" href="/admin?u=${encodeURIComponent(u.id)}"><b>${esc(u.profile.name || 'Sans nom')}</b>
${u.profile.username ? ` · @${esc(u.profile.username)}` : ''}<br><span class="muted">${u.profile.count || 0} message(s) · dernier : ${date(u.profile.last_seen)} · langue : ${esc(u.profile.lang || '?')}</span></a>`).join('')}`));
    return;
  }
  const [users, msgs] = await Promise.all([listUsers(), getMessages(id)]);
  const u = users.find((x) => x.id === id) || { profile: {}, memory: '' };
  let lastSession = null;
  const body = msgs.map((m) => {
    const head = m.session !== lastSession ? `<div class="sess">Conversation ${esc(m.session || 1)} · ${date(m.ts)}</div>` : '';
    lastSession = m.session;
    return `${head}<div dir="auto" class="m ${m.role === 'user' ? 'user' : 'model'}">${m.voice ? '🎙️ ' : ''}${esc(m.text)}</div>`;
  }).join('');
  res.end(page(`LAMP — ${u.profile.name || id}`, `<p><a href="/admin">← toutes les conversations</a></p>
<h1>${esc(u.profile.name || 'Sans nom')}</h1><p class="muted">${u.profile.username ? `@${esc(u.profile.username)} · ` : ''}première visite : ${date(u.profile.first_seen)}</p>
<h2>Mémoire du bot</h2><div class="mem">${esc(u.memory || '(rien encore)')}</div><h2>Messages</h2>${body || '<p class="muted">Aucun message.</p>'}`));
}

/** One web server for the admin page and, in webhook mode, Telegram's calls. */
export function startAdmin(route = null) {
  extraRoute = route;
  // under cPanel/Passenger the port is chosen by the host: listen() on anything works
  const port = PORT || (WEBHOOK_URL ? 3000 : 0);
  if (!port && !process.env.PASSENGER_APP_ENV) return;
  http.createServer((req, res) => handle(req, res).catch((e) => { console.error('[Admin]', e.message); res.statusCode = 500; res.end('Erreur'); }))
    .listen(port || 3000, () => console.log(`[Web] listening on ${port || 3000} — /admin ${ADMIN_PASSWORD ? 'on' : 'off (no LAMP_ADMIN_PASSWORD)'}${WEBHOOK_URL ? ' — Telegram webhook on' : ''}`));
}
