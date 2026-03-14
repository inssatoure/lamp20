
import { useState, useEffect, useCallback, useRef } from 'react';
import { Message, Role, ChatSession } from '../types';
import { analyzeDeeply, getChatResponseStream, extractMemoryFromConversation } from '../services/geminiService';
import { searchCorpus } from '../services/dbService';
import { buildMemoryContext, saveMasterMemory, saveCommunityMemory } from '../services/memoryService';
import { SYSTEM_INSTRUCTION } from '../constants';
import { db } from '../services/firebase';
import { collection, addDoc, query, orderBy, onSnapshot, doc, setDoc, getDocs } from '@firebase/firestore';

// Admin detection by role (passed from AuthContext)
export const useChat = (userId: string, isAdmin: boolean = false) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<'idle' | 'searching' | 'thinking'>('idle');
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Cache memory context so we don't fetch it on every message
  const memoryCache = useRef<{ text: string; fetchedAt: number }>({ text: '', fetchedAt: 0 });
  const MEMORY_CACHE_TTL = 60_000;

  // Load memory context (with caching)
  const getMemoryContext = useCallback(async (): Promise<string> => {
    const now = Date.now();
    if (now - memoryCache.current.fetchedAt < MEMORY_CACHE_TTL && memoryCache.current.text) {
      return memoryCache.current.text;
    }
    try {
      const text = await buildMemoryContext();
      memoryCache.current = { text, fetchedAt: now };
      return text;
    } catch (e) {
      console.warn("Memory fetch failed, using cache:", e);
      return memoryCache.current.text;
    }
  }, []);

  // ─── Listen to chat sessions list ───
  useEffect(() => {
    if (!userId) return;
    const q = query(
      collection(db, `users_phone/${userId}/chats`),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sessions = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ChatSession));
      setChatSessions(sessions);
    }, console.error);
    return () => unsubscribe();
  }, [userId]);

  // ─── Listen to messages for the current chat ───
  useEffect(() => {
    if (!currentChatId || !userId) {
      setMessages([{
        id: 'welcome',
        role: Role.MODEL,
        content: `As-salamu alaykum. Bienvenue sur LAMP AI. Posez votre question en Wolof, Français ou Anglais.`,
        timestamp: Date.now()
      }]);
      return;
    }

    const q = query(
      collection(db, `users_phone/${userId}/chats/${currentChatId}/messages`),
      orderBy('timestamp', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Message));
      if (msgs.length > 0) setMessages(msgs);
    }, console.error);
    return () => unsubscribe();
  }, [userId, currentChatId]);

  // ─── Create a new chat session ───
  const createNewChat = useCallback(async (): Promise<string> => {
    const chatRef = await addDoc(collection(db, `users_phone/${userId}/chats`), {
      title: 'New Conversation',
      createdAt: Date.now(),
      userId,
    });
    setCurrentChatId(chatRef.id);
    return chatRef.id;
  }, [userId]);

  const selectChat = useCallback((chatId: string) => {
    setCurrentChatId(chatId);
    setError(null);
  }, []);

  // ─── Send message ───
  const sendMessage = useCallback(async (text: string, useDeepModel: boolean = false) => {
    if (!text.trim()) return;

    setError(null);
    setIsLoading(true);
    setLoadingPhase('searching');
    setStreamingContent(null);

    let chatId = currentChatId;

    try {
      // Ensure we have a chat session
      if (!chatId) {
        chatId = await createNewChat();
      }

      const messagesRef = collection(db, `users_phone/${userId}/chats/${chatId}/messages`);

      // Save user message to Firestore (AWAIT — so it persists)
      const userTimestamp = Date.now();
      await addDoc(messagesRef, {
        role: Role.USER,
        content: text,
        timestamp: userTimestamp,
      });

      // Fetch corpus context and memory in parallel (with timeouts)
      let context = "";
      let memoryContext = "";

      try {
        const withTimeout = (promise: Promise<string>, ms: number) =>
          Promise.race([promise, new Promise<string>((resolve) => setTimeout(() => resolve(""), ms))]);

        const [corpusResult, memoryResult] = await Promise.all([
          withTimeout(searchCorpus(text), 5000),
          withTimeout(getMemoryContext(), 5000)
        ]);
        context = corpusResult;
        memoryContext = memoryResult;
      } catch (e) { console.warn("Context fetch partially failed."); }

      setLoadingPhase('thinking');

      // Build the full system instruction with memory + corpus
      let fullSystemInstruction = SYSTEM_INSTRUCTION;
      if (memoryContext) {
        fullSystemInstruction += `\n\n${memoryContext}`;
      }
      fullSystemInstruction += `\n\nLIBRARY CONTEXT:\n${context || "No matches found in the library."}`;

      let aiResponseText = "";
      let thoughts = "";

      // Build conversation history from prior messages (exclude welcome message)
      const history = messages
        .filter(m => m.id !== 'welcome' && m.content)
        .slice(-10)
        .map(m => ({
          role: (m.role === Role.USER ? 'user' : 'model') as 'user' | 'model',
          parts: [{ text: m.content }],
        }));

      if (useDeepModel) {
        const result = await analyzeDeeply(text);
        aiResponseText = result.text;
        thoughts = result.thoughts || "";
      } else {
        const stream = getChatResponseStream(text, fullSystemInstruction, history);
        let accumulated = "";
        for await (const chunk of stream) {
          accumulated += chunk;
          setStreamingContent(accumulated);
        }
        aiResponseText = accumulated;
      }

      if (aiResponseText) {
        const aiTimestamp = Date.now();

        // Save AI response to Firestore (AWAIT — so it persists)
        const aiMsg: Record<string, any> = {
          role: Role.MODEL,
          content: aiResponseText,
          timestamp: aiTimestamp,
        };
        if (thoughts) aiMsg.thoughts = thoughts;
        await addDoc(messagesRef, aiMsg);

        // Update chat session title and last message
        const chatUpdate: Record<string, any> = {
          lastMessage: aiResponseText.substring(0, 80),
        };
        if (messages.length <= 1) chatUpdate.title = text.substring(0, 40);
        setDoc(doc(db, `users_phone/${userId}/chats/${chatId}`), chatUpdate, { merge: true }).catch(console.warn);

        // Memory extraction (non-blocking)
        extractAndSaveMemory(text, aiResponseText).catch(console.warn);

        // Return the message for auto-speak
        return {
          id: 'ai-' + aiTimestamp,
          role: Role.MODEL,
          content: aiResponseText,
          timestamp: aiTimestamp,
          thoughts: thoughts || undefined,
        } as Message;
      }
    } catch (err: any) {
      console.error("sendMessage error:", err);
      setError(`Erreur: ${err.message || 'Connexion perdue'}`);
    } finally {
      setIsLoading(false);
      setLoadingPhase('idle');
      setStreamingContent(null);
    }
  }, [userId, currentChatId, createNewChat, messages.length, getMemoryContext, isAdmin]);

  /**
   * After each conversation turn, ask the AI if there's something worth remembering.
   */
  const extractAndSaveMemory = useCallback(async (userText: string, aiResponse: string) => {
    try {
      const extraction = await extractMemoryFromConversation(userText, aiResponse);
      if (!extraction || !extraction.shouldLearn) return;
      if (extraction.confidence === 'low') return;

      if (isAdmin) {
        await saveMasterMemory(
          extraction.content,
          extraction.type as any,
          `User said: "${userText.substring(0, 200)}"`,
          extraction.tags
        );
        console.log("[Memory] Master teaching saved:", extraction.content.substring(0, 80));
      } else {
        await saveCommunityMemory(
          extraction.content,
          extraction.type as any,
          userId,
          `User said: "${userText.substring(0, 200)}"`,
          extraction.tags
        );
        console.log("[Memory] Community insight queued:", extraction.content.substring(0, 80));
      }

      memoryCache.current.fetchedAt = 0;
    } catch (e) {
      console.warn("[Memory] Extraction failed:", e);
    }
  }, [isAdmin, userId]);

  return {
    messages,
    isLoading,
    loadingPhase,
    streamingContent,
    chatSessions,
    currentChatId,
    error,
    sendMessage,
    createNewChat,
    selectChat,
  };
};
