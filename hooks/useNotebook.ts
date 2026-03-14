/**
 * Hook for NotebookLM-style features
 * - Document analysis
 * - Study guide generation
 * - Document comparison
 */

import { useState, useCallback } from 'react';
import {
  analyzeDocument,
  generateStudyGuide,
  compareDocuments,
  saveAnalysis,
  DocumentAnalysis,
} from '../services/notebookService';
import { getAllCorpusItems } from '../services/dbService';
import { CorpusItem } from '../types';

export const useNotebook = (userId: string) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [studyGuide, setStudyGuide] = useState<string | null>(null);
  const [comparison, setComparison] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Analyze a single document
  const analyzeSelectedDocument = useCallback(
    async (corpusItemId: string) => {
      setIsAnalyzing(true);
      setError(null);
      try {
        const items = await getAllCorpusItems();
        const item = items.find(i => i.id === corpusItemId);
        if (!item) throw new Error("Document not found");

        const result = await analyzeDocument(
          item.content,
          item.title,
          item.category as 'Khassaid' | 'Quran' | 'Other'
        );

        setAnalysis(result);

        // Optionally save
        await saveAnalysis(userId, result, 'analysis');
      } catch (err: any) {
        setError(err.message || "Analysis failed");
      } finally {
        setIsAnalyzing(false);
      }
    },
    [userId]
  );

  // Generate study guide on a topic
  const createStudyGuide = useCallback(
    async (topic: string, selectedDocIds: string[]) => {
      setIsAnalyzing(true);
      setError(null);
      try {
        const items = await getAllCorpusItems();
        const selectedDocs = items
          .filter(i => selectedDocIds.includes(i.id))
          .map(i => i.content);

        if (selectedDocs.length === 0) throw new Error("No documents selected");

        const guide = await generateStudyGuide(topic, selectedDocs);
        setStudyGuide(guide);
      } catch (err: any) {
        setError(err.message || "Study guide generation failed");
      } finally {
        setIsAnalyzing(false);
      }
    },
    []
  );

  // Compare two documents
  const compareTwo = useCallback(
    async (docId1: string, docId2: string) => {
      setIsAnalyzing(true);
      setError(null);
      try {
        const items = await getAllCorpusItems();
        const doc1 = items.find(i => i.id === docId1);
        const doc2 = items.find(i => i.id === docId2);

        if (!doc1 || !doc2) throw new Error("One or both documents not found");

        const result = await compareDocuments(
          doc1.title,
          doc1.content,
          doc2.title,
          doc2.content
        );

        setComparison(result);
      } catch (err: any) {
        setError(err.message || "Comparison failed");
      } finally {
        setIsAnalyzing(false);
      }
    },
    []
  );

  const clearAnalysis = useCallback(() => {
    setAnalysis(null);
    setStudyGuide(null);
    setComparison(null);
    setError(null);
  }, []);

  return {
    isAnalyzing,
    analysis,
    studyGuide,
    comparison,
    error,
    analyzeSelectedDocument,
    createStudyGuide,
    compareTwo,
    clearAnalysis,
  };
};
