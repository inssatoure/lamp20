
import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { LIVE_MODEL, LIVE_SYSTEM_INSTRUCTION } from '../constants';

export type LiveStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// Manual Base64 Implementation as per requirements
function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

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

export const useLive = () => {
  const [status, setStatus] = useState<LiveStatus>('disconnected');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState<{user: string, model: string}>({ user: '', model: '' });

  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionRef = useRef<any>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const connect = useCallback(async () => {
    if (status === 'connected' || status === 'connecting') return;
    
    try {
      setStatus('connecting');
      setErrorMessage('');
      setLiveTranscript({ user: '', model: '' });

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const inputCtx = new AudioContextClass({ sampleRate: 16000 });
      const outputCtx = new AudioContextClass({ sampleRate: 24000 });
      inputContextRef.current = inputCtx;
      outputContextRef.current = outputCtx;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const sessionPromise = ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: LIVE_SYSTEM_INSTRUCTION,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
            languageCode: 'fr-FR',
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        },
        callbacks: {
          onopen: () => {
            setStatus('connected');
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              // Simple volume check
              const volume = inputData.reduce((a, b) => a + Math.abs(b), 0) / inputData.length;
              setIsUserSpeaking(volume > 0.01);

              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                int16[i] = inputData[i] * 32768;
              }
              
              const base64Data = encodeBase64(new Uint8Array(int16.buffer));
              
              sessionPromise.then(session => {
                session.sendRealtimeInput({
                  media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              setLiveTranscript(prev => ({ ...prev, model: prev.model + message.serverContent.outputTranscription.text }));
            }
            if (message.serverContent?.inputTranscription) {
              setLiveTranscript(prev => ({ ...prev, user: prev.user + message.serverContent.inputTranscription.text }));
            }

            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && outputContextRef.current) {
              setIsModelSpeaking(true);
              const ctx = outputContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const audioBuffer = await decodeAudioData(decodeBase64(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setIsModelSpeaking(false);
              });

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              for (const s of sourcesRef.current) {
                try { s.stop(); } catch(e) {}
              }
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onclose: () => setStatus('disconnected'),
          onerror: (e) => {
            console.error(e);
            setStatus('error');
            setErrorMessage("Connection lost. Please try again.");
          }
        }
      });
      
      sessionRef.current = sessionPromise;
    } catch (error) {
      console.error(error);
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : "Failed to connect.");
    }
  }, [status]);

  const disconnect = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.then((s: any) => s.close());
    }
    inputContextRef.current?.close();
    outputContextRef.current?.close();
    setStatus('disconnected');
    setIsUserSpeaking(false);
    setIsModelSpeaking(false);
  }, []);

  return { connect, disconnect, status, errorMessage, isUserSpeaking, isModelSpeaking, liveTranscript };
};
