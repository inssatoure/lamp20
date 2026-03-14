/**
 * NotebookLM-style features for LAMP AI
 * - Auto-analyze documents for themes and insights
 * - Generate learning summaries
 * - Extract key concepts
 */

import { GoogleGenAI } from '@google/genai';
import { db } from './firebase';
import { collection, addDoc, query, where, getDocs } from '@firebase/firestore';

const getClient = () => {
  return new GoogleGenAI({ apiKey: process.env.REACT_APP_GEMINI_API_KEY || process.env.GEMINI_API_KEY });
};

export interface DocumentAnalysis {
  documentTitle: string;
  keyThemes: string[];
  mainIdeas: string[];
  arabicHighlights: string[];
  frenchSummary: string;
  wolofSummary: string;
  relatedTopics: string[];
  teachingPoints: string[];
}

/**
 * Analyze a document (Khassaid, Quran, etc.) and extract insights
 * Similar to NotebookLM's document analysis feature
 */
export const analyzeDocument = async (
  documentText: string,
  documentTitle: string,
  category: 'Khassaid' | 'Quran' | 'Other'
): Promise<DocumentAnalysis> => {
  const ai = getClient();

  const prompt = `Analyze this ${category} document and extract insights in JSON format.

Document Title: ${documentTitle}
Content: ${documentText.substring(0, 3000)}

Return valid JSON with ONLY these fields (no extra text):
{
  "keyThemes": ["theme1", "theme2", "theme3"],
  "mainIdeas": ["idea1", "idea2"],
  "arabicHighlights": ["verse or passage in Arabic (max 2)"],
  "frenchSummary": "2-3 sentence summary in French",
  "wolofSummary": "2-3 sentence summary in Wolof",
  "relatedTopics": ["topic1", "topic2"],
  "teachingPoints": ["teaching1", "teaching2"]
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: { temperature: 0.3 },
    });

    const text = response.text?.trim();
    if (!text) throw new Error("No response from model");

    // Extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      documentTitle,
      keyThemes: parsed.keyThemes || [],
      mainIdeas: parsed.mainIdeas || [],
      arabicHighlights: parsed.arabicHighlights || [],
      frenchSummary: parsed.frenchSummary || "",
      wolofSummary: parsed.wolofSummary || "",
      relatedTopics: parsed.relatedTopics || [],
      teachingPoints: parsed.teachingPoints || [],
    };
  } catch (error) {
    console.error("[Document Analysis] Error:", error);
    throw error;
  }
};

/**
 * Generate study guide from multiple documents
 * NotebookLM-style: "Study Guide" feature
 */
export const generateStudyGuide = async (
  topic: string,
  documentTexts: string[]
): Promise<string> => {
  const ai = getClient();

  const combinedText = documentTexts.slice(0, 5).map(t => t.substring(0, 1500)).join("\n\n---\n\n");

  const prompt = `Create a concise study guide on the topic: "${topic}"

Based on these documents:
${combinedText}

Format as:
1. Key Concepts (5 main ideas)
2. Learning Objectives (3-4 goals)
3. Discussion Questions (3 questions)
4. Key Verses/References (Quran & Khassaid citations)
5. Further Study (related topics)

Keep it educational and accessible.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: { temperature: 0.5 },
    });

    return response.text || "Unable to generate study guide";
  } catch (error) {
    console.error("[Study Guide] Error:", error);
    throw error;
  }
};

/**
 * Generate comparison between two documents
 * Example: Compare two Khassaid on the same theme
 */
export const compareDocuments = async (
  doc1Title: string,
  doc1Text: string,
  doc2Title: string,
  doc2Text: string
): Promise<string> => {
  const ai = getClient();

  const prompt = `Compare these two ${doc1Title.includes('Quran') ? 'Quranic' : 'Khassaid'} documents:

"${doc1Title}":
${doc1Text.substring(0, 1500)}

"${doc2Title}":
${doc2Text.substring(0, 1500)}

Provide:
1. Similarities in theme or message
2. Differences in approach or emphasis
3. Complementary insights (how they relate)
4. Which is better for learning [theme] and why

Be concise (max 300 words).`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: { temperature: 0.5 },
    });

    return response.text || "Unable to compare documents";
  } catch (error) {
    console.error("[Document Comparison] Error:", error);
    throw error;
  }
};

/**
 * Save an analysis to Firestore for future reference
 */
export const saveAnalysis = async (
  userId: string,
  analysis: DocumentAnalysis,
  type: 'study_guide' | 'comparison' | 'analysis'
): Promise<string> => {
  try {
    const docRef = await addDoc(collection(db, `users_phone/${userId}/analyses`), {
      ...analysis,
      type,
      createdAt: new Date().toISOString(),
    });
    return docRef.id;
  } catch (error) {
    console.error("[Save Analysis] Error:", error);
    throw error;
  }
};

/**
 * Retrieve user's saved analyses
 */
export const getUserAnalyses = async (userId: string) => {
  try {
    const snap = await getDocs(
      query(collection(db, `users_phone/${userId}/analyses`))
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error("[Get Analyses] Error:", error);
    return [];
  }
};
