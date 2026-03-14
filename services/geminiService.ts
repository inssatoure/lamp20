
import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";
import { CHAT_MODEL, REASONING_MODEL, TTS_MODEL, MEMORY_EXTRACTION_INSTRUCTION } from '../constants';

const getClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

type HistoryEntry = { role: 'user' | 'model'; parts: Array<{ text: string }> };

export const getChatResponseStream = async function* (
  prompt: string,
  systemInstruction: string,
  history?: HistoryEntry[]
) {
  const ai = getClient();

  try {
    const contents = history && history.length > 0
      ? [...history, { role: 'user' as const, parts: [{ text: prompt }] }]
      : prompt;

    const responseStream = await ai.models.generateContentStream({
      model: CHAT_MODEL,
      contents,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
      },
    });

    for await (const chunk of responseStream) {
      const text = chunk.text;
      if (text) {
        yield text;
      }
    }
  } catch (error) {
    console.error("Gemini Streaming Error:", error);
    throw error;
  }
};

export const analyzeDeeply = async (text: string): Promise<{ text: string, thoughts?: string }> => {
  const ai = getClient();

  try {
    const response = await ai.models.generateContent({
      model: REASONING_MODEL,
      contents: text,
      config: {
        systemInstruction: "You are a profound religious scholar and philosopher. Analyze the query deeply, providing theological context and structured insights.",
        thinkingConfig: { thinkingBudget: 32768 }, 
        temperature: 0.4,
      }
    });
    
    let thoughts = "";
    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if ((part as any).thought === true || (part as any).role === 'thought') {
        thoughts += part.text || "";
      }
    }

    return {
      text: response.text || "The Oracle remains silent.",
      thoughts: thoughts || undefined
    };
  } catch (error) {
    console.error("Gemini Deep Analysis Error:", error);
    throw error;
  }
};

export const transcribeAudio = async (base64Audio: string, mimeType: string): Promise<string> => {
  const ai = getClient();

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: CHAT_MODEL,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Audio
            }
          },
          {
            text: "Transcribe the audio exactly. Maintain the original language (Wolof, French, or English)."
          }
        ]
      },
      config: {
        temperature: 0.1,
      }
    });

    return response.text?.trim() || "";
  } catch (error) {
    console.error("Transcription API Error:", error);
    throw error;
  }
};

/**
 * Analyze a conversation turn and extract potential learnings for the AI memory.
 * Returns null if nothing worth learning, or a structured object if something was taught.
 */
export const extractMemoryFromConversation = async (
  userMessage: string,
  aiResponse: string
): Promise<{
  shouldLearn: boolean;
  content: string;
  type: string;
  tags: string[];
  confidence: 'high' | 'medium' | 'low';
} | null> => {
  const ai = getClient();

  try {
    const conversationContext = `USER: ${userMessage}\n\nAI RESPONSE: ${aiResponse}`;

    const response = await ai.models.generateContent({
      model: CHAT_MODEL,
      contents: conversationContext,
      config: {
        systemInstruction: MEMORY_EXTRACTION_INSTRUCTION,
        temperature: 0.1,
      }
    });

    const text = response.text?.trim();
    if (!text || text === 'null') return null;

    // Parse JSON response, handle potential markdown wrapping
    const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    if (!parsed.shouldLearn) return null;
    return parsed;
  } catch (error) {
    // Non-critical — silently fail
    console.warn("[Memory Extraction] Parse failed:", error);
    return null;
  }
};

export const generateSpeech = async (text: string): Promise<string> => {
  const ai = getClient();

  try {
    const response = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' } 
          }
        }
      }
    });

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioData) {
      throw new Error("No audio data returned");
    }
    return audioData;
  } catch (error) {
    console.error("Speech Generation API Error:", error);
    throw error;
  }
};
