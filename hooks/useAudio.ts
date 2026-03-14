
import { useState, useEffect, useCallback, useRef } from 'react';
import { Voice } from '../types';
import { generateSpeech } from '../services/geminiService';

// Standard SDK Decode Functions
function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export const useAudio = () => {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentSpeakingId, setCurrentSpeakingId] = useState<string | null>(null);
  const [availableVoices, setAvailableVoices] = useState<Voice[]>([]);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const synth = window.speechSynthesis;
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const activeSpeechIdRef = useRef<string | null>(null);

  useEffect(() => {
    const loadVoices = () => {
      const browserVoices = synth.getVoices().map(v => ({
        name: v.name,
        lang: v.lang,
        voiceURI: v.voiceURI,
        isCustom: false
      }));

      const geminiVoice: Voice = {
        name: "LAMP (Native Voice)",
        lang: "wo-SN",
        voiceURI: "gemini-tts-native",
        isCustom: true
      };

      setAvailableVoices([geminiVoice, ...browserVoices]);
    };

    loadVoices();
    if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = loadVoices;
  }, [synth]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      recorder.start();
      setIsListening(true);
    } catch (err) {
      console.error(err);
      setIsListening(false);
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<{ blob: Blob; mimeType: string } | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        setIsListening(false);
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        recorder.stream.getTracks().forEach(t => t.stop());
        setIsListening(false);
        resolve({ blob, mimeType: recorder.mimeType });
      };
      recorder.stop();
    });
  }, []);

  const speak = useCallback(async (text: string, voice: Voice | null = null, rate: number = 1, id: string | null = null) => {
    stopSpeaking();
    const speechId = id || Date.now().toString();
    activeSpeechIdRef.current = speechId;
    setCurrentSpeakingId(speechId);
    setIsSpeaking(true);

    const targetVoice = voice || availableVoices[0];

    try {
      if (targetVoice?.isCustom) {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') await ctx.resume();

        const base64Audio = await generateSpeech(text);
        if (activeSpeechIdRef.current !== speechId) return;

        const uint8Data = decodeBase64(base64Audio);
        const buffer = await decodeAudioData(uint8Data, ctx, 24000, 1);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        sourceNodeRef.current = source;
        source.onended = () => {
          if (activeSpeechIdRef.current === speechId) {
            setIsSpeaking(false);
            setCurrentSpeakingId(null);
          }
        };
        source.start();
      } else {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = rate;
        utterance.onend = () => {
          setIsSpeaking(false);
          setCurrentSpeakingId(null);
        };
        const browserVoice = synth.getVoices().find(v => v.voiceURI === targetVoice.voiceURI);
        if (browserVoice) utterance.voice = browserVoice;
        synth.speak(utterance);
      }
    } catch (e) {
      console.error("Speech Generation Failed:", e);
      setIsSpeaking(false);
      setCurrentSpeakingId(null);
    }
  }, [availableVoices, synth]);

  const stopSpeaking = useCallback(() => {
    activeSpeechIdRef.current = null;
    if (synth.speaking) synth.cancel();
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch (e) {}
      sourceNodeRef.current = null;
    }
    setIsSpeaking(false);
    setIsPaused(false);
    setCurrentSpeakingId(null);
  }, [synth]);

  return { isListening, isSpeaking, isPaused, currentSpeakingId, availableVoices, startRecording, stopRecording, speak, stopSpeaking };
};
