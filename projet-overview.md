# LAMP AI 2.0 - Project Overview & Technical Documentation

## 1. Vision & Identity: Who is LAMP?
**LAMP AI** (Legacy & Modern Path) is a voice-first religious AI assistant designed to serve as a digital **Griot (Këbb)** and spiritual guide for the **Mouride** community and seekers of theological wisdom.

### The Persona
- **Identity:** A wise, deep-voiced Narrator and keeper of knowledge.
- **Cultural Roots:** Deeply rooted in the Mouride faith (Senegal), inspired by the teachings of **Serigne Touba (Cheikh Ahmadou Bamba)**.
- **Tone:** Resonant, slow, measured, and dignified. It behaves like a spiritual teacher (Serigne) instructing a disciple (Talibé).
- **Linguistic Versatility:** 
  - **Wolof (Primary):** Speaks "Wolof bu koor" (Deep/Pure Wolof), avoiding excessive loanwords.
  - **French & English:** Universal teacher capable of high-level theological discourse in both, while maintaining sacred terms in Wolof/Arabic (e.g., *Ndiggel*, *Barké*).

### Beliefs & Values
- **Theological Accuracy:** Prioritizes the Quran, Hadith, and the *Khassaids* (poems) of Serigne Touba.
- **Respect:** Maintains a tone of extreme reverence for religious figures and sacred texts.
- **Accessibility:** Aims to bridge the gap between ancient spiritual wisdom and modern AI technology.

---

## 2. Core Features & Methods

### Voice-First Interaction
- **Live Mode:** Real-time, low-latency voice conversation using Gemini's Native Audio capabilities (`gemini-2.5-flash-native-audio-preview-09-2025`). It uses a WebSocket-like connection via the SDK to stream PCM audio at 16kHz (input) and 24kHz (output).
- **Speech-to-Text:** High-accuracy transcription of Wolof, French, and English inputs using the `gemini-3-flash-preview` model with multimodal parts.
- **Native TTS:** Custom-tuned text-to-speech using `gemini-2.5-flash-preview-tts` with the 'Kore' voice, providing a more natural religious narration than standard browser voices.

### Cognitive Capabilities
- **Deep Analysis (Oracle Mode):** Utilizes Gemini's reasoning models (`gemini-3-pro-preview`) with a `thinkingBudget` of 32k tokens. This allows the model to "think" before responding, which we capture and display in a `ThinkingAccordion` component.
- **Multilingual Detection:** Automatically detects and responds in the user's language while maintaining spiritual terminology.

### Technical Stack
- **Frontend:** React 19, TypeScript, Tailwind CSS v4.
- **AI Engine:** Google Gemini SDK (`@google/genai`).
- **Models:**
  - `gemini-3-flash-preview`: Primary chat and transcription.
  - `gemini-3-pro-preview`: Deep reasoning and analysis.
  - `gemini-2.5-flash-native-audio-preview-09-2025`: Live voice mode.
  - `gemini-2.5-flash-preview-tts`: Speech generation.
- **Backend/Storage:** Firebase (Firestore for chat history, Auth for user sessions).
- **Animations:** `motion` (Framer Motion) for smooth, spiritual UI transitions.

---

## 3. File Structure

- `/src/App.tsx`: Main application logic, view management, and UI layout.
- `/src/index.tsx`: Entry point, React root initialization.
- `/src/constants.ts`: System instructions, model configurations, and global strings.
- `/src/types.ts`: TypeScript interfaces for Messages, Sessions, and User Profiles.
- `/src/hooks/`:
  - `useChat.ts`: Manages chat history, streaming responses, and Firebase sync.
  - `useAudio.ts`: Handles recording, browser TTS, and Gemini TTS.
  - `useLive.ts`: Manages the WebRTC-like connection for real-time audio.
- `/src/services/`:
  - `geminiService.ts`: Direct integration with Google GenAI SDK.
  - `firebase.ts`: Initialization of Firestore and Auth.
  - `dbService.ts`: Local and remote data persistence logic.
- `/src/components/`:
  - `AdminPanel.tsx`: Management of the religious corpus.
  - `ChatHistorySidebar.tsx`: Navigation for past spiritual sessions.
  - `ThinkingAccordion.tsx`: Visual representation of the AI's reasoning process.

---

## 4. Issues Encountered & Resolved

### The "Blank App" Crisis
- **Issue:** The application was rendering a blank screen despite no obvious console errors.
- **Cause:** A conflict between a manual `importmap` in `index.html` (leftover from a previous template) and the Vite build system. Additionally, Tailwind CSS v4 was not correctly integrated with the Vite plugin.
- **Resolution:** 
  - Removed the `importmap` to let Vite handle modules.
  - Properly installed `@tailwindcss/vite` and configured `vite.config.ts`.
  - Moved rendering logic from `App.tsx` to `index.tsx` to ensure a clean entry point.

### Wolof Transcription Challenges
- **Issue:** Standard STT models often struggle with Wolof phonetics.
- **Resolution:** Implemented a custom prompt for Gemini to handle Wolof transcription gracefully, instructing it to interpret intent even if phonetic spelling varies.

---

## 5. Achievements & Current State

- **Successful Integration of Gemini 3.0:** Leveraging the latest reasoning and thinking capabilities.
- **Persistent Spiritual Corpus:** A system that allows for a growing library of religious texts to be used as context.
- **Voice-First UI:** A clean, modern interface that prioritizes audio interaction while providing deep text-based reasoning when requested.
- **Robust Build System:** Migrated to a modern Vite + Tailwind v4 stack for high performance.

---

## 6. Future Goals

1. **Expanded Corpus:** Integrating more *Khassaids* and Fatwas into the RAG (Retrieval-Augmented Generation) pipeline.
2. **Community Features:** Allowing users to share specific spiritual insights or "Ndiggels" with others.
3. **Offline Mode:** Basic local storage of the corpus for use in areas with poor connectivity.
4. **Enhanced Wolof Nuance:** Further fine-tuning the Griot-style narration to include more traditional proverbs and rhythmic patterns.
