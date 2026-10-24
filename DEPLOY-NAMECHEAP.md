# Installer LAMP AI sur Namecheap Stellar (cPanel)

Sur l'hébergement mutualisé, le bot fonctionne en **mode webhook** : Telegram appelle ton site à chaque
message. Il se met à jour tout seul depuis GitHub toutes les 10 minutes.

Il faut : un nom de domaine (ou sous-domaine) en **https** sur cet hébergement, et les clés (Telegram,
Gemini, Groq, Cerebras).

## 1. Le sous-domaine
1. cPanel → **Domains** → créer `lamp.tondomaine.com` (dossier par défaut).
2. cPanel → **SSL/TLS Status** → cocher le sous-domaine → **Run AutoSSL** (https gratuit).

## 2. Le code
cPanel → **Terminal** :
```bash
cd ~
git clone https://github.com/inssatoure/lamp20.git
```

## 3. L'application Node.js
cPanel → **Setup Node.js App** → **Create Application** :
- Node.js version : la plus récente (22 ou 20)
- Application mode : **Production**
- Application root : `lamp20/deploy-bot`
- Application URL : `lamp.tondomaine.com`
- Application startup file : `start.cjs` (pas `app.js` : cPanel charge le fichier avec require())

Puis **Environment variables** (Add Variable) :

| Nom | Valeur |
|---|---|
| `TELEGRAM_TOKEN` | le token de @Lamp_ai_bot |
| `GEMINI_API_KEYS` | les clés Gemini séparées par des virgules |
| `GROQ_API_KEY` | la clé Groq |
| `CEREBRAS_API_KEY` | la clé Cerebras |
| `LAMP_WEBHOOK_URL` | `https://lamp.tondomaine.com/telegram` |
| `LAMP_WEBHOOK_SECRET` | un long mot au hasard (ex. 30 lettres et chiffres) |
| `LAMP_ADMIN_PASSWORD` | ton mot de passe pour lire les conversations |
| `LAMP_DATA_DIR` | `/home/TONUTILISATEUR/lamp-data` |

Enregistrer, puis **Run NPM Install**.

## 4. Les sources (Coran, hadiths) et l'index
En haut de la page de l'application, cPanel affiche une commande « Enter to the virtual environment ».
La copier dans le **Terminal**, puis :
```bash
cd ~/lamp20
node scripts/fetch-sources.mjs          # Coran + hadiths (quelques minutes)
bash deploy-bot/scripts/get-index.sh    # index de recherche des Khassaids (~280 Mo)
```
Puis **Restart** dans Setup Node.js App.

## 5. Vérifier
- Ouvrir `https://lamp.tondomaine.com/health` → doit afficher `LAMP AI ok`.
- Envoyer `/start` au bot sur Telegram.
- Conversations : `https://lamp.tondomaine.com/admin` (identifiant `admin`).

## 6. Mise à jour automatique
cPanel → **Cron Jobs** → toutes les 10 minutes (`*/10 * * * *`), commande (remplacer le chemin
`nodevenv/...` par celui affiché à l'étape 4, sans le `cd`) :
```bash
source /home/TONUTILISATEUR/nodevenv/lamp20/deploy-bot/22/bin/activate && bash /home/TONUTILISATEUR/lamp20/deploy-bot/scripts/update.sh >> /home/TONUTILISATEUR/lamp-update.log 2>&1
```
Le script prend la nouvelle version sur GitHub, vérifie qu'elle se charge (sinon il garde l'ancienne)
et redémarre le bot. Journal : `~/lamp-update.log`.

## Important
- **Une seule copie du bot à la fois.** Une copie lancée ailleurs en mode normal (polling) supprime le
  webhook. Arrêter toutes les autres copies.
- Les vocaux utilisent le ffmpeg installé avec le bot (paquet `ffmpeg-static`) : rien à installer.
