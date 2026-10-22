# LAMP AI — Guide de déploiement

## 1. Web App (Site statique)

Le dossier `dist/` contient le site web compilé (HTML/CSS/JS).

### Déploiement sur Namecheap cPanel :

1. Connecte-toi à **cPanel** sur server358.web-hosting.com
2. Ouvre **File Manager**
3. Va dans `public_html/` (ou le sous-domaine souhaité, ex: `public_html/lamp/`)
4. **Upload** tout le contenu du dossier `dist/` :
   - `index.html`
   - `assets/` (dossier entier)
5. C'est tout ! Le site est en ligne.

### Avec SSH :
```bash
ssh -p 21098 ton_user@server358.web-hosting.com
cd ~/public_html
# Upload via scp depuis ton Mac :
scp -P 21098 -r dist/* ton_user@server358.web-hosting.com:~/public_html/
```

---

## 2. Bot Telegram (Node.js)

Le bot est dans `deploy-bot/` — voir **`deploy-bot/README.md`** pour son fonctionnement.

### Installation sur le serveur (cPanel, dossier `~/lamp.metafrik.com`)
1. Copier dans le dossier : `deploy-bot/app.js`, `deploy-bot/lib/`, `deploy-bot/package.json`,
   `deploy-bot/.env.example`, `deploy-bot/start.sh`, et le dossier `scripts/`
   (le dossier `Textes_Arabes_Serigne_Touba/` doit aussi y être).
2. `cp .env.example .env` puis remplir `TELEGRAM_TOKEN`, `GEMINI_API_KEY` (et `GROQ_API_KEY`, `ELEVENLABS_API_KEY` pour les vocaux en wolof).
3. `npm install`
4. `node scripts/fetch-sources.mjs` (Coran + hadiths → `sources/`)
5. Si `versets_cache.jsonl` est absent : `node scripts/cache_vectors.mjs`
6. Démarrer : `bash start.sh` (ou `pm2_setup.sh`, ou cPanel > Setup Node.js App > startup file `app.js`)

### Vérifier
- Les journaux affichent `[LAMP] Started — polling Telegram as @Lamp_ai_bot`
- Envoyer `/start` au bot

### Erreur « 409 Conflict » dans les journaux
Deux programmes utilisent le même token (ancien serveur, pm2, ordinateur local). En arrêter un.

---

## 3. Notes importantes

- **Clés API** : uniquement dans le fichier `.env` du serveur (jamais dans GitHub). Les anciennes clés publiées sur GitHub doivent être changées.
- **Firestore Rules** : Assure-toi que les règles Firestore permettent la lecture/écriture :
  ```
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /{document=**} {
        allow read, write: if true;
      }
    }
  }
  ```
- **Bot Telegram** : Un seul processus peut utiliser le même token en mode polling. Si tu le lances en local ET sur le serveur, il y aura des conflits. Arrête le local avant.


## Mémoire des utilisateurs et lecture des conversations

- Chaque personne a sa mémoire : le bot se souvient d'elle d'une fois sur l'autre (prénom, sujets, ce qu'elle apprend).
  Une conversation recommence après 6 h de silence ou avec /clear ; la mémoire, elle, reste. /oublie efface tout.
- Les messages sont gardés dans `LAMP_DATA_DIR` (un fichier par personne). Ce dossier doit survivre aux mises à jour :
  sur Railway, créer un volume (ex. `/data`) et mettre `LAMP_DATA_DIR=/data`.
- Pour lire les conversations : mettre `LAMP_ADMIN_PASSWORD` et `PORT`, puis ouvrir `https://<adresse>/admin`
  (identifiant `admin`). Sur Railway, activer un domaine public pour le service.
- Option Firestore : mettre `FIREBASE_SERVICE_ACCOUNT` (compte de service du projet Firebase). Les conversations vont
  alors dans la collection `lamp_users`. Avant cela, fermer les règles Firestore au public (aujourd'hui tout le monde
  peut lire et écrire la base avec la clé web, qui est dans le dépôt public).
