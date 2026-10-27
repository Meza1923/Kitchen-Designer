import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Box,
  Database,
  FileDown,
  FileJson,
  FilePlus2,
  FileUp,
  FolderOpen,
  Grid2x2,
  Image,
  Loader2,
  Printer,
  RectangleHorizontal,
  Redo2,
  Rows2,
  Ruler,
  Undo2,
} from 'lucide-react';
import type { ElementCategory, KitchenItem, ProjectData, Room, WallRun } from './types';
import { createIsland, createItem, createProjectData, uid } from './lib/defaults';
import { clampX, findFreeX, isWallMounted, layerOf, normalizeWall } from './lib/geometry';
import { api } from './lib/api';
import { migrateProjectData } from './lib/migrate';
import { syncRoom } from './lib/plan';
import { exportJson, exportPng, importJson, printPdf, scheduleRows, wallWarnings } from './lib/export';
import { Canvas } from './components/Canvas';
import { PlanCanvas } from './components/PlanCanvas';
import { Inspector } from './components/Inspector';
import { Palette } from './components/Palette';
import { WallBar } from './components/WallBar';
import { LoadModal } from './components/LoadModal';
import { FrontsPanel } from './components/FrontsPanel';

// three.js is only downloaded when the 3D view is first opened.
const Scene3D = lazy(() => import('./components/Scene3D'));

interface ProjectState {
  id: string | null;
  name: string;
  data: ProjectData;
  savedAt: string | null;
  dirty: boolean;
  /** Undo / redo stacks of earlier and later project data. */
  past: ProjectData[];
  future: ProjectData[];
}

const HISTORY_LIMIT = 100;
/** Edits with the same key within this window (a drag, typing in a field) form one undo step. */
const COALESCE_MS = 1000;

interface EditOptions {
  /** Identifies a stream of edits that should coalesce into one undo step. */
  key?: string;
  /** false = not undoable (e.g. switching the active wall tab). */
  record?: boolean;
}

export type View = 'plan' | 'elevation' | 'split' | '3d';

const VIEWS: { id: View; label: string; icon: typeof Grid2x2 }[] = [
  { id: 'plan', label: 'Plan', icon: Grid2x2 },
  { id: 'elevation', label: 'Elevation', icon: RectangleHorizontal },
  { id: 'split', label: 'Split', icon: Rows2 },
  { id: '3d', label: '3D', icon: Box },
];

const loadedProject = (p: Pick<ProjectState, 'id' | 'name' | 'data' | 'savedAt' | 'dirty'>): ProjectState => ({
  ...p,
  past: [],
  future: [],
});
const freshProject = (): ProjectState =>
  loadedProject({ id: null, name: 'Untitled Kitchen', data: createProjectData(), savedAt: null, dirty: false });

