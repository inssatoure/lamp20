# LAMP AI — bot Telegram

LAMP répond comme un **talibé de Serigne Touba** : d'abord le **Coran**, puis la **Sunna** (hadiths),
puis les **enseignements de Cheikh Ahmadou Bamba**. Il répond à toutes les questions, mais ne cite que
des textes lus dans une bibliothèque vérifiée.

## Comment une question devient une réponse

```
message (texte ou vocal)
  │
  ├─ 1. comprendre   langue (fr / wo / en), question complète, sujet, Khassaid, versets du Coran probables
  ├─ 2. chercher     Coran · hadiths · Khassaids dans les fichiers (aucune IA ici)
  ├─ 3. répondre     l'IA écrit la réponse ; elle peut relire la bibliothèque (6 outils)
  └─ 4. vérifier     chaque numéro (2:153, Bukhari n°…, distique …) doit venir de la bibliothèque,
                     sinon la réponse est réécrite sans lui
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `app.js` | Telegram uniquement : commandes, messages, vocaux, envoi sûr |
| `lib/prompt.js` | **Qui est LAMP et ses règles** — c'est ici qu'on change sa façon de parler |
| `lib/brain.js` | Les 4 étapes ci-dessus |
| `lib/sources.js` | Lecture du Coran, des hadiths et des Khassaids |
| `lib/ai.js` | Appels aux modèles : délai max, modèle suivant si quota épuisé, Groq en secours |
| `lib/config.js` | Réglages (modèles, délais, dossiers) |
| `lib/voice.js` · `lib/history.js` · `lib/telegram-format.js` | Voix · mémoire des conversations · messages Telegram |

## Sources (bibliothèque vérifiée)

| Source | Contenu | Où |
|---|---|---|
| Coran | texte uthmani + traduction Hamidullah | `sources/` (script `scripts/fetch-sources.mjs`) |
| Hadiths (français) | Bukhari, Muslim, Abu Dawud, Muwatta Malik, 40 Nawawi — 21 758 hadiths | `sources/` |
| Khassaids | 122 textes arabes | `Textes_Arabes_Serigne_Touba/` |
| Recherche par le sens | 7 394 distiques indexés | `versets_cache.jsonl` (script `scripts/cache_vectors.mjs`) |
| Résumés des Khassaids | base du tableau de bord | Firestore `knowledge_base` |

Les notes automatiques de Firestore (`ai_memory`) ne sont **plus** injectées comme des faits : elles n'étaient
pas vérifiées (une note disait que Mawahibu a 212 vers, le texte en a 166). Seules les notes d'orthographe sont gardées.

## Installer sur le serveur

```bash
# dans le dossier du bot (ex: ~/lamp.metafrik.com), avec app.js, lib/, package.json
npm install
node scripts/fetch-sources.mjs        # Coran + hadiths → sources/
node scripts/cache_vectors.mjs        # index des Khassaids → versets_cache.jsonl (si absent)
cp .env.example .env                  # puis mettre TELEGRAM_TOKEN, GEMINI_API_KEY (et GROQ_API_KEY)
node app.js                           # ou start.sh / pm2_setup.sh
```

Le dossier de données est trouvé tout seul : celui qui contient `Textes_Arabes_Serigne_Touba`
(ou `LAMP_ROOT_DIR` si défini).

## Stabilité

- Messages longs découpés (limite Telegram 4096), mise en forme HTML sûre avec repli en texte simple
- Une question à la fois par conversation (pas de mélange quand on envoie plusieurs messages)
- Chaque appel IA a un délai maximum de 60 s ; modèle suivant si le quota est épuisé ; Groq en dernier recours
- Le bot ne s'arrête pas sur une erreur inattendue ; il relance la connexion Telegram si le réseau coupe
- Il supprime un ancien webhook au démarrage et signale clairement le conflit « 409 » (deux bots sur le même token)
- Les messages reçus pendant que le bot était éteint (plus de 2 min) sont ignorés au redémarrage

## Commandes

`/start` · `/help` · `/khassaids` (liste et nombre de distiques) · `/clear` (nouvelle conversation)
