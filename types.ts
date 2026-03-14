export enum Role {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system'
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role?: 'admin' | 'user';
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  userId: string;
  lastMessage?: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  audioUrl?: string; // For potential audio playback of messages
  isThinking?: boolean; // For UI state
  thoughts?: string; // If model returns reasoning
  translations?: {
    [key: string]: string; // 'fr' | 'en' | 'wo' -> translated text
  };
  isTranslating?: boolean;
}

export interface Khassaid {
  title: string;
  content: string;
}

export interface CorpusItem {
  id: string;
  title: string;
  content: string;
  category: 'Quran' | 'Hadith' | 'Khassaid' | 'Fatwa' | 'General';
  addedAt: number;
  addedBy?: string;
  // Enhanced reference fields
  sourceRef?: string;       // e.g. "Quran 2:255" or "Mafatihul Bishri, v.12"
  wolofText?: string;       // Wolof transcription of the content
  arabicText?: string;      // Original Arabic text
  language?: 'ar' | 'wo' | 'fr' | 'en' | 'mixed';
}

// === AI MEMORY SYSTEM ===

export type MemorySource = 'master' | 'community';
export type MemoryStatus = 'active' | 'pending' | 'rejected';
export type MemoryType =
  | 'correction'      // AI said something wrong, master corrected it
  | 'teaching'        // Master taught AI new knowledge
  | 'preference'      // How master wants AI to behave
  | 'fact'            // Religious fact or historical detail
  | 'terminology'     // Specific term definitions (Wolof/Arabic/French)
  | 'user_insight';   // Something learned from a community user interaction

export interface MemoryItem {
  id: string;
  content: string;           // The actual knowledge/instruction
  context?: string;          // What triggered this memory (the conversation context)
  type: MemoryType;
  source: MemorySource;      // 'master' = auto-approved, 'community' = needs validation
  status: MemoryStatus;      // 'active' = in use, 'pending' = awaiting admin review
  createdAt: number;
  validatedAt?: number;      // When admin approved it
  validatedBy?: string;      // Admin who approved
  userId?: string;           // Who triggered this learning
  tags?: string[];           // For categorization: ['wolof', 'quran', 'khassaid', etc.]
}

export interface AppSettings {
  autoSpeak: boolean;
  theme: 'light' | 'dark';
  voiceURI: string;
  speechRate: number;
}

export interface AudioState {
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;
}

export interface Voice {
  name: string;
  lang: string;
  voiceURI: string;
  isCustom?: boolean;
}