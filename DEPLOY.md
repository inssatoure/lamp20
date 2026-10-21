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
2. `cp .env.example .env` puis remplir `TELEGRAM_TOKEN`, `GEMINI_API_KEY` (et `GROQ_API_KEY` si possible).
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
