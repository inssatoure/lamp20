
import React from 'react';
import { ChatSession, UserProfile } from '../types';

interface ChatHistorySidebarProps {
  sessions: ChatSession[];
  currentChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  isOpen: boolean;
  onClose: () => void;
  user: UserProfile;
  onLogout?: () => void;
}

export const ChatHistorySidebar: React.FC<ChatHistorySidebarProps> = ({
  sessions,
  currentChatId,
  onSelectChat,
  onNewChat,
  isOpen,
  onClose,
  user,
  onLogout,
}) => {
  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed lg:relative z-50 w-72 h-full bg-slate-900 border-r border-slate-800 shadow-xl transform transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 lg:w-0 lg:hidden'
        } lg:translate-x-0 lg:static lg:w-72`}
      >
        <div className="p-4 border-b border-slate-800 bg-slate-900">
          <button
            onClick={() => { onNewChat(); onClose(); }}
            className="w-full py-3 px-4 bg-teal-600 hover:bg-teal-500 text-white rounded-xl flex items-center justify-center gap-2 font-medium transition-all shadow-lg shadow-teal-900/20"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
            Nouvelle conversation
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
           <h3 className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 mt-2">Historique</h3>
           {sessions.map(session => (
             <button
                key={session.id}
                onClick={() => { onSelectChat(session.id); onClose(); }}
                className={`w-full text-left p-3 rounded-lg text-sm transition-colors group flex items-start gap-3 ${
                    currentChatId === session.id
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                }`}
             >
                <svg className={`w-5 h-5 shrink-0 ${currentChatId === session.id ? 'text-teal-400' : 'text-slate-600 group-hover:text-slate-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <div className="flex-1 overflow-hidden">
                    <div className="truncate font-medium">{session.title || 'Discussion sans titre'}</div>
                    <div className="text-[10px] opacity-60 truncate">{new Date(session.createdAt).toLocaleDateString()}</div>
                </div>
             </button>
           ))}
           {sessions.length === 0 && (
               <div className="text-center py-10 px-4 text-slate-600 text-xs">
                   Pas encore d'historique.<br/>Commencez une conversation.
               </div>
           )}
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-900">
           <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-teal-800 flex items-center justify-center text-teal-200 font-bold">
                  {user.displayName?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="flex-1 overflow-hidden">
                  <div className="text-sm font-medium text-white truncate">{user.displayName || 'Utilisateur'}</div>
                  <div className="text-xs text-slate-500 truncate">{user.role === 'admin' ? 'Administrateur' : 'Membre'}</div>
              </div>
              {onLogout && (
                <button onClick={onLogout} className="p-2 text-slate-500 hover:text-red-400 transition-colors" title="Se déconnecter">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                </button>
              )}
           </div>
        </div>
      </aside>
    </>
  );
};
