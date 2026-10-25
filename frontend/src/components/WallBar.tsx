import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pencil, Plus, RotateCcw, RotateCw, X } from 'lucide-react';
import type { ProjectData, Room, Rotation, WallRun } from '../types';
import { SIDE_LABELS } from '../lib/defaults';
import { NumField } from './Inspector';

interface Props {
  data: ProjectData;
  onActivate: (id: string) => void;
  onAddIsland: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onRemoveWall: (id: string) => void;
  onRestoreWall: (id: string) => void;
  onUpdateRoom: (patch: Partial<Room>) => void;
  onUpdateRun: (patch: Partial<WallRun>) => void;
}

function TabName({ name, editing, onDone }: { name: string; editing: boolean; onDone: (name: string | null) => void }) {
  const [draft, setDraft] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      setDraft(name);
      requestAnimationFrame(() => ref.current?.select());
    }
  }, [editing, name]);
  if (!editing) return <span>{name}</span>;
  return (
    <input
      ref={ref}
      className="w-36 rounded border border-blue-500 px-1 text-sm outline-none"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onDone(draft.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(draft.trim() || null);
        if (e.key === 'Escape') onDone(null);
      }}
    />
  );
}

const Setting = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="flex items-center gap-1.5 text-xs text-slate-600">
    {label}
    {children}
  </label>
);

export function WallBar({ data, onActivate, onAddIsland, onRename, onDelete, onRemoveWall, onRestoreWall, onUpdateRoom, onUpdateRun }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const { room } = data;
  const walls = data.walls.filter((w) => !w.removed);
  const openSides = data.walls.filter((w) => w.removed);
  const active = walls.find((w) => w.id === data.activeWallId) ?? walls[0];

  return (
    <div className="border-b border-slate-300 bg-white">
      <div className="flex items-end gap-1 overflow-x-auto px-3 pt-2">
        {walls.map((w) => {
          const isActive = w.id === active.id;
          return (
            <div
              key={w.id}
              onClick={() => onActivate(w.id)}
              onDoubleClick={() => setEditingId(w.id)}
              className={`group flex cursor-pointer items-center gap-1.5 rounded-t border border-b-0 px-3 py-1.5 text-sm ${
                isActive ? 'border-slate-300 bg-slate-100 font-semibold text-slate-900' : 'border-transparent text-slate-500 hover:bg-slate-50'
              }`}
            >
              <TabName name={w.name} editing={editingId === w.id} onDone={(name) => {
                if (name) onRename(w.id, name);
                setEditingId(null);
              }} />
              <span className="font-mono text-[10px] font-normal uppercase text-slate-400">
                {w.kind === 'wall' ? SIDE_LABELS[w.side ?? 'north'] : 'island'} · {w.items.length}
              </span>
              {isActive && editingId !== w.id && (
                <>
                  <button title="Rename" className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700" onClick={(e) => { e.stopPropagation(); setEditingId(w.id); }}>
                    <Pencil size={12} />
                  </button>
                  {walls.length > 1 && (
                    <button
                      title={w.kind === 'island' ? 'Delete island' : 'Remove wall (open side)'}
                      className="rounded p-0.5 text-slate-400 hover:bg-red-100 hover:text-red-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        const items = w.items.length ? ` and its ${w.items.length} element(s)` : '';
                        if (w.kind === 'island') {
                          if (confirm(`Delete "${w.name}"${items}?`)) onDelete(w.id);
                        } else if (confirm(`Remove "${w.name}"${items}? That side of the room becomes open; you can restore the wall later.`)) {
                          onRemoveWall(w.id);
                        }
                      }}
                    >
                      <X size={12} />
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
        <button className="mb-1 ml-1 inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-blue-600 hover:bg-blue-50" onClick={onAddIsland}>
          <Plus size={14} /> Add Island
        </button>
        {openSides.map((w) => (
          <button key={w.id} className="mb-1 inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100" title={`${w.name} is an open side`} onClick={() => onRestoreWall(w.id)}>
            <RotateCcw size={13} /> Restore {w.name} · {SIDE_LABELS[w.side ?? 'north']}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-300 bg-slate-100 px-4 py-2">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Room</span>
        <Setting label="Width"><NumField className="w-24" value={room.widthCm} min={100} max={2000} onChange={(widthCm) => onUpdateRoom({ widthCm })} /></Setting>
        <Setting label="Depth"><NumField className="w-24" value={room.depthCm} min={100} max={2000} onChange={(depthCm) => onUpdateRoom({ depthCm })} /></Setting>
        <Setting label="Ceiling"><NumField className="w-24" value={room.heightCm} min={150} max={500} onChange={(heightCm) => onUpdateRoom({ heightCm })} /></Setting>

        <span className="h-5 w-px bg-slate-300" />
        <span className="text-xs font-bold uppercase tracking-wider text-blue-700">{active.name}</span>
        {active.kind === 'island' && (
          <>
            <Setting label="Length"><NumField className="w-24" value={active.widthCm} min={30} max={1000} onChange={(widthCm) => onUpdateRun({ widthCm })} /></Setting>
            <Setting label="Depth"><NumField className="w-24" value={active.depthCm ?? 90} min={30} max={300} onChange={(depthCm) => onUpdateRun({ depthCm })} /></Setting>
            <Setting label="X"><NumField className="w-24" value={active.planX ?? 0} onChange={(planX) => onUpdateRun({ planX })} /></Setting>
            <Setting label="Y"><NumField className="w-24" value={active.planY ?? 0} onChange={(planY) => onUpdateRun({ planY })} /></Setting>
            <button className="btn" title="Rotate 90°" onClick={() => onUpdateRun({ rotationDeg: (((active.rotationDeg ?? 0) + 90) % 360) as Rotation })}>
              <RotateCw size={14} /> {active.rotationDeg ?? 0}°
            </button>
          </>
        )}
        {active.kind === 'wall' && <span className="font-mono text-xs text-slate-500">length {active.widthCm} cm (from room)</span>}
        <Setting label="Countertop">
          <NumField className="w-24" value={active.countertopThicknessCm} min={0.5} max={15} step={0.5} onChange={(countertopThicknessCm) => onUpdateRun({ countertopThicknessCm })} />
        </Setting>
      </div>
    </div>
  );
}
