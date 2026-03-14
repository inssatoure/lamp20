# Vector Search & NotebookLM Setup

## What's New

**Vector Search** — Semantic similarity instead of keyword matching
- Understands meaning, not just word matches
- Works across Arabic, French, Wolof, English
- Falls back to keywords if embeddings unavailable

**NotebookLM Features** — Document analysis & study guides
- Auto-analyze documents for themes and insights
- Generate study guides on any topic
- Compare two documents side-by-side

---

## Setup (One-time)

### 1. Embed All Corpus Items

Run this once to generate embeddings for all 122 Khassaid + future Quran docs:

```bash
cd /Users/macbook14/Documents/APPS\ GITHUB/LAMP-2.0.1-main
export GEMINI_API_KEY=AIzaSyCfBSOJw5i2ajEBHhZB4KKGadBxAKP9wj8
node scripts/embedCorpus.js
```

**What it does:**
- Takes each corpus item's title + summaries
- Calls Gemini `text-embedding-004` to generate a 768-dimensional vector
- Stores the embedding in Firestore under the `embedding` field
- Rate limits to ~100 requests/minute (Gemini API limit)
- Takes ~2 minutes for 122 documents

**Progress output:**
```
Starting corpus embedding...
Found 122 corpus items to embed
✓ [1/122] Mawahiboul Quloub
✓ [2/122] Jawartu Nuur
...
✅ Embedding complete: 122 succeeded, 0 failed
```

### 2. Verify Embeddings Stored

In Firebase Console:
- Go to Firestore → `knowledge_base` collection
- Click any document
- Should see `embedding` field with array of ~768 numbers

---

## How It Works

### Vector Search Flow

```
User asks: "pardon"
    ↓
Embed "pardon" → [0.23, -0.45, 0.12, ...] (768 dims)
    ↓
Compare to all corpus embeddings using cosine similarity
    ↓
Find closest matches (highest similarity = 0.0 to 1.0)
    ↓
Return top 5 documents + full content if top match is clear
```

### Similarity Scoring

- **0.0** = completely unrelated
- **0.5** = somewhat related
- **0.75+** = highly relevant (our threshold for "direct match")

Example:
```
Query: "patience in Khassaid"
Results:
1. Muñ theme Khassaid - similarity: 0.82 ✓ (returned as full text)
2. Sabr theme Khassaid - similarity: 0.78 ✓
3. Work Khassaid - similarity: 0.45 ✗ (not returned)
```

---

## Using Vector Search in Code

### In Web App

Already integrated in `searchCorpus()` from `services/dbService.ts`:

```typescript
// Automatically uses vector search if embeddings exist
const corpusContext = await searchCorpus("what does Serigne Touba say about patience?");
```

Falls back to keyword search if:
- Embeddings not generated yet
- Vector search fails
- User likes keywords better (configurable)

### In Telegram Bot

Same `searchCorpus()` function, already integrated.

---

## NotebookLM Features

### 1. Analyze a Document

```typescript
import { analyzeDocument } from '@/services/notebookService';

const analysis = await analyzeDocument(
  documentText,
  "Mafatihul Bishri",
  "Khassaid"
);

// Returns:
{
  keyThemes: ["forgiveness", "divine mercy"],
  mainIdeas: ["God forgives all sins", "..."],
  arabicHighlights: ["verse excerpt"],
  frenchSummary: "...",
  wolofSummary: "...",
  relatedTopics: ["repentance", "faith"],
  teachingPoints: ["...", "..."]
}
```

### 2. Generate Study Guide

```typescript
const guide = await generateStudyGuide(
  "Forgiveness in Islam",
  [khassaidText1, khassaidText2, quranText]
);

// Returns formatted guide:
// 1. Key Concepts
// 2. Learning Objectives
// 3. Discussion Questions
// 4. Key Verses/References
// 5. Further Study
```

### 3. Compare Two Documents

```typescript
const comparison = await compareDocuments(
  "Mafatihul Bishri",
  text1,
  "Jawartu Nuur",
  text2
);

// Returns:
// - Similarities in theme/message
// - Differences in approach
// - Complementary insights
// - Which is better for learning [theme]
```

---

## Adding New Documents

### Automatic Embedding

When you add a new Khassaid or Quran Surah via admin panel:
1. Document added to Firestore
2. **Run embed script again** to generate embeddings for new items:

```bash
node scripts/embedCorpus.js
```

Or add this to your deployment/admin workflow to run automatically.

### Manual Embedding (One Document)

```typescript
import { embedText } from '@/services/dbService';

const embedding = await embedText("Khassaid text or summary");
// Then save to Firestore manually
```

---

## Configuration

### Vector Search Threshold

In `dbService.ts`, adjust similarity threshold:

```typescript
const isDirectMatch = topScore > 0.75 && topScore > secondScore + 0.15;
```

- **0.75** = strict (only very similar docs marked as "direct match")
- **0.65** = moderate
- **0.55** = permissive

### Top Results Limit

Return top N documents:
```typescript
return scored.slice(0, 5).map(...) // Change 5 to your number
```

### Fallback to Keywords

If vector search fails, automatically uses keyword search. Disable this:

```typescript
// In searchCorpus(), remove the try/catch fallback
```

---

## Performance

### Latency

- **First request**: ~1.5s (fetch all embeddings from Firestore)
- **Subsequent requests**: <100ms (cached in memory)
- **Vector comparison**: O(n * 768) — ~50ms for 150 documents

### Cost

- Gemini embeddings: **$0.02 per 1M tokens** (one-time setup)
- 122 Khassaid @ ~150 tokens each = ~18,300 tokens = **$0.0004** (negligible)
- Future Quran: 30 Surahs = ~6,000 tokens = **$0.0001**

### Storage

- 768-dimensional vector ≈ 3KB per document
- 152 documents = ~450KB total (negligible in Firestore)

---

## Troubleshooting

### "No embedding returned"

**Cause**: Gemini API key invalid or rate limited
**Fix**: Check env var, wait 1 minute, retry

### "Vector search returning wrong results"

**Cause**: Embeddings outdated or query too vague
**Fix**:
1. Re-run embed script
2. Refine query language
3. Check vector similarity score in logs

### "Fallback to keywords" appears

**Cause**: Vector search disabled or embeddings missing
**Fix**: Run `embedCorpus.js` script

---

## Next Steps

1. ✅ Vector search ready to use
2. ✅ NotebookLM hooks created
3. **TODO**: Add UI buttons for NotebookLM features in React components
4. **TODO**: Add Quran corpus (30 Surahs) + embed them
5. **TODO**: PDF upload → auto-chunk → auto-embed feature

---

## References

- [Gemini Embeddings API](https://ai.google.dev/docs/embeddings)
- [Cosine Similarity](https://en.wikipedia.org/wiki/Cosine_similarity)
- [NotebookLM](https://notebooklm.google.com) (inspiration)
