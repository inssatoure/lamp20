
import React, { useState, useEffect, useRef } from 'react';
import { useAudio } from './hooks/useAudio';
import { useChat } from './hooks/useChat';
import { useLive } from './hooks/useLive';
import { transcribeAudio } from './services/geminiService';
import { Role, AppSettings, Message } from './types';
import { ThinkingAccordion } from './components/ThinkingAccordion';
import { AdminPanel } from './components/AdminPanel';
import { ChatHistorySidebar } from './components/ChatHistorySidebar';
import { LoginPage } from './components/LoginPage';
import { APP_NAME } from './constants';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { BulkImportPage } from './components/BulkImportPage';

const AppContent: React.FC = () => {
  const { user, loading: authLoading, isAdmin, logout } = useAuth();

  const [currentView, setCurrentView] = useState<'chat' | 'admin' | 'import'>('chat');
  const [input, setInput] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showDeepAnalyze, setShowDeepAnalyze] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  const [appSettings, setAppSettings] = useState<AppSettings>({
    autoSpeak: true,
    theme: 'light',
    voiceURI: '',
    speechRate: 0.9
  });

  const { messages, isLoading, loadingPhase, streamingContent, chatSessions, currentChatId, error, sendMessage, selectChat, createNewChat } = useChat(user?.id || '', isAdmin);
  const { isListening, isSpeaking, currentSpeakingId, startRecording, stopRecording, speak, stopSpeaking, availableVoices } = useAudio();
  const { connect: connectLive, disconnect: disconnectLive, status: liveStatus, isModelSpeaking: isLiveModelSpeaking, liveTranscript } = useLive();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Route-based view detection + auto-redirect admin
  useEffect(() => {
    const path = window.location.pathname;
    if (path === '/admin') {
      if (user && isAdmin) {
        setCurrentView('admin');
      }
    } else if (path === '/import' || window.location.hash === '#import') {
      setCurrentView('import');
    } else if (user && isAdmin && currentView === 'chat') {
      setCurrentView('admin');
    }
  }, [user, isAdmin]);

  useEffect(() => {
    const checkKey = async () => {
      try {
        const selected = await (window as any).aistudio?.hasSelectedApiKey?.();
        setHasKey(selected ?? true);
      } catch {
        setHasKey(true);
      }
    };
    checkKey();
  }, []);

  const handleOpenKeyDialog = async () => {
    await (window as any).aistudio.openSelectKey();
    setHasKey(true);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, isTranscribing, isLoading, showTextInput]);

  useEffect(() => {
    if (availableVoices.length > 0 && !appSettings.voiceURI) {
      const preferred = availableVoices.find(v => v.isCustom) || availableVoices[0];
      setAppSettings(prev => ({ ...prev, voiceURI: preferred.voiceURI }));
    }
  }, [availableVoices]);

  const handleSend = async () => {
    if (!input.trim()) return;
    const text = input;
    setInput('');
    setShowTextInput(false);
    const aiMsg = await sendMessage(text, showDeepAnalyze);
    if (appSettings.autoSpeak && aiMsg) {
      const selectedVoice = availableVoices.find(v => v.voiceURI === appSettings.voiceURI) || null;
      speak(aiMsg.content, selectedVoice, appSettings.speechRate, aiMsg.id);
    }
  };

  const toggleRecording = async () => {
    stopSpeaking();
    if (isListening) {
      const audioData = await stopRecording();
      if (audioData) {
        setIsTranscribing(true);
        try {
          const reader = new FileReader();
          reader.readAsDataURL(audioData.blob);
          reader.onloadend = async () => {
            const base64 = (reader.result as string).split(',')[1];
            try {
              const transcribedText = await transcribeAudio(base64, audioData.mimeType);
              if (transcribedText) {
                setShowTextInput(true);
                setInput(transcribedText);
              }
            } catch (e) {
              console.error("Transcription failed", e);
            } finally {
              setIsTranscribing(false);
            }
          };
        } catch (err) {
          console.error(err);
          setIsTranscribing(false);
        }
      }
    } else {
      await startRecording();
    }
  };

  // Truncate live transcript to last ~200 chars to prevent screen overflow
  const truncateTranscript = (text: string, maxLen: number = 200) => {
    if (text.length <= maxLen) return text;
    return '...' + text.slice(-maxLen);
  };

  if (authLoading) {
    return (
      <div className="h-screen bg-teal-950 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-teal-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    // If trying to access /admin without auth, show login
    return <LoginPage />;
  }

  // Block /admin for non-admins
  if (window.location.pathname === '/admin' && !isAdmin) {
    return (
      <div className="h-screen bg-teal-950 flex flex-col items-center justify-center text-white p-8 text-center">
        <div className="w-16 h-16 bg-red-600 rounded-2xl flex items-center justify-center mb-6">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
        </div>
        <h1 className="text-2xl font-black mb-2">Accès refusé</h1>
        <p className="text-teal-300 mb-6">Cette page est réservée aux administrateurs.</p>
        <button onClick={() => { window.location.href = '/'; }} className="px-8 py-3 bg-teal-600 text-white rounded-full font-bold hover:bg-teal-700">Retour à l'accueil</button>
      </div>
    );
  }

  if (hasKey === false) {
    return (
      <div className="h-screen bg-teal-950 flex flex-col items-center justify-center p-8 text-center text-white">
        <div className="w-20 h-20 bg-teal-600 rounded-2xl flex items-center justify-center mb-6 shadow-2xl animate-bounce">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>
        </div>
        <h1 className="text-3xl font-black mb-4">Clé API requise</h1>
        <p className="text-teal-200 mb-8 max-w-md">Pour accéder à {APP_NAME}, vous devez d'abord sélectionner une clé API payante.</p>
        <button onClick={handleOpenKeyDialog} className="px-12 py-4 bg-white text-teal-900 rounded-full font-bold text-lg hover:bg-teal-100 transition-all transform active:scale-95 shadow-2xl">Connecter la clé</button>
      </div>
    );
  }

  if (currentView === 'admin') return <AdminPanel onBack={() => setCurrentView('chat')} />;
  if (currentView === 'import') return <BulkImportPage onBack={() => setCurrentView('chat')} />;

  return (
    <div className="flex h-screen bg-slate-100 relative overflow-hidden">
      <ChatHistorySidebar
        sessions={chatSessions}
        currentChatId={currentChatId}
        onSelectChat={selectChat}
        onNewChat={createNewChat}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        user={{ uid: user.id, email: null, displayName: user.name, photoURL: null, role: user.role }}
        onLogout={logout}
      />

      <main className="flex-1 flex flex-col h-full w-full max-w-5xl mx-auto bg-white shadow-2xl relative">
        {/* ═══ LIVE MODE OVERLAY ═══ */}
        {(liveStatus === 'connected' || liveStatus === 'connecting' || liveStatus === 'error') && (
          <div className="absolute inset-0 z-50 bg-teal-950 flex flex-col items-center justify-center text-white p-6 overflow-hidden">
            <div className="flex-1 flex flex-col items-center justify-center w-full relative">
              <div className={`w-40 h-40 rounded-full border-4 flex items-center justify-center transition-all duration-500 ${isLiveModelSpeaking ? 'border-teal-400 scale-110 shadow-[0_0_50px_rgba(45,212,191,0.3)]' : 'border-teal-800'}`}>
                <div className="text-center font-bold tracking-widest text-teal-100 text-sm">
                  {liveStatus === 'connecting' ? 'CONNEXION...' : isLiveModelSpeaking ? 'PARLE' : 'ÉCOUTE'}
                </div>
              </div>
              {/* Transcript area — limited height, scrollable, smaller text */}
              <div className="mt-8 max-w-md w-full text-center space-y-3 max-h-[40vh] overflow-y-auto px-4">
                {liveTranscript.user && (
                  <p className="text-slate-400 text-xs leading-relaxed">{truncateTranscript(liveTranscript.user, 300)}</p>
                )}
                {liveTranscript.model && (
                  <p className="text-teal-100 text-sm font-serif italic leading-relaxed">{truncateTranscript(liveTranscript.model, 400)}</p>
                )}
              </div>
            </div>
            <button onClick={disconnectLive} className="mb-8 px-12 py-3 bg-red-600/90 hover:bg-red-600 text-white rounded-full font-bold shadow-2xl text-sm">Terminer la session</button>
          </div>
        )}

        {/* ═══ HEADER ═══ */}
        <header className="h-16 border-b border-teal-50 bg-white/80 backdrop-blur-md flex items-center justify-between px-6 shrink-0 z-10 sticky top-0">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden text-slate-500 p-2 hover:bg-slate-50 rounded-lg"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/></svg></button>
            <h1 className="text-xl font-black text-teal-800 tracking-tighter flex items-center gap-2 uppercase">
              <span className="w-2 h-6 bg-teal-600 rounded-full" />
              {APP_NAME}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={connectLive} className="px-5 py-2 bg-teal-600 text-white rounded-full font-bold text-sm hover:bg-teal-700 shadow-md transition-all">Mode Direct</button>
            <button onClick={() => setIsSettingsOpen(true)} className="p-2 text-slate-400 hover:text-teal-600 transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg></button>
          </div>
        </header>

        {/* ═══ MESSAGES ═══ */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50 pb-40">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === Role.USER ? 'justify-end' : 'justify-start'} animate-in fade-in duration-300`}>
              <div className={`max-w-[85%] ${msg.role === Role.USER ? 'bg-teal-700 text-white rounded-2xl rounded-tr-none shadow-md' : 'bg-white text-slate-800 rounded-2xl rounded-tl-none border border-slate-100 shadow-sm'} p-4`}>
                {msg.role === Role.MODEL && msg.thoughts && <ThinkingAccordion thoughts={msg.thoughts} />}
                <div className="whitespace-pre-wrap leading-relaxed text-[15px]">{msg.content}</div>
                <div className="mt-3 flex items-center justify-between opacity-50 text-[10px]">
                  <span>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                  {msg.role === Role.MODEL && <button onClick={() => speak(msg.content, null, 1, msg.id)} className="hover:text-teal-600 font-bold border-b border-dotted">Écouter</button>}
                </div>
              </div>
            </div>
          ))}

          {streamingContent && (
            <div className="flex justify-start">
              <div className="max-w-[85%] bg-white text-slate-800 rounded-2xl rounded-tl-none border border-slate-100 shadow-sm p-4 animate-in fade-in">
                <div className="whitespace-pre-wrap leading-relaxed text-[15px]">{streamingContent}</div>
                <span className="w-1.5 h-4 bg-teal-500 animate-pulse inline-block ml-1" />
              </div>
            </div>
          )}

          {isLoading && !streamingContent && (
            <div className="flex justify-start">
              <div className="max-w-[85%] bg-white text-slate-800 rounded-2xl rounded-tl-none border border-slate-100 shadow-sm p-4 animate-in fade-in">
                <div className="flex items-center gap-3 text-teal-600 font-medium text-sm">
                  <div className="flex space-x-1">
                    <div className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce"></div>
                    <div className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                    <div className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                  </div>
                  <span>{loadingPhase === 'searching' ? 'Consultation de la bibliothèque...' : 'Réflexion en cours...'}</span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="max-w-md mx-auto p-4 bg-red-50 border border-red-100 text-red-700 rounded-xl text-sm text-center font-medium animate-in slide-in-from-top-4">
              {error}
              <button onClick={() => window.location.reload()} className="block mx-auto mt-2 underline opacity-60 text-xs">Réinitialiser</button>
            </div>
          )}

          <div ref={messagesEndRef} className="h-4" />
        </div>

        {/* ═══ INPUT AREA ═══ */}
        <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-white via-white/95 to-transparent pointer-events-none">
          <div className="max-w-2xl mx-auto flex flex-col items-center pointer-events-auto">
            {showTextInput && (
              <div className="w-full mb-6 bg-white rounded-2xl shadow-2xl border border-slate-100 p-3 animate-in slide-in-from-bottom-6">
                <div className="flex gap-3">
                  <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder="Posez votre question..." className="flex-1 bg-slate-50 rounded-xl px-5 py-3 outline-none resize-none focus:ring-2 focus:ring-teal-100 transition-all" rows={1} />
                  <button onClick={handleSend} className="px-6 bg-teal-600 text-white rounded-xl font-bold transition-all hover:bg-teal-700 shadow-lg active:scale-95">Envoyer</button>
                </div>
              </div>
            )}
            <div className="flex items-center gap-12">
              <button onClick={() => setShowTextInput(!showTextInput)} className={`p-4 bg-white border border-slate-100 shadow-md rounded-full transition-all ${showTextInput ? 'text-teal-600 ring-4 ring-teal-50' : 'text-slate-400 hover:text-teal-600'}`}><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3-3v8a3 3 0 003 3z"/></svg></button>
              <button onClick={toggleRecording} className={`w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 ${isListening ? 'bg-red-500 scale-110 shadow-[0_0_40px_rgba(239,68,68,0.3)]' : 'bg-teal-600 hover:scale-105 shadow-2xl shadow-teal-900/20'} text-white`}>
                {isListening ? <div className="w-8 h-8 bg-white rounded-sm animate-pulse" /> : <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>}
                {isTranscribing && <div className="absolute inset-0 rounded-full border-4 border-teal-300 border-t-transparent animate-spin opacity-50" />}
              </button>
              <button onClick={() => setShowDeepAnalyze(!showDeepAnalyze)} className={`p-4 rounded-full border transition-all ${showDeepAnalyze ? 'border-teal-500 text-teal-600 bg-teal-50 ring-4 ring-teal-50' : 'border-slate-100 text-slate-400 bg-white shadow-md hover:text-teal-600'}`}><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.674a1 1 0 00.922-.617l2.108-4.742A1 1 0 0016.445 10H13a1 1 0 01-1-1V5a2 2 0 00-4 0v4a1 1 0 01-1 1H4.555a1 1 0 00-.922 1.383l2.108 4.742a1 1 0 00.922.617z"/></svg></button>
            </div>
          </div>
        </div>

        {/* ═══ SETTINGS MODAL ═══ */}
        {isSettingsOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-6" onClick={() => setIsSettingsOpen(false)}>
            <div className="bg-white rounded-3xl w-full max-w-md p-8 shadow-2xl relative animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
              <button onClick={() => setIsSettingsOpen(false)} className="absolute top-6 right-6 text-slate-400 p-2"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>
              <h2 className="text-2xl font-black text-slate-900 mb-8 uppercase tracking-widest">Paramètres</h2>
              <div className="space-y-6">
                <div className="flex justify-between items-center"><span className="font-bold">Narration automatique</span><input type="checkbox" checked={appSettings.autoSpeak} onChange={e => setAppSettings({...appSettings, autoSpeak: e.target.checked})} className="w-6 h-6 accent-teal-600 rounded" /></div>
                <div><label className="block text-sm font-bold mb-2">Voix du narrateur</label><select value={appSettings.voiceURI} onChange={e => setAppSettings({...appSettings, voiceURI: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 outline-none focus:ring-2 focus:ring-teal-100">{availableVoices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}</select></div>
                <div className="pt-8 flex flex-col gap-4">
                  {isAdmin && (
                    <button onClick={() => { setIsSettingsOpen(false); setCurrentView('admin'); }} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-colors shadow-xl">Panneau Admin</button>
                  )}
                  <button onClick={() => { setIsSettingsOpen(false); logout(); }} className="w-full py-3 border border-red-300 text-red-600 rounded-2xl font-bold hover:bg-red-50 transition-all">Se déconnecter</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

const App: React.FC = () => (
  <AuthProvider>
    <AppContent />
  </AuthProvider>
);

export default App;
