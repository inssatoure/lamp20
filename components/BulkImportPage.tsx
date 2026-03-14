import React, { useState, useRef } from 'react';
import { addCorpusItem, getAllCorpusItems } from '../services/dbService';
import { CorpusItem } from '../types';

export const BulkImportPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [log, setLog] = useState<{ msg: string; type: 'ok' | 'err' | 'skip' | 'info' }[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState({ ok: 0, skip: 0, err: 0, total: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  const addLog = (msg: string, type: 'ok' | 'err' | 'skip' | 'info') => {
    setLog(prev => [...prev, { msg, type }]);
  };

  const filenameToTitle = (name: string) =>
    name.replace('.txt', '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsRunning(true);
    setLog([]);
    setStats({ ok: 0, skip: 0, err: 0, total: files.length });

    addLog(`Starting import of ${files.length} files...`, 'info');

    // Load existing to skip dupes
    let existingTitles = new Set<string>();
    try {
      const existing = await getAllCorpusItems();
      existingTitles = new Set(existing.map(i => i.title));
      addLog(`Found ${existingTitles.size} existing documents.`, 'info');
    } catch {
      addLog('Could not load existing docs — will import all.', 'err');
    }

    let ok = 0, skip = 0, err = 0;

    for (const file of Array.from(files) as File[]) {
      const title = filenameToTitle(file.name);

      if (existingTitles.has(title)) {
        skip++;
        setStats(s => ({ ...s, skip }));
        addLog(`SKIP: ${title} (already exists)`, 'skip');
        continue;
      }

      try {
        const text = await file.text();
        if (!text.trim()) { skip++; continue; }

        const item: CorpusItem = {
          id: Date.now().toString() + '_' + ok,
          title,
          content: text.trim(),
          arabicText: text.trim(),
          category: 'Khassaid',
          sourceRef: `Khassaid - ${title} - Cheikh Ahmadou Bamba`,
          language: 'ar',
          addedAt: Date.now(),
          addedBy: 'bulk_import',
        };

        await addCorpusItem(item);
        ok++;
        setStats(s => ({ ...s, ok }));
        addLog(`OK: ${title} (${text.length} chars)`, 'ok');
      } catch (e: any) {
        err++;
        setStats(s => ({ ...s, err }));
        addLog(`ERROR: ${title} — ${e.message}`, 'err');
      }
    }

    addLog(`\nDone! ${ok} imported, ${skip} skipped, ${err} errors.`, 'info');
    setIsRunning(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-black text-teal-400">Khassaid Bulk Import</h1>
          <button onClick={onBack} className="text-sm text-slate-400 hover:text-white">Back to App</button>
        </div>

        <p className="text-slate-400 mb-6">Select all .txt files from <code className="bg-slate-800 px-2 py-1 rounded">Textes_Arabes_Serigne_Touba/</code></p>

        <input ref={fileRef} type="file" multiple accept=".txt" onChange={handleImport} className="hidden" />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={isRunning}
          className={`px-8 py-3 rounded-xl font-bold text-lg ${isRunning ? 'bg-slate-700 text-slate-500' : 'bg-teal-600 text-white hover:bg-teal-500'}`}
        >
          {isRunning ? `Importing... ${stats.ok}/${stats.total}` : 'Select .txt Files'}
        </button>

        {stats.total > 0 && (
          <div className="flex gap-4 mt-6">
            <div className="bg-slate-800 p-4 rounded-xl"><span className="text-xs text-slate-500">Imported</span><b className="block text-2xl text-green-400">{stats.ok}</b></div>
            <div className="bg-slate-800 p-4 rounded-xl"><span className="text-xs text-slate-500">Skipped</span><b className="block text-2xl text-yellow-400">{stats.skip}</b></div>
            <div className="bg-slate-800 p-4 rounded-xl"><span className="text-xs text-slate-500">Errors</span><b className="block text-2xl text-red-400">{stats.err}</b></div>
            <div className="bg-slate-800 p-4 rounded-xl"><span className="text-xs text-slate-500">Total</span><b className="block text-2xl text-slate-300">{stats.total}</b></div>
          </div>
        )}

        {stats.total > 0 && (
          <div className="w-full bg-slate-800 rounded-full h-2 mt-4">
            <div className="bg-teal-500 h-2 rounded-full transition-all" style={{ width: `${((stats.ok + stats.skip + stats.err) / stats.total) * 100}%` }} />
          </div>
        )}

        <div className="mt-6 bg-slate-800 rounded-xl p-4 max-h-96 overflow-y-auto font-mono text-xs space-y-1">
          {log.length === 0 && <p className="text-slate-600">Import log will appear here...</p>}
          {log.map((l, i) => (
            <div key={i} className={l.type === 'ok' ? 'text-green-400' : l.type === 'err' ? 'text-red-400' : l.type === 'skip' ? 'text-yellow-400' : 'text-slate-400'}>
              {l.msg}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
