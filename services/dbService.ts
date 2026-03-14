
import { db } from './firebase';
// Fix: Using @firebase/firestore to resolve "no exported member" errors which sometimes occur with the main package path in specific TS environments.
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, query, orderBy } from '@firebase/firestore';
import { CorpusItem } from '../types';
import { GoogleGenAI } from '@google/genai';

const COLLECTION_NAME = 'knowledge_base';

// Embedding client
const getEmbeddingClient = () => {
  return new GoogleGenAI({ apiKey: process.env.REACT_APP_GEMINI_API_KEY || process.env.GEMINI_API_KEY });
};

/**
 * Generate embedding vector for text using Gemini text-embedding-004
 * Supports Arabic, French, Wolof, English
 */
export const embedText = async (text: string): Promise<number[]> => {
  try {
    const ai = getEmbeddingClient();
    const response = await ai.models.embedContent({
      model: 'text-embedding-004',
      content: { parts: [{ text: text.substring(0, 2000) }] }, // API limit
    });
    const embedding = response.embedding?.values || [];
    if (embedding.length === 0) throw new Error("No embedding returned");
    return embedding as number[];
  } catch (error) {
    console.error("[Embedding] Error:", error);
    throw error;
  }
};

/**
 * Cosine similarity between two vectors
 */
const cosineSimilarity = (a: number[], b: number[]): number => {
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }
  const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
};

export const getAllCorpusItems = async (): Promise<CorpusItem[]> => {
  try {
    const q = query(collection(db, COLLECTION_NAME));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as CorpusItem));
  } catch (error) {
    console.error("Error fetching corpus:", error);
    return [];
  }
};

export const addCorpusItem = async (item: CorpusItem): Promise<void> => {
  try {
    // Remove id from item before adding, let Firestore generate or use provided if setting manually
    const { id, ...data } = item; 
    await addDoc(collection(db, COLLECTION_NAME), data);
  } catch (error) {
    console.error("Error adding item:", error);
    throw error;
  }
};

export const updateCorpusItem = async (item: CorpusItem): Promise<void> => {
  try {
    const { id, ...data } = item;
    if (!id) throw new Error("Item ID required for update");
    const itemRef = doc(db, COLLECTION_NAME, id);
    await updateDoc(itemRef, data as any);
  } catch (error) {
    console.error("Error updating item:", error);
    throw error;
  }
};

export const deleteCorpusItem = async (id: string): Promise<void> => {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
  } catch (error) {
    console.error("Error deleting item:", error);
    throw error;
  }
};

