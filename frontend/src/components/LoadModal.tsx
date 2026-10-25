import { useEffect, useState } from 'react';
import { FolderOpen, Loader2, Trash2, X } from 'lucide-react';
import type { ProjectSummary } from '../types';
import { api } from '../lib/api';

interface Props {
  currentId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  onDeleted: (id: string) => void;
}

export function LoadModal({ currentId, onOpen, onClose, onDeleted }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.list().then(setProjects).catch((e) => setError(String(e.message ?? e)));
  }, []);

  const remove = async (p: ProjectSummary) => {
    if (!confirm(`Delete project "${p.name}" from the database?`)) return;
    try {
      await api.remove(p.id);
      setProjects((ps) => ps?.filter((x) => x.id !== p.id) ?? null);
      onDeleted(p.id);
    } catch (e) {
      setError(String((e as Error).message));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40" onMouseDown={onClose}>
      <div className="w-[520px] max-w-[92vw] rounded-lg bg-white shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold">Load Project</h2>
          <button className="rounded p-1 hover:bg-slate-100" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {error && <p className="m-2 rounded bg-red-50 p-2 text-sm text-red-700">Could not reach the API: {error}</p>}
          {!projects && !error && <p className="flex items-center gap-2 p-4 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</p>}
          {projects?.length === 0 && <p className="p-4 text-sm text-slate-500">No saved projects yet. Use "Save to DB" to store one.</p>}
          {projects?.map((p) => (
            <div key={p.id} className={`flex items-center gap-3 rounded px-3 py-2 hover:bg-slate-50 ${p.id === currentId ? 'bg-blue-50' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="font-mono text-[11px] text-slate-400">updated {new Date(p.updated_at).toLocaleString()}</div>
              </div>
              <button className="btn" onClick={() => onOpen(p.id)}><FolderOpen size={14} /> Open</button>
              <button className="btn text-red-600 hover:bg-red-50" title="Delete" onClick={() => remove(p)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
