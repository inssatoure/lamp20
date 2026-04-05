import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, limit, startAfter, orderBy } from "firebase/firestore/lite";
import fs from 'fs';
const firebaseConfig = {
  apiKey: "AIzaSyAWcGI0OZsHPh-IhglG_4MI9ZcQkkmUKw0",
  authDomain: "lampridial-19466.firebaseapp.com",
  projectId: "lampridial-19466",
  storageBucket: "lampridial-19466.firebasestorage.app",
  messagingSenderId: "76433392810",
  appId: "1:76433392810:web:92cac9a34da732f779bcd3"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function exportVersets() {
  console.log("📥 Téléchargement streamé des versets depuis Firebase...");
  let totalCount = 0;
  let lastVisible = null;
  const BATCH_SIZE = 500;
  
  try {
    const outPath = "versets_cache.jsonl";
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    
    while (true) {
      let q;
      if (lastVisible) {
        q = query(collection(db, "versets"), orderBy("__name__"), startAfter(lastVisible), limit(BATCH_SIZE));
      } else {
        q = query(collection(db, "versets"), orderBy("__name__"), limit(BATCH_SIZE));
      }

      const snap = await getDocs(q);
      if (snap.empty) break;

      for (const d of snap.docs) {
        const doc = d.data();
        const line = JSON.stringify({
          t: doc.khassaidTitre,
          n: doc.versetNum,
          c: doc.contextRAG,
          e: doc.embedding || []
        }) + "\n";
        fs.appendFileSync(outPath, line);
        totalCount++;
      }

      lastVisible = snap.docs[snap.docs.length - 1];
      console.log(`⏳ Téléchargé ${totalCount} versets...`);
    }

    console.log(`✅ Succès total : ${totalCount} versets sauvegardés dans ${outPath} !`);
  } catch (error) {
    console.error("❌ Erreur:", error.message);
  }
}
exportVersets();