// Synonyms that map common user terms to corpus-searchable terms
const SYNONYMS: Record<string, string[]> = {
  // Names & identity
  'serigne touba': ['cheikh ahmadou bamba', 'khassaid', 'khadimou rassoul'],
  'khadim rassoul': ['cheikh ahmadou bamba', 'khassaid'],
  'khadimou': ['cheikh ahmadou bamba', 'khassaid'],
  'touba': ['cheikh ahmadou bamba', 'khassaid'],
  'bamba': ['cheikh ahmadou bamba', 'khassaid'],
  'mouride': ['cheikh ahmadou bamba', 'khassaid'],
  'murid': ['cheikh ahmadou bamba', 'khassaid'],
  // Khassaid name variants
  'poem': ['khassaid'], 'poème': ['khassaid'],
  'xassida': ['khassaid'], 'khassida': ['khassaid'],
  'kassida': ['khassaid'], 'qasida': ['khassaid'],
  'xassaid': ['khassaid'], 'khasside': ['khassaid'],
  // Prayer & worship
  'prayer': ['khassaid', 'quran'], 'prière': ['khassaid', 'quran'],
  'dua': ['khassaid'], 'wird': ['khassaid'],
  'zikr': ['khassaid'], 'dhikr': ['khassaid'],
  'jàng': ['khassaid', 'quran'],
  // ── THEMATIC TOPICS (French, English, Wolof) ──
  // These let users search by TOPIC and find Khassaid + Quran on that theme
  'pardon': ['khassaid', 'quran', 'forgiveness', 'maghfira', 'baal'],
  'forgiveness': ['khassaid', 'quran', 'pardon', 'maghfira'],
  'baal': ['khassaid', 'pardon', 'forgiveness'],
  'patience': ['khassaid', 'quran', 'muñ', 'sabr', 'sabur'],
  'muñ': ['khassaid', 'quran', 'patience', 'sabr'],
  'sabr': ['khassaid', 'quran', 'patience'],
  'amour': ['khassaid', 'quran', 'love', 'sopp', 'hubb'],
  'love': ['khassaid', 'quran', 'amour', 'sopp'],
  'sopp': ['khassaid', 'amour', 'love'],
  'foi': ['khassaid', 'quran', 'faith', 'ngëm', 'iman'],
  'faith': ['khassaid', 'quran', 'foi', 'iman'],
  'ngëm': ['khassaid', 'quran', 'faith', 'foi'],
  'iman': ['khassaid', 'quran', 'faith', 'foi'],
  'repentir': ['khassaid', 'quran', 'repentance', 'tawba', 'tuub'],
  'repentance': ['khassaid', 'quran', 'repentir', 'tawba'],
  'tawba': ['khassaid', 'quran', 'repentance', 'repentir'],
  'tuub': ['khassaid', 'repentir', 'tawba'],
  'dieu': ['khassaid', 'quran', 'god', 'yàlla', 'allah'],
  'god': ['khassaid', 'quran', 'dieu', 'allah'],
  'yàlla': ['khassaid', 'quran', 'dieu', 'allah'],
  'allah': ['khassaid', 'quran', 'dieu', 'yàlla'],
  'prophète': ['khassaid', 'quran', 'prophet', 'yonent', 'muhammad', 'nabi'],
  'prophet': ['khassaid', 'quran', 'prophète', 'muhammad'],
  'muhammad': ['khassaid', 'quran', 'prophète', 'yonent'],
  'yonent': ['khassaid', 'quran', 'prophète', 'muhammad'],
  'travail': ['khassaid', 'quran', 'work', 'liggéey'],
  'work': ['khassaid', 'quran', 'travail', 'liggéey'],
  'liggéey': ['khassaid', 'travail', 'work'],
  'science': ['khassaid', 'quran', 'xam', 'knowledge', 'ilm'],
  'knowledge': ['khassaid', 'quran', 'science', 'xam', 'ilm'],
  'xam': ['khassaid', 'science', 'knowledge'],
  'mort': ['khassaid', 'quran', 'death', 'dee'],
  'death': ['khassaid', 'quran', 'mort', 'dee'],
  'dee': ['khassaid', 'mort', 'death'],
  'paradis': ['khassaid', 'quran', 'paradise', 'janna', 'àllaaxira'],
  'paradise': ['khassaid', 'quran', 'paradis', 'janna'],
  'janna': ['khassaid', 'quran', 'paradis', 'paradise'],
  'enfer': ['khassaid', 'quran', 'hell', 'jahannam', 'safara'],
  'péché': ['khassaid', 'quran', 'sin', 'bàkkaar'],
  'sin': ['khassaid', 'quran', 'péché'],
  'gratitude': ['khassaid', 'quran', 'shukr', 'sant'],
  'sant': ['khassaid', 'gratitude', 'shukr'],
  'humilité': ['khassaid', 'quran', 'humility', 'rafet'],
  'humility': ['khassaid', 'quran', 'humilité'],
  'justice': ['khassaid', 'quran', 'adl'],
  'miséricorde': ['khassaid', 'quran', 'mercy', 'rahma', 'yërëm'],
  'mercy': ['khassaid', 'quran', 'miséricorde', 'rahma'],
  'rahma': ['khassaid', 'quran', 'miséricorde', 'mercy'],
  'yërëm': ['khassaid', 'miséricorde', 'mercy'],
};

// Format a corpus item for the AI context
// fullContent=true returns the entire Arabic text (for direct title requests)
const formatCorpusItem = (item: CorpusItem, fullContent = false): string => {
  const ext = item as any;
  let entry = `[${item.category}] ${item.title}`;
  if (item.sourceRef) entry += ` — Ref: ${item.sourceRef}`;
  if (ext.themes) entry += `\nThèmes: ${ext.themes.join(', ')}`;
  if (ext.frenchSummary) entry += `\nRésumé: ${ext.frenchSummary}`;
  if (ext.wolofSummary) entry += `\nWolof: ${ext.wolofSummary}`;
  // For direct matches return full Arabic text; otherwise cap at 2000 chars
  const limit = fullContent ? Infinity : 2000;
  const content = item.content.length > limit ? item.content.substring(0, limit) + '...' : item.content;
  entry += `\nArabe (texte complet): ${content}`;
  return entry;
};

