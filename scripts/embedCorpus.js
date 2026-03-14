#!/usr/bin/env node

/**
 * Script: Embed all corpus items with Gemini text-embedding-004
 * Uses REST API directly to avoid SDK issues
 */

import fetch from 'node-fetch';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY env var not set');
  process.exit(1);
}

const firebaseConfig = {
  apiKey: "AIzaSyAWcGI0OZsHPh-IhglG_4MI9ZcQkkmUKw0",
  authDomain: "lampridial-19466.firebaseapp.com",
  projectId: "lampridial-19466",
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

async function embedText(text) {
  const url = `https://generativelanguage.googleapis.com/v1/models/embedding-001:embedContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/embedding-001',
      content: { parts: [{ text: text.substring(0, 2000) }] },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API: ${response.status} ${error}`);
  }

  const data = await response.json();
  return data.embedding?.values || [];
}

async function embedCorpus() {
  console.log('Starting corpus embedding...');
  const snap = await getDocs(collection(db, 'knowledge_base'));
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  console.log(`Found ${items.length} corpus items to embed`);

  let succeeded = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const textToEmbed = `${item.title}\n${item.frenchSummary || ''}\n${item.wolofSummary || ''}\n${item.sourceRef || ''}`;
      const embedding = await embedText(textToEmbed);

      if (!embedding || embedding.length === 0) {
        throw new Error('No embedding returned');
      }

      await updateDoc(doc(db, 'knowledge_base', item.id), {
        embedding: embedding,
        embeddedAt: new Date().toISOString(),
      });

      console.log(`✓ [${succeeded + 1}/${items.length}] ${item.title}`);
      succeeded++;

      // Rate limit: 100 requests per minute (600ms)
      await new Promise(r => setTimeout(r, 600));
    } catch (error) {
      console.error(`✗ Failed to embed "${item.title}":`, error.message);
      failed++;
    }
  }

  console.log(`\n✅ Embedding complete: ${succeeded} succeeded, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

embedCorpus().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
