
import { db } from './firebase';
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, query, where, orderBy } from '@firebase/firestore';
import { MemoryItem, MemoryStatus, MemorySource } from '../types';

const COLLECTION_NAME = 'ai_memory';

// ─── READ ───

export const getAllMemories = async (): Promise<MemoryItem[]> => {
  try {
    const q = query(collection(db, COLLECTION_NAME), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as MemoryItem));
  } catch (error) {
    console.error("Error fetching memories:", error);
    return [];
  }
};

export const getActiveMemories = async (): Promise<MemoryItem[]> => {
  try {
    const q = query(
      collection(db, COLLECTION_NAME),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as MemoryItem));
  } catch (error) {
    console.error("Error fetching active memories:", error);
    return [];
  }
};

export const getPendingMemories = async (): Promise<MemoryItem[]> => {
  try {
    const q = query(
      collection(db, COLLECTION_NAME),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as MemoryItem));
  } catch (error) {
    console.error("Error fetching pending memories:", error);
    return [];
  }
};

// ─── WRITE ───

export const addMemory = async (memory: Omit<MemoryItem, 'id'>): Promise<string> => {
  try {
    const docRef = await addDoc(collection(db, COLLECTION_NAME), memory);
    return docRef.id;
  } catch (error) {
    console.error("Error adding memory:", error);
    throw error;
  }
};

/**
 * Save a memory from the master (admin) — auto-approved, immediately active.
 */
export const saveMasterMemory = async (
  content: string,
  type: MemoryItem['type'],
  context?: string,
  tags?: string[]
): Promise<string> => {
  return addMemory({
    content,
    context,
    type,
    source: 'master',
    status: 'active',
    createdAt: Date.now(),
    tags,
  });
};

/**
 * Save a memory from a community user — status = 'pending' until admin validates.
 */
export const saveCommunityMemory = async (
  content: string,
  type: MemoryItem['type'],
  userId: string,
  context?: string,
  tags?: string[]
): Promise<string> => {
  return addMemory({
    content,
    context,
    type,
    source: 'community',
    status: 'pending',
    createdAt: Date.now(),
    userId,
    tags,
  });
};

// ─── ADMIN ACTIONS ───

export const validateMemory = async (id: string, adminId: string): Promise<void> => {
  try {
    const ref = doc(db, COLLECTION_NAME, id);
    await updateDoc(ref, {
      status: 'active' as MemoryStatus,
      validatedAt: Date.now(),
      validatedBy: adminId,
    });
  } catch (error) {
    console.error("Error validating memory:", error);
    throw error;
  }
};

export const rejectMemory = async (id: string): Promise<void> => {
  try {
    const ref = doc(db, COLLECTION_NAME, id);
    await updateDoc(ref, { status: 'rejected' as MemoryStatus });
  } catch (error) {
    console.error("Error rejecting memory:", error);
    throw error;
  }
};

export const deleteMemory = async (id: string): Promise<void> => {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
  } catch (error) {
    console.error("Error deleting memory:", error);
    throw error;
  }
};

export const updateMemory = async (id: string, updates: Partial<MemoryItem>): Promise<void> => {
  try {
    const ref = doc(db, COLLECTION_NAME, id);
    const { id: _, ...data } = updates as any;
    await updateDoc(ref, data);
  } catch (error) {
    console.error("Error updating memory:", error);
    throw error;
  }
};

// ─── BUILD MEMORY CONTEXT FOR SYSTEM INSTRUCTION ───

/**
 * Builds a formatted string of all active memories to inject into the system prompt.
 * This is what makes the AI "never forget" — every active memory is always present.
 */
export const buildMemoryContext = async (): Promise<string> => {
  const memories = await getActiveMemories();
  if (memories.length === 0) return "";

  const grouped: Record<string, string[]> = {};
  for (const m of memories) {
    const key = m.type;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(m.content);
  }

  let context = "=== PERMANENT AI MEMORY (NEVER IGNORE THESE) ===\n";
  context += "These are verified teachings from your Master and validated community knowledge. Follow them strictly.\n\n";

  if (grouped.correction) {
    context += "## CORRECTIONS (You were wrong before, now you know better):\n";
    context += grouped.correction.map((c, i) => `${i + 1}. ${c}`).join('\n') + '\n\n';
  }
  if (grouped.teaching) {
    context += "## TEACHINGS FROM THE MASTER:\n";
    context += grouped.teaching.map((c, i) => `${i + 1}. ${c}`).join('\n') + '\n\n';
  }
  if (grouped.preference) {
    context += "## BEHAVIORAL RULES:\n";
    context += grouped.preference.map((c, i) => `${i + 1}. ${c}`).join('\n') + '\n\n';
  }
  if (grouped.fact) {
    context += "## VERIFIED FACTS:\n";
    context += grouped.fact.map((c, i) => `${i + 1}. ${c}`).join('\n') + '\n\n';
  }
  if (grouped.terminology) {
    context += "## TERMINOLOGY & DEFINITIONS:\n";
    context += grouped.terminology.map((c, i) => `${i + 1}. ${c}`).join('\n') + '\n\n';
  }
  if (grouped.user_insight) {
    context += "## VALIDATED COMMUNITY INSIGHTS:\n";
    context += grouped.user_insight.map((c, i) => `${i + 1}. ${c}`).join('\n') + '\n\n';
  }

  return context;
};