/**
 * Vector search: semantically find relevant corpus items
 * Uses Gemini embeddings + cosine similarity
 * Falls back to keyword search if embedding fails
 */
export const searchCorpus = async (queryText: string): Promise<string> => {
  const items = await getAllCorpusItems();
  if (items.length === 0) return "";

  try {
    // Embed the query
    const queryEmbedding = await embedText(queryText);

    // Score each item by semantic similarity
    const scored = items.map(item => {
      let itemEmbedding = (item as any).embedding;

      // If no embedding stored, generate it now (first-time use)
      if (!itemEmbedding) {
        // For now, skip items without embeddings (will be generated during admin task)
        return { item, score: 0 };
      }

      const similarity = cosineSimilarity(queryEmbedding, itemEmbedding);
      return { item, score: similarity };
    }).filter(s => s.score > 0);

    // If we have semantic matches, return top 5
    if (scored.length > 0) {
      scored.sort((a, b) => b.score - a.score);
      const topScore = scored[0].score;
      const secondScore = scored[1]?.score ?? 0;
      // Direct match: high similarity AND clear gap to second result
      const isDirectMatch = topScore > 0.75 && topScore > secondScore + 0.15;

      return scored.slice(0, 5).map((s, i) =>
        formatCorpusItem(s.item, i === 0 && isDirectMatch)
      ).join("\n---\n");
    }

    // FALLBACK: If no embeddings exist or no matches, do keyword search
    return keywordSearchCorpus(queryText, items);
  } catch (error) {
    console.warn("[Vector Search] Failed, falling back to keywords:", error);
    return keywordSearchCorpus(queryText, items);
  }
};

/**
 * Fallback keyword search (for when vector embeddings not available)
 */
const keywordSearchCorpus = (queryText: string, items: CorpusItem[]): string => {
  const lowerQuery = queryText.toLowerCase();

  // Expand query with synonyms
  let expandedKeywords = lowerQuery.split(/\s+/).filter(w => w.length > 2);
  expandedKeywords.push(lowerQuery);

  // Check for synonym matches and expand
  let categoryHint = '';
  for (const [trigger, expansions] of Object.entries(SYNONYMS)) {
    if (lowerQuery.includes(trigger)) {
      expandedKeywords.push(...expansions);
      if (expansions.includes('khassaid')) categoryHint = 'Khassaid';
      if (expansions.includes('quran')) categoryHint = 'Quran';
    }
  }

  // Score each item — search in enriched fields
  const scored = items.map(item => {
    const themes = ((item as any).themes || []).join(' ');
    const searchable = `${item.title} ${(item as any).frenchSummary || ''} ${(item as any).wolofSummary || ''} ${themes} ${item.sourceRef || ''} ${item.category}`.toLowerCase();
    let score = 0;

    for (const kw of expandedKeywords) {
      if (searchable.includes(kw)) score++;
      if (item.title.toLowerCase().includes(kw)) score += 3;
      if (themes.toLowerCase().includes(kw)) score += 4;
      if (item.category.toLowerCase() === kw) score += 5;
    }

    if (categoryHint && item.category === categoryHint) score += 3;
    return { item, score };
  }).filter(s => s.score > 0);

  if (scored.length > 0) {
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map((s, i) =>
      formatCorpusItem(s.item, i === 0 && scored[0].score > 8)
    ).join("\n---\n");
  }

  // Fallback catalog
  const byCategory = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item.title);
    return acc;
  }, {} as Record<string, string[]>);

  let catalog = "AVAILABLE LIBRARY CATALOG (no direct match found):\n";
  for (const [cat, titles] of Object.entries(byCategory)) {
    catalog += `\n[${cat}] ${titles.length} documents: ${titles.slice(0, 15).join(', ')}`;
    if (titles.length > 15) catalog += `, ... and ${titles.length - 15} more`;
  }
  return catalog;
};
