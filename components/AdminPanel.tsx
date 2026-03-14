
import React, { useState, useEffect } from 'react';
import { CorpusItem, MemoryItem, ChatSession, Message, Role } from '../types';
import { getAllCorpusItems, addCorpusItem, deleteCorpusItem, updateCorpusItem } from '../services/dbService';
import { getAllMemories, validateMemory, rejectMemory, deleteMemory, saveMasterMemory } from '../services/memoryService';
import { getAllUsers, PhoneUser } from '../services/authService';
import { db } from '../services/firebase';
import { collection, getDocs, query, orderBy } from '@firebase/firestore';

interface AdminPanelProps {
  onBack: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ onBack }) => {
  const [items, setItems] = useState<CorpusItem[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [section, setSection] = useState<'corpus' | 'memory' | 'users'>('corpus');
  const [view, setView] = useState<'dashboard' | 'editor'>('dashboard');
  const [editingItem, setEditingItem] = useState<CorpusItem | null>(null);
  const [memoryFilter, setMemoryFilter] = useState<'all' | 'pending' | 'active'>('all');

  // Corpus Form State
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<CorpusItem['category']>('General');
  const [sourceRef, setSourceRef] = useState('');
  const [wolofText, setWolofText] = useState('');
  const [arabicText, setArabicText] = useState('');

  // Memory Form State
  const [newMemoryContent, setNewMemoryContent] = useState('');
  const [newMemoryType, setNewMemoryType] = useState<MemoryItem['type']>('teaching');
  const [showMemoryForm, setShowMemoryForm] = useState(false);

  // Bulk Import State
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0, errors: 0 });

  // Users State
  const [users, setUsers] = useState<PhoneUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<PhoneUser | null>(null);
  const [userChats, setUserChats] = useState<ChatSession[]>([]);
  const [selectedChat, setSelectedChat] = useState<ChatSession | null>(null);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);

  useEffect(() => {
    loadItems();
    loadMemories();
  }, []);

  useEffect(() => {
    if (section === 'users' && users.length === 0) {
      loadUsers();
    }
  }, [section]);

  const loadItems = async () => {
    const data = await getAllCorpusItems();
    setItems(data.sort((a, b) => b.addedAt - a.addedAt));
  };

  const loadMemories = async () => {
    const data = await getAllMemories();
    setMemories(data);
  };

  const loadUsers = async () => {
    try {
      const data = await getAllUsers();
      setUsers(data.sort((a, b) => b.createdAt - a.createdAt));
    } catch (e) {
      console.error('Failed to load users:', e);
    }
  };

  const loadUserChats = async (userId: string) => {
    try {
      const q = query(collection(db, `users_phone/${userId}/chats`), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      setUserChats(snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatSession)));
    } catch (e) {
      console.error('Failed to load user chats:', e);
      setUserChats([]);
    }
  };

  const loadChatMessages = async (userId: string, chatId: string) => {
    try {
      const q = query(collection(db, `users_phone/${userId}/chats/${chatId}/messages`), orderBy('timestamp', 'asc'));
      const snap = await getDocs(q);
      setChatMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as Message)));
    } catch (e) {
      console.error('Failed to load messages:', e);
      setChatMessages([]);
    }
  };

  // ─── CORPUS HANDLERS ───

  const handleEdit = (item: CorpusItem) => {
    setEditingItem(item);
    setTitle(item.title);
    setContent(item.content);
    setCategory(item.category);
    setSourceRef(item.sourceRef || '');
    setWolofText(item.wolofText || '');
    setArabicText(item.arabicText || '');
    setView('editor');
  };

  const handleDelete = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this document?")) {
      await deleteCorpusItem(id);
      await loadItems();
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const itemToSave: CorpusItem = {
      id: editingItem ? editingItem.id : Date.now().toString(),
      title, content, category,
      addedAt: editingItem ? editingItem.addedAt : Date.now(),
      sourceRef: sourceRef || undefined,
      wolofText: wolofText || undefined,
      arabicText: arabicText || undefined,
    };
    if (editingItem) {
      await updateCorpusItem(itemToSave);
    } else {
      await addCorpusItem(itemToSave);
    }
    resetCorpusForm();
    setView('dashboard');
    await loadItems();
  };

  const resetCorpusForm = () => {
    setEditingItem(null); setTitle(''); setContent(''); setCategory('General');
    setSourceRef(''); setWolofText(''); setArabicText('');
  };

  const handleCreateNew = () => { resetCorpusForm(); setSection('corpus'); setView('editor'); };

  // ─── MEMORY HANDLERS ───

  const handleValidateMemory = async (id: string) => { await validateMemory(id, 'admin'); await loadMemories(); };
  const handleRejectMemory = async (id: string) => { await rejectMemory(id); await loadMemories(); };
  const handleDeleteMemory = async (id: string) => {
    if (window.confirm("Delete this memory permanently?")) { await deleteMemory(id); await loadMemories(); }
  };
  const handleAddMasterMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemoryContent.trim()) return;
    await saveMasterMemory(newMemoryContent, newMemoryType, 'Admin manual entry');
    setNewMemoryContent(''); setNewMemoryType('teaching'); setShowMemoryForm(false);
    await loadMemories();
  };

  // ─── BULK IMPORT ───

  const filenameToTitle = (filename: string): string =>
    filename.replace('.txt', '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const handleBulkImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const existingTitles = new Set(items.map(i => i.title));
    setIsImporting(true);
    setImportProgress({ done: 0, total: files.length, errors: 0 });
    let done = 0, errors = 0;
    for (const file of Array.from(files) as File[]) {
      const t = filenameToTitle(file.name);
      if (existingTitles.has(t)) { done++; setImportProgress(p => ({ ...p, done })); continue; }
      try {
        const text = await file.text();
        if (!text.trim()) { done++; continue; }
        const item: CorpusItem = {
          id: Date.now().toString() + '_' + done, title: t, content: text.trim(), arabicText: text.trim(),
          category: 'Khassaid', sourceRef: `Khassaid - ${t} - Cheikh Ahmadou Bamba`,
          language: 'ar', addedAt: Date.now(), addedBy: 'bulk_import',
        };
        await addCorpusItem(item); existingTitles.add(t); done++;
      } catch { errors++; done++; }
      setImportProgress({ done, total: files.length, errors });
    }
    setIsImporting(false); await loadItems(); e.target.value = '';
  };

  // ─── STATS ───

  const corpusStats = {
    total: items.length,
    byCategory: items.reduce((acc, item) => { acc[item.category] = (acc[item.category] || 0) + 1; return acc; }, {} as Record<string, number>)
  };

  const memoryStats = {
    total: memories.length,
    active: memories.filter(m => m.status === 'active').length,
    pending: memories.filter(m => m.status === 'pending').length,
    rejected: memories.filter(m => m.status === 'rejected').length,
    master: memories.filter(m => m.source === 'master').length,
    community: memories.filter(m => m.source === 'community').length,
  };

  const filteredMemories = memories.filter(m => {
    if (memoryFilter === 'pending') return m.status === 'pending';
    if (memoryFilter === 'active') return m.status === 'active';
    return true;
  });

  const memoryTypeColors: Record<string, string> = {
    correction: 'bg-red-100 text-red-700', teaching: 'bg-blue-100 text-blue-700',
    preference: 'bg-yellow-100 text-yellow-700', fact: 'bg-green-100 text-green-700',
    terminology: 'bg-purple-100 text-purple-700', user_insight: 'bg-orange-100 text-orange-700',
  };

  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-700', pending: 'bg-yellow-100 text-yellow-700', rejected: 'bg-red-100 text-red-700',
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-teal-900 text-white flex flex-col shadow-2xl z-20">
        <div className="p-6 border-b border-teal-800">
          <h1 className="text-xl font-bold tracking-tight">LAMP Admin</h1>
          <p className="text-teal-400 text-xs mt-1">System Management</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <p className="text-teal-500 text-[10px] font-bold uppercase tracking-widest px-4 pt-4 pb-2">Knowledge</p>
          <button onClick={() => { setSection('corpus'); setView('dashboard'); }}
            className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-colors ${section === 'corpus' && view === 'dashboard' ? 'bg-teal-800 text-white' : 'text-teal-100 hover:bg-teal-800/50'}`}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
            Corpus Library
          </button>
          <button onClick={handleCreateNew}
            className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-colors ${section === 'corpus' && view === 'editor' ? 'bg-teal-800 text-white' : 'text-teal-100 hover:bg-teal-800/50'}`}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Document
          </button>

          <p className="text-teal-500 text-[10px] font-bold uppercase tracking-widest px-4 pt-6 pb-2">AI Brain</p>
          <button onClick={() => { setSection('memory'); setView('dashboard'); }}
            className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-colors ${section === 'memory' ? 'bg-teal-800 text-white' : 'text-teal-100 hover:bg-teal-800/50'}`}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.674M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
            AI Memory
            {memoryStats.pending > 0 && <span className="ml-auto bg-yellow-500 text-yellow-950 text-[10px] font-bold px-2 py-0.5 rounded-full">{memoryStats.pending}</span>}
          </button>

          <p className="text-teal-500 text-[10px] font-bold uppercase tracking-widest px-4 pt-6 pb-2">Community</p>
          <button onClick={() => { setSection('users'); setView('dashboard'); setSelectedUser(null); setSelectedChat(null); }}
            className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-colors ${section === 'users' ? 'bg-teal-800 text-white' : 'text-teal-100 hover:bg-teal-800/50'}`}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" /></svg>
            Users & Chats
          </button>
        </nav>

        <div className="p-4 border-t border-teal-800">
          <button onClick={onBack}
            className="w-full py-2 px-4 bg-teal-950 text-teal-200 rounded-lg hover:bg-teal-900 transition-colors text-sm flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" /></svg>
            Back to App
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <header className="bg-white border-b border-slate-200 px-8 py-5 flex items-center justify-between sticky top-0 z-10">
          <h2 className="text-2xl font-bold text-slate-800">
            {section === 'corpus'
              ? (view === 'dashboard' ? 'Knowledge Base Overview' : (editingItem ? 'Edit Document' : 'New Document'))
              : section === 'memory' ? 'AI Memory Management'
              : selectedChat ? `Chat: ${selectedChat.title || 'Untitled'}`
              : selectedUser ? `${selectedUser.name}'s Conversations`
              : 'Users & Conversations'}
          </h2>
          <div className="text-sm text-slate-500">
            {section === 'corpus' ? `${items.length} documents indexed`
              : section === 'memory' ? `${memoryStats.active} active | ${memoryStats.pending} pending`
              : `${users.length} users`}
          </div>
        </header>

        <div className="p-8">

          {/* ══════════ CORPUS DASHBOARD ══════════ */}
          {section === 'corpus' && view === 'dashboard' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                {['Quran', 'Hadith', 'Khassaid', 'Fatwa', 'General'].map(cat => (
                  <div key={cat} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                    <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">{cat}</span>
                    <span className="text-3xl font-bold text-teal-600 mt-2">{corpusStats.byCategory[cat] || 0}</span>
                  </div>
                ))}
              </div>

              <div className="bg-white border border-teal-200 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-800">Bulk Import Khassaid (.txt files)</h3>
                    <p className="text-xs text-slate-500 mt-1">Select multiple .txt files. Duplicates skipped.</p>
                  </div>
                  <label className={`px-5 py-2.5 rounded-lg font-medium text-sm cursor-pointer transition-all ${isImporting ? 'bg-slate-300 text-slate-500' : 'bg-teal-600 text-white hover:bg-teal-700'}`}>
                    {isImporting ? `Importing ${importProgress.done}/${importProgress.total}...` : 'Select .txt Files'}
                    <input type="file" multiple accept=".txt" onChange={handleBulkImport} disabled={isImporting} className="hidden" />
                  </label>
                </div>
                {isImporting && (
                  <div className="mt-4">
                    <div className="w-full bg-slate-200 rounded-full h-2">
                      <div className="bg-teal-600 h-2 rounded-full transition-all" style={{ width: `${(importProgress.done / importProgress.total) * 100}%` }} />
                    </div>
                    <p className="text-xs text-slate-500 mt-2">{importProgress.done}/{importProgress.total} processed {importProgress.errors > 0 && `(${importProgress.errors} errors)`}</p>
                  </div>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                  <h3 className="font-semibold text-slate-700">Recent Documents</h3>
                  <button onClick={handleCreateNew} className="text-sm text-teal-600 font-medium hover:text-teal-700">+ Add New</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-100">
                      <tr>
                        <th className="px-6 py-3 font-medium">Title</th>
                        <th className="px-6 py-3 font-medium">Category</th>
                        <th className="px-6 py-3 font-medium">Reference</th>
                        <th className="px-6 py-3 font-medium">Wolof</th>
                        <th className="px-6 py-3 font-medium">Added</th>
                        <th className="px-6 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map(item => (
                        <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-3 font-medium text-slate-800">{item.title}</td>
                          <td className="px-6 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${item.category === 'Quran' ? 'bg-green-100 text-green-700' : item.category === 'Khassaid' ? 'bg-purple-100 text-purple-700' : item.category === 'Hadith' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                              {item.category}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-slate-500 text-xs font-mono">{item.sourceRef || '—'}</td>
                          <td className="px-6 py-3 text-slate-500 text-xs">{item.wolofText ? 'Yes' : '—'}</td>
                          <td className="px-6 py-3 text-slate-500">{new Date(item.addedAt).toLocaleDateString()}</td>
                          <td className="px-6 py-3 text-right space-x-2">
                            <button onClick={() => handleEdit(item)} className="text-teal-600 hover:text-teal-800 font-medium">Edit</button>
                            <button onClick={() => handleDelete(item.id)} className="text-red-500 hover:text-red-700 font-medium">Delete</button>
                          </td>
                        </tr>
                      ))}
                      {items.length === 0 && (
                        <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-400">No documents found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ══════════ CORPUS EDITOR ══════════ */}
          {section === 'corpus' && view === 'editor' && (
            <div className="max-w-4xl mx-auto">
              <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">Document Title</label>
                    <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Surat Al-Fatiha" className="w-full bg-slate-50 border border-slate-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-teal-500 outline-none" />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">Category</label>
                    <select value={category} onChange={(e) => setCategory(e.target.value as any)} className="w-full bg-slate-50 border border-slate-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-teal-500 outline-none">
                      <option value="General">General</option><option value="Quran">Quran</option><option value="Hadith">Hadith</option><option value="Khassaid">Khassaid</option><option value="Fatwa">Fatwa</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">Source Reference</label>
                  <input type="text" value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} placeholder="e.g. Quran 2:255, Mafatihul Bishri v.12" className="w-full bg-slate-50 border border-slate-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-teal-500 outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">Content</label>
                  <textarea value={content} onChange={(e) => setContent(e.target.value)} required placeholder="Paste the full text content here..." className="w-full h-48 bg-slate-50 border border-slate-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-teal-500 outline-none resize-none font-mono text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">Arabic Text</label>
                  <textarea value={arabicText} onChange={(e) => setArabicText(e.target.value)} placeholder="Original Arabic..." className="w-full h-32 bg-slate-50 border border-slate-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-teal-500 outline-none resize-none text-right text-lg" dir="rtl" />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">Wolof Transcription</label>
                  <textarea value={wolofText} onChange={(e) => setWolofText(e.target.value)} placeholder="Wolof translation..." className="w-full h-32 bg-slate-50 border border-slate-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-teal-500 outline-none resize-none text-sm" />
                </div>
                <div className="flex items-center justify-end gap-4 pt-4 border-t border-slate-100">
                  <button type="button" onClick={() => { resetCorpusForm(); setView('dashboard'); }} className="px-6 py-2.5 text-slate-600 font-medium hover:bg-slate-50 rounded-lg transition-colors">Cancel</button>
                  <button type="submit" className="px-6 py-2.5 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 shadow-lg shadow-teal-200 transition-all active:scale-95">{editingItem ? 'Update Document' : 'Save to Library'}</button>
                </div>
              </form>
            </div>
          )}

          {/* ══════════ MEMORY SECTION ══════════ */}
          {section === 'memory' && (
            <div className="space-y-8">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm"><span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Total</span><span className="block text-3xl font-bold text-teal-600 mt-1">{memoryStats.total}</span></div>
                <div className="bg-white p-5 rounded-xl border border-green-200 shadow-sm"><span className="text-green-600 text-xs font-semibold uppercase tracking-wider">Active</span><span className="block text-3xl font-bold text-green-600 mt-1">{memoryStats.active}</span></div>
                <div className="bg-white p-5 rounded-xl border border-yellow-200 shadow-sm"><span className="text-yellow-600 text-xs font-semibold uppercase tracking-wider">Pending</span><span className="block text-3xl font-bold text-yellow-600 mt-1">{memoryStats.pending}</span></div>
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm"><span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">From Master</span><span className="block text-3xl font-bold text-blue-600 mt-1">{memoryStats.master}</span></div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  {(['all', 'pending', 'active'] as const).map(f => (
                    <button key={f} onClick={() => setMemoryFilter(f)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${memoryFilter === f ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
                      {f === 'all' ? 'All' : f === 'pending' ? `Pending (${memoryStats.pending})` : `Active (${memoryStats.active})`}
                    </button>
                  ))}
                </div>
                <button onClick={() => setShowMemoryForm(!showMemoryForm)} className="px-5 py-2 bg-teal-600 text-white rounded-lg font-medium text-sm hover:bg-teal-700">+ Teach AI Manually</button>
              </div>

              {showMemoryForm && (
                <form onSubmit={handleAddMasterMemory} className="bg-white border border-teal-200 rounded-xl p-6 space-y-4">
                  <h3 className="font-bold text-slate-800">Teach LAMP AI (Master Memory)</h3>
                  <p className="text-xs text-slate-500">Immediately active. The AI will follow this permanently.</p>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="md:col-span-3">
                      <textarea value={newMemoryContent} onChange={(e) => setNewMemoryContent(e.target.value)} required
                        placeholder="e.g. 'When asked about Touba, always mention it was founded in 1887'"
                        className="w-full bg-slate-50 border border-slate-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-teal-500 outline-none resize-none h-24" />
                    </div>
                    <div className="space-y-3">
                      <select value={newMemoryType} onChange={(e) => setNewMemoryType(e.target.value as any)} className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 text-sm">
                        <option value="teaching">Teaching</option><option value="correction">Correction</option><option value="preference">Preference</option><option value="fact">Fact</option><option value="terminology">Terminology</option>
                      </select>
                      <button type="submit" className="w-full py-2.5 bg-teal-600 text-white rounded-lg font-bold text-sm hover:bg-teal-700">Save Memory</button>
                    </div>
                  </div>
                </form>
              )}

              <div className="space-y-3">
                {filteredMemories.map(mem => (
                  <div key={mem.id} className={`bg-white border rounded-xl p-5 transition-all ${mem.status === 'pending' ? 'border-yellow-300 bg-yellow-50/30' : 'border-slate-200'}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${memoryTypeColors[mem.type] || 'bg-slate-100 text-slate-600'}`}>{mem.type}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${statusColors[mem.status]}`}>{mem.status}</span>
                          <span className="text-[10px] text-slate-400">{mem.source === 'master' ? 'Master' : 'Community'} · {new Date(mem.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className="text-sm text-slate-800 leading-relaxed">{mem.content}</p>
                        {mem.context && <p className="text-xs text-slate-400 mt-2 italic truncate">Context: {mem.context}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {mem.status === 'pending' && (
                          <>
                            <button onClick={() => handleValidateMemory(mem.id)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700">Approve</button>
                            <button onClick={() => handleRejectMemory(mem.id)} className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-bold hover:bg-red-600">Reject</button>
                          </>
                        )}
                        <button onClick={() => handleDeleteMemory(mem.id)} className="p-1.5 text-slate-400 hover:text-red-500 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredMemories.length === 0 && (
                  <div className="text-center py-12 text-slate-400">
                    {memoryFilter === 'pending' ? 'No pending memories to review.' : 'No memories yet.'}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════════ USERS & CONVERSATIONS SECTION ══════════ */}
          {section === 'users' && !selectedUser && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Total Users</span>
                  <span className="block text-3xl font-bold text-teal-600 mt-1">{users.length}</span>
                </div>
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Admins</span>
                  <span className="block text-3xl font-bold text-blue-600 mt-1">{users.filter(u => u.role === 'admin').length}</span>
                </div>
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Members</span>
                  <span className="block text-3xl font-bold text-green-600 mt-1">{users.filter(u => u.role === 'user').length}</span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
                  <h3 className="font-semibold text-slate-700">All Users</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-100">
                      <tr>
                        <th className="px-6 py-3 font-medium">Name</th>
                        <th className="px-6 py-3 font-medium">Phone</th>
                        <th className="px-6 py-3 font-medium">Role</th>
                        <th className="px-6 py-3 font-medium">Registered</th>
                        <th className="px-6 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {users.map(u => (
                        <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-3 font-medium text-slate-800">{u.name}</td>
                          <td className="px-6 py-3 text-slate-600 font-mono text-xs">{u.phone}</td>
                          <td className="px-6 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${u.role === 'admin' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{u.role}</span>
                          </td>
                          <td className="px-6 py-3 text-slate-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                          <td className="px-6 py-3 text-right">
                            <button onClick={() => { setSelectedUser(u); loadUserChats(u.id); }} className="text-teal-600 hover:text-teal-800 font-medium">View Chats</button>
                          </td>
                        </tr>
                      ))}
                      {users.length === 0 && (
                        <tr><td colSpan={5} className="px-6 py-10 text-center text-slate-400">No users registered yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ─── USER'S CHATS LIST ─── */}
          {section === 'users' && selectedUser && !selectedChat && (
            <div className="space-y-6">
              <button onClick={() => { setSelectedUser(null); setUserChats([]); }} className="text-sm text-teal-600 hover:text-teal-800 font-medium flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                Back to Users
              </button>

              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-bold text-xl">{selectedUser.name[0].toUpperCase()}</div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">{selectedUser.name}</h3>
                    <p className="text-sm text-slate-500">{selectedUser.phone} · {selectedUser.role} · {userChats.length} conversations</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {userChats.map(chat => (
                  <button key={chat.id} onClick={() => { setSelectedChat(chat); loadChatMessages(selectedUser.id, chat.id); }}
                    className="w-full text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-teal-300 transition-all group">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium text-slate-800 group-hover:text-teal-700">{chat.title || 'Untitled Chat'}</h4>
                        <p className="text-xs text-slate-400 mt-1">{new Date(chat.createdAt).toLocaleString()}</p>
                        {chat.lastMessage && <p className="text-sm text-slate-500 mt-2 truncate max-w-lg">{chat.lastMessage}</p>}
                      </div>
                      <svg className="w-5 h-5 text-slate-400 group-hover:text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </div>
                  </button>
                ))}
                {userChats.length === 0 && (
                  <div className="text-center py-12 text-slate-400">This user has no conversations yet.</div>
                )}
              </div>
            </div>
          )}

          {/* ─── CHAT MESSAGES VIEW ─── */}
          {section === 'users' && selectedUser && selectedChat && (
            <div className="space-y-6">
              <button onClick={() => { setSelectedChat(null); setChatMessages([]); }} className="text-sm text-teal-600 hover:text-teal-800 font-medium flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                Back to {selectedUser.name}'s Chats
              </button>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
                  <h3 className="font-semibold text-slate-700">{selectedChat.title || 'Untitled Chat'}</h3>
                  <p className="text-xs text-slate-400">{new Date(selectedChat.createdAt).toLocaleString()} · {chatMessages.length} messages</p>
                </div>

                <div className="p-6 space-y-4 max-h-[600px] overflow-y-auto">
                  {chatMessages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.role === Role.USER ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] p-4 rounded-2xl ${
                        msg.role === Role.USER
                          ? 'bg-teal-700 text-white rounded-tr-none'
                          : 'bg-slate-100 text-slate-800 rounded-tl-none'
                      }`}>
                        <div className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</div>
                        <div className="mt-2 text-[10px] opacity-50">{new Date(msg.timestamp).toLocaleTimeString()}</div>
                      </div>
                    </div>
                  ))}
                  {chatMessages.length === 0 && (
                    <div className="text-center py-12 text-slate-400">No messages in this conversation.</div>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
};
