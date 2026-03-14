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

Le dossier `deploy-bot/` contient le bot Telegram autonome.

### Déploiement sur Namecheap cPanel :

#### Étape 1 — Upload des fichiers
1. Via **File Manager**, crée un dossier `lamp-bot` dans ton répertoire home (`~/`)
2. Upload les fichiers du dossier `deploy-bot/` dans `~/lamp-bot/` :
   - `app.js`
   - `package.json`
   - `.env`

#### Étape 2 — Configurer Node.js App dans cPanel
1. Va dans **cPanel > Setup Node.js App**
2. Clique **Create Application**
3. Configuration :
   - **Node.js version** : la plus récente disponible (18+ recommandé)
   - **Application mode** : Production
   - **Application root** : `lamp-bot`
   - **Application URL** : (laisse vide ou mets un sous-domaine inutilisé)
   - **Application startup file** : `app.js`
4. Clique **Create**

#### Étape 3 — Installer les dépendances
1. Dans la page de l'app Node.js, clique **"Run NPM Install"**
2. Attends que ça finisse

#### Étape 4 — Démarrer le bot
1. Clique **"Start App"**
2. Le bot est maintenant actif sur `t.me/aboridialbot`

#### Vérifier que ça marche :
- Va sur Telegram, envoie `/start` à @aboridialbot
- Le bot devrait répondre

#### Redémarrer le bot :
- cPanel > Setup Node.js App > ton app > **Restart**

---

## 3. Notes importantes

- **Clés API** : Les clés sont dans `deploy-bot/.env` et dans le build web. En production, tu devrais les protéger.
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