function WallOverview({ wall, onSelect }: { wall: WallRun; onSelect: (id: string) => void }) {
  const rows = scheduleRows(wall);
  const sorted = [...wall.items].sort((a, b) => a.x - b.x || a.y - b.y);
  const warnings = wallWarnings(wall);
  return (
    <div className="px-4 py-3">
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-700">{wall.name} · Schedule</h3>
      {warnings.length > 0 && (
        <div className="mb-3 space-y-1 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {warnings.map((w, i) => (
            <div key={i} className="flex gap-1.5">
              <AlertTriangle size={13} className="mt-px shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">
          No elements yet. Add some from the catalog on the left, then click one to edit it.
        </p>
      ) : (
        <table className="w-full text-left font-mono text-[11px]">
          <thead className="text-slate-400">
            <tr>
              <th className="py-1">#</th>
              <th>Element</th>
              <th className="text-right">X</th>
              <th className="text-right">W×H</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={sorted[i].id}
                className="cursor-pointer border-t border-slate-100 hover:bg-blue-50"
                onClick={() => onSelect(sorted[i].id)}
              >
                <td className="py-1 text-slate-400">{r.no}</td>
                <td className="truncate">
                  {r.label ? `${r.label} · ` : ''}
                  {r.type}
                </td>
                <td className="text-right">{r.x}</td>
                <td className="text-right">{r.size}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function App() {
  const [project, setProject] = useState<ProjectState>(freshProject);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showLoad, setShowLoad] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [view, setView] = useState<View>('plan');
  const importRef = useRef<HTMLInputElement>(null);

  const { data } = project;
  const wall = data.walls.find((w) => w.id === data.activeWallId) ?? data.walls[0];
  const selected = wall.items.find((i) => i.id === selectedId) ?? null;

  const notify = (kind: 'ok' | 'error', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 4000);
  };

  const lastEdit = useRef<{ key: string; time: number } | null>(null);

  const setData = useCallback((fn: (d: ProjectData) => ProjectData, opts: EditOptions = {}) => {
    const now = Date.now();
    const prev = lastEdit.current;
    const coalesce = !!opts.key && prev?.key === opts.key && now - prev.time < COALESCE_MS;
    const record = opts.record !== false && !coalesce;
    lastEdit.current = opts.key ? { key: opts.key, time: now } : null;
    setProject((p) => ({
      ...p,
      data: fn(p.data),
      dirty: true,
      past: record ? [...p.past, p.data].slice(-HISTORY_LIMIT) : p.past,
      future: opts.record === false ? p.future : [],
    }));
  }, []);

  const undo = useCallback(() => {
    lastEdit.current = null;
    setProject((p) =>
      p.past.length
        ? {
            ...p,
            data: p.past[p.past.length - 1],
            past: p.past.slice(0, -1),
            future: [p.data, ...p.future],
            dirty: true,
          }
        : p,
    );
  }, []);

  const redo = useCallback(() => {
    lastEdit.current = null;
    setProject((p) =>
      p.future.length
        ? { ...p, data: p.future[0], past: [...p.past, p.data], future: p.future.slice(1), dirty: true }
        : p,
    );
  }, []);

  const updateWall = useCallback(
    (wallId: string, fn: (w: WallRun) => WallRun, key?: string) =>
      setData((d) => ({ ...d, walls: d.walls.map((w) => (w.id === wallId ? normalizeWall(fn(w)) : w)) }), { key }),
    [setData],
  );

  /** Patch an item wherever it lives (the plan can edit items on any run). */
  const updateItem = useCallback(
    (id: string, patch: Partial<KitchenItem>) =>
      setData(
        (d) => ({
          ...d,
          walls: d.walls.map((w) =>
            w.items.some((i) => i.id === id)
              ? normalizeWall({ ...w, items: w.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })
              : w,
          ),
        }),
        { key: `item:${id}:${Object.keys(patch).sort().join(',')}` },
      ),
    [setData],
  );

  const moveItemToWall = (id: string, targetId: string) => {
    setData((d) => {
      const item = d.walls.flatMap((w) => w.items).find((i) => i.id === id);
      if (!item) return d;
      return {
        ...d,
        activeWallId: targetId,
        walls: d.walls.map((w) => {
          const items = w.items.filter((i) => i.id !== id);
          return normalizeWall({ ...w, items: w.id === targetId ? [...items, item] : items });
        }),
      };
    });
  };

  const updateRoom = (patch: Partial<Room>) =>
    setData((d) => syncRoom({ ...d, room: { ...d.room, ...patch } }), { key: `room:${Object.keys(patch).join(',')}` });

  const selectInPlan = (runId: string, itemId: string | null) => {
    if (runId !== data.activeWallId) setData((d) => ({ ...d, activeWallId: runId }), { record: false });
    setSelectedId(itemId);
  };

  const addItem = (category: ElementCategory, overrides: Partial<KitchenItem> = {}) => {
    if (isWallMounted(category) && wall.kind !== 'wall') {
      notify('error', 'Doors, windows and sockets go on a wall: select Wall A–D first.');
      return;
    }
    const item = { ...createItem(category), ...overrides };
    item.x = findFreeX(wall, item);
    updateWall(wall.id, (w) => ({ ...w, items: [...w.items, item] }));
    setSelectedId(item.id);
  };

  const duplicateItem = (item: KitchenItem) => {
    const copy: KitchenItem = { ...structuredClone(item), id: uid() };
    copy.tallZones = copy.tallZones?.map((z) => ({ ...z, id: uid() }));
    const besideRight = item.x + item.width;
    copy.x = besideRight + item.width <= wall.widthCm ? besideRight : findFreeX(wall, copy);
    updateWall(wall.id, (w) => ({ ...w, items: [...w.items, copy] }));
    setSelectedId(copy.id);
  };

  const deleteItem = useCallback(
    (id: string) => {
      setData((d) => ({
        ...d,
        walls: d.walls.map((w) =>
          w.items.some((i) => i.id === id) ? { ...w, items: w.items.filter((i) => i.id !== id) } : w,
        ),
      }));
      setSelectedId(null);
    },
    [setData],
  );

  // Keyboard: Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z or Ctrl+Y redo; Delete/Backspace removes the selection; arrows nudge it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        if (e.key.toLowerCase() === 'y' || e.shiftKey) redo();
        else undo();
        return;
      }
      if (!selected || view === '3d') return; // the 3D view only edits fronts
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteItem(selected.id);
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          updateItem(selected.id, { x: clampX(wall, selected, selected.x + (e.key === 'ArrowLeft' ? -step : step)) });
        } else if (layerOf(selected.category) === 'upper') {
          updateItem(selected.id, { y: selected.y + (e.key === 'ArrowUp' ? step : -step) });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, wall, view, deleteItem, updateItem, undo, redo]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (project.dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [project.dirty]);

  const confirmDiscard = () => !project.dirty || confirm('Discard unsaved changes to the current project?');

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      notify('error', (e as Error).message || String(e));
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run('save', async () => {
      const rec = project.id ? await api.update(project.id, project.name, data) : await api.create(project.name, data);
      setProject((p) => ({ ...p, id: rec.id, savedAt: rec.updated_at, dirty: false }));
      notify('ok', `Saved "${rec.name}"`);
    });

  const open = (id: string) =>
    run('load', async () => {
      if (!confirmDiscard()) return;
      const rec = await api.get(id);
      setProject(
        loadedProject({
          id: rec.id,
          name: rec.name,
          data: migrateProjectData(rec.data),
          savedAt: rec.updated_at,
          dirty: false,
        }),
      );
      setSelectedId(null);
      setShowLoad(false);
    });

  const onImport = async (file: File) => {
    try {
      if (!confirmDiscard()) return;
      const { name, data: imported } = await importJson(file);
      setProject(loadedProject({ id: null, name, data: migrateProjectData(imported), savedAt: null, dirty: true }));
      setSelectedId(null);
      notify('ok', `Imported "${name}" — save to store it in the database`);
    } catch (e) {
      notify('error', `Import failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Project / save / export bar */}
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-700 bg-slate-800 px-3 py-2 text-slate-100">
        <div className="mr-2 flex items-center gap-2">
          <Ruler size={18} className="text-sky-300" />
          <span className="text-sm font-semibold tracking-wide">KITCHEN DESIGNER</span>
        </div>
        <input
          className="w-56 rounded border border-slate-600 bg-slate-700 px-2 py-1 text-sm text-white focus:border-sky-400 focus:outline-none"
          value={project.name}
          onChange={(e) => setProject((p) => ({ ...p, name: e.target.value, dirty: true }))}
          placeholder="Project name"
        />
        <span className="font-mono text-[11px] text-slate-400">
          {project.dirty
            ? '● unsaved changes'
            : project.savedAt
              ? `saved ${new Date(project.savedAt).toLocaleString()}`
              : 'not saved'}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button className="btn px-1.5" title="Undo (⌘/Ctrl+Z)" disabled={!project.past.length} onClick={undo}>
            <Undo2 size={14} />
          </button>
          <button
            className="btn px-1.5"
            title="Redo (⇧⌘/Ctrl+Shift+Z)"
            disabled={!project.future.length}
            onClick={redo}
          >
            <Redo2 size={14} />
          </button>
          <span className="mx-1 h-5 w-px bg-slate-600" />
          <button
            className="btn"
            onClick={() => {
              if (confirmDiscard()) {
                setProject(freshProject());
                setSelectedId(null);
              }
            }}
          >
            <FilePlus2 size={14} /> New
          </button>
          <button className="btn" onClick={() => setShowLoad(true)}>
            <FolderOpen size={14} /> Load Project
          </button>
          <button className="btn btn-primary" disabled={busy === 'save' || !project.name.trim()} onClick={save}>
            {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />} Save to DB
          </button>
          <span className="mx-1 h-5 w-px bg-slate-600" />
          <button className="btn" onClick={() => exportJson(project.name, data)}>
            <FileJson size={14} /> Export JSON
          </button>
          <button className="btn" onClick={() => importRef.current?.click()}>
            <FileUp size={14} /> Import JSON
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
          <button
            className="btn"
            disabled={busy === 'png'}
            onClick={() => run('png', () => exportPng(project.name, data, view === 'elevation' ? wall : null))}
          >
            <Image size={14} /> PNG
          </button>
          <button className="btn" onClick={() => run('print', async () => printPdf(project.name, data))}>
            <Printer size={14} /> Print / PDF
          </button>
        </div>
      </header>

      {/* The 3D view only edits cabinet fronts, so the wall/room settings and the catalog are hidden there. */}
      {view !== '3d' && (
        <WallBar
          data={data}
          onActivate={(id) => {
            setData((d) => ({ ...d, activeWallId: id }), { record: false });
            setSelectedId(null);
          }}
          onAddIsland={() => {
            const island = createIsland(data.room, data.walls);
            setData((d) => ({ ...d, walls: [...d.walls, island], activeWallId: island.id }));
            setSelectedId(null);
          }}
          onRename={(id, name) =>
            setData((d) => ({ ...d, walls: d.walls.map((w) => (w.id === id ? { ...w, name } : w)) }))
          }
          onDelete={(id) => {
            setData((d) => {
              const walls = d.walls.filter((w) => w.id !== id);
              return { ...d, walls, activeWallId: d.activeWallId === id ? walls[0].id : d.activeWallId };
            });
            setSelectedId(null);
          }}
          onRemoveWall={(id) => {
            setData((d) => {
              const walls = d.walls.map((w) => (w.id === id ? { ...w, removed: true, items: [] } : w));
              const fallback = walls.find((w) => !w.removed)!.id;
              return { ...d, walls, activeWallId: d.activeWallId === id ? fallback : d.activeWallId };
            });
            setSelectedId(null);
          }}
          onRestoreWall={(id) =>
            setData((d) => ({
              ...d,
              walls: d.walls.map((w) => (w.id === id ? { ...w, removed: false } : w)),
              activeWallId: id,
            }))
          }
          onUpdateRoom={updateRoom}
          onUpdateRun={(patch) =>
            updateWall(wall.id, (w) => ({ ...w, ...patch }), `run:${wall.id}:${Object.keys(patch).join(',')}`)
          }
        />
      )}

      <div className="flex min-h-0 flex-1">
        {view !== '3d' && <Palette onAdd={addItem} />}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="absolute left-3 top-3 z-10 flex rounded border border-slate-300 bg-white p-0.5 shadow-sm">
            {VIEWS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium ${view === id ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                onClick={() => setView(id)}
              >
                <Icon size={13} /> {id === 'elevation' ? `${label} · ${wall.name}` : label}
              </button>
            ))}
          </div>
          {view === '3d' && (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading 3D view…</div>
              }
            >
              <Scene3D
                data={data}
                selectedId={selectedId}
                onPick={(runId, itemId) => {
                  const item = data.walls.find((w) => w.id === runId)?.items.find((i) => i.id === itemId);
                  if (runId && item && (item.category === 'base_cabinet' || item.category === 'upper_cabinet'))
                    selectInPlan(runId, item.id);
                  else setSelectedId(null);
                }}
              />
            </Suspense>
          )}
          {(view === 'plan' || view === 'split') && (
            <div className={view === 'split' ? 'min-h-0 flex-1 border-b border-slate-300' : 'min-h-0 flex-1'}>
              <PlanCanvas
                data={data}
                selectedId={selectedId}
                onSelect={selectInPlan}
                onActivate={(id) => selectInPlan(id, null)}
                onMoveItem={(id, pos) => updateItem(id, pos)}
                onMoveIsland={(id, pos) => updateWall(id, (w) => ({ ...w, ...pos }), `run:${id}:planX,planY`)}
              />
            </div>
          )}
          {(view === 'elevation' || view === 'split') && (
            <div className="min-h-0 flex-1">
              <Canvas
                wall={wall}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onMoveItem={(id, pos) => updateItem(id, pos)}
              />
            </div>
          )}
        </main>
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-300 bg-white">
          {view === '3d' ? (
            <FrontsPanel
              item={
                selected && (selected.category === 'base_cabinet' || selected.category === 'upper_cabinet')
                  ? selected
                  : null
              }
              onChange={(patch) => selected && updateItem(selected.id, patch)}
            />
          ) : selected ? (
            <Inspector
              key={selected.id}
              wall={wall}
              walls={data.walls}
              item={selected}
              onChange={(patch) => updateItem(selected.id, patch)}
              onMoveToWall={(target) => moveItemToWall(selected.id, target)}
              onDuplicate={() => duplicateItem(selected)}
              onDelete={() => deleteItem(selected.id)}
            />
          ) : (
            <WallOverview wall={wall} onSelect={setSelectedId} />
          )}
        </aside>
      </div>

      {showLoad && (
        <LoadModal
          currentId={project.id}
          onOpen={open}
          onClose={() => setShowLoad(false)}
          onDeleted={(id) => id === project.id && setProject((p) => ({ ...p, id: null, savedAt: null, dirty: true }))}
        />
      )}
      {toast && (
        <div
          className={`fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded px-4 py-2 text-sm text-white shadow-lg ${toast.kind === 'ok' ? 'bg-emerald-600' : 'bg-red-600'}`}
        >
          {toast.kind === 'ok' ? <FileDown size={14} /> : <AlertTriangle size={14} />}
          {toast.text}
        </div>
      )}
    </div>
  );
}
