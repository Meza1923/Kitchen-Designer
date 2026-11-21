import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Armchair,
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
import type { ElementCategory, IslandFace, KitchenItem, ProjectData, Room, WallRun } from './types';
import { CATEGORY_LABELS, createIsland, createItem, createProjectData, uid } from './lib/defaults';
import {
  clampX,
  computeCountertops,
  findFreeX,
  fmt,
  isJoint,
  isWallOnly,
  layerOf,
  normalizeWall,
  widestGapX,
} from './lib/geometry';
import { api } from './lib/api';
import { migrateProjectData } from './lib/migrate';
import { islandOf, islandDrawing, roomChangeWarnings, STOOL_SEAT_CM, syncIslandSides, syncRoom } from './lib/plan';
import { addPartition, deletePartition, setPartition } from './lib/partition';
import { applyIslandLayout, ensureIslandSide } from './lib/island';
import { IslandPanel } from './components/IslandPanel';
import { presetOutline, type ShapePreset } from './lib/outline';
import { reshapeRoom, resizeWall, addNiche, NICHE_DEFAULT } from './lib/roomShape';
import { exportJson, exportPng, importJson, printPdf, scheduleRows } from './lib/export';
import { applyAllFixes, checkProject, type Violation } from './lib/rules';
import { ProblemsList } from './components/ProblemsList';
import { Canvas } from './components/Canvas';
import { PlanCanvas } from './components/PlanCanvas';
import { Inspector } from './components/Inspector';
import { Palette, type Group } from './components/Palette';
import { WallBar } from './components/WallBar';
import { LoadModal } from './components/LoadModal';
import { FrontsPanel } from './components/FrontsPanel';
import { runName, setLang, t, useLang } from './lib/i18n';

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

function WallOverview({
  wall,
  violations,
  onSelect,
  onSelectProblem,
  onFix,
  onFixAll,
}: {
  wall: WallRun;
  violations: Violation[];
  onSelect: (id: string) => void;
  onSelectProblem: (runId: string, itemId: string) => void;
  onFix: (v: Violation) => void;
  onFixAll: () => void;
}) {
  const rows = scheduleRows(wall);
  const sorted = wall.items.filter((i) => !isJoint(i)).sort((a, b) => a.x - b.x || a.y - b.y);
  return (
    <div className="px-4 py-3">
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-700">
        {t('{run} · Schedule', { run: runName(wall.name) })}
      </h3>
      <ProblemsList violations={violations} onSelect={onSelectProblem} onFix={onFix} onFixAll={onFixAll} />
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">
          {t('No elements yet. Add some from the catalog on the left, then click one to edit it.')}
        </p>
      ) : (
        <table className="w-full text-left font-mono text-[11px]">
          <thead className="text-slate-400">
            <tr>
              <th className="py-1">#</th>
              <th>{t('Element')}</th>
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
                  {t(r.type)}
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
  const lang = useLang(); // re-render everything when the language changes
  const [project, setProject] = useState<ProjectState>(freshProject);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showLoad, setShowLoad] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [view, setView] = useState<View>('plan');
  const importRef = useRef<HTMLInputElement>(null);

  const { data } = project;
  const activeRun = data.walls.find((w) => w.id === data.activeWallId) ?? data.walls[0];
  // An island side being worked on is the active run; the tab bar shows its island (review finding R18).
  const wall = activeRun;
  // The selected element and the run it is on, wherever that is (plan, any island side, the designer).
  const selectedRun = selectedId ? data.walls.find((w) => w.items.some((i) => i.id === selectedId)) : undefined;
  const selected = selectedRun?.items.find((i) => i.id === selectedId) ?? null;
  // Messages are written in the current language, so they're rebuilt when it changes.
  const violations = useMemo(() => {
    void lang;
    return checkProject(data);
  }, [data, lang]);

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
      // Side B of a two-sided island always follows its island (#9), whatever the edit was.
      data: syncIslandSides(fn(p.data)),
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

  /**
   * Room size changes are applied on Enter / leaving the field. When the new size makes elements overlap or leaves an
   * island outside the room, the user confirms first; cancelling keeps the old size.
   */
  const updateRoom = (patch: Partial<Room>) =>
    applyRoomChange(syncRoom({ ...data, room: { ...data.room, ...patch } }), `room:${Object.keys(patch).join(',')}`);

  /** Apply a room change, confirming first when it removes cabinets, makes elements overlap or pushes an island out. */
  const applyRoomChange = (next: ProjectData, key: string, losses: string[] = []): boolean => {
    const warnings = [...losses, ...roomChangeWarnings(data, next)];
    if (
      warnings.length &&
      !confirm(`${warnings.join('\n')}\n\n${t('Apply the change anyway? (Undo brings it back.)')}`)
    )
      return false;
    setData(() => next, { key });
    return true;
  };

  const setRoomShape = (preset: ShapePreset) => {
    const { data: next, dropped } = reshapeRoom(data, presetOutline(preset, data.room.widthCm, data.room.depthCm));
    const losses = dropped.flatMap((w) => {
      const n = w.items.filter((i) => !isJoint(i)).length;
      if (w.kind === 'partition') return [`${w.name} (partition) is removed${n ? ` with its ${n} element(s)` : ''}.`];
      return n ? [`${w.name} is removed together with its ${n} element(s).`] : [];
    });
    if (applyRoomChange(next, 'room:shape', losses)) setSelectedId(null);
  };

  const updatePartition = (id: string, change: { hostX?: number; length?: number }) =>
    setData((d) => setPartition(d, id, change), { key: `partition:${id}:${Object.keys(change).join(',')}` });

  const resizeRoomWall = (wallId: string, lengthCm: number) => {
    const next = resizeWall(data, wallId, lengthCm);
    const name = data.walls.find((w) => w.id === wallId)?.name ?? 'This wall';
    if (typeof next === 'string')
      notify(
        'error',
        t("Can't make {wall} {cm} cm: {reason}.", { wall: runName(name), cm: fmt(lengthCm), reason: t(next) }),
      );
    else applyRoomChange(next, `room:wall:${wallId}`);
  };

  /** Free spot for a new element; when there is none, the widest gap, with a message saying it overlaps. */
  const placeOnWall = (run: WallRun, item: KitchenItem) => {
    const free = findFreeX(run, item);
    if (free !== null) return free;
    const x = widestGapX(run, item);
    const name = CATEGORY_LABELS[item.category];
    notify(
      'error',
      layerOf(item.category) === 'counter' && computeCountertops(run).length === 0
        ? t(
            'There is no countertop on {run} for the {name}: add base cabinets first. It was placed at X {x} for now.',
            { run: runName(run.name), name: t(name), x: fmt(x) },
          )
        : layerOf(item.category) === 'counter'
          ? t(
              'No free {w} cm of countertop on {run} for the {name}: it was placed at X {x}, over other items or past the countertop. Move it, or make room.',
              { w: fmt(item.width), run: runName(run.name), name: t(name), x: fmt(x) },
            )
          : t(
              'No free {w} cm space on {run} for the {name}: it was placed over other elements at X {x}. Move or narrow it, or make room.',
              { w: fmt(item.width), run: runName(run.name), name: t(name), x: fmt(x) },
            ),
    );
    return x;
  };

  const applyFix = (v: Violation) => {
    const result = v.fix!.apply(data);
    if (typeof result === 'string') notify('error', t("Can't add the filler: {reason}.", { reason: t(result) }));
    else setData(() => result);
  };

  const applyFixes = () => {
    const { data: next, applied, failed } = applyAllFixes(data);
    if (applied) setData(() => next);
    if (failed.length)
      notify(
        'error',
        t("Added {n} filler(s); {m} couldn't be added: {list}", {
          n: applied,
          m: failed.length,
          list: failed.join(' '),
        }),
      );
    else notify('ok', applied ? t('Added {n} filler(s).', { n: applied }) : t('No fillers needed.'));
  };

  const selectInPlan = (runId: string, itemId: string | null) => {
    if (runId !== data.activeWallId) setData((d) => ({ ...d, activeWallId: runId }), { record: false });
    setSelectedId(itemId);
  };

  // Islands (#15): edited in the plan. The active run is the island side being worked on.
  const activeIsland = islandOf(data, activeRun);
  const activeFace: IslandFace = activeRun.face && activeRun.kind === 'island' ? activeRun.face : 'a';

  /** Work on side `face` of the active island: it becomes the active run (created when new). */
  const workOnIslandSide = (face: IslandFace) => {
    if (!activeIsland) return;
    const ens = ensureIslandSide(data, activeIsland.id, face);
    if (!ens) return;
    setData(() => ({ ...ens.data, activeWallId: ens.side.id }), { record: ens.data !== data ? undefined : false });
    setSelectedId(null);
  };

  /** Select an island to work on: its front, with the plan and the elevation of the side on one screen. */
  const selectIsland = (id: string) => {
    setData((d) => ({ ...d, activeWallId: id }), { record: false });
    setSelectedId(null);
    if (view === 'plan' || view === 'elevation') setView('split');
  };

  const addChair = (type: 'bar' | 'counter') => addItem('stool', { stoolType: type, height: STOOL_SEAT_CM[type] });

  const CHAIRS: Group = {
    title: 'Chairs',
    items: [
      {
        category: 'stool',
        icon: Armchair,
        label: 'Bar stool',
        dims: 'seat 75 · islands',
        overrides: { stoolType: 'bar', height: STOOL_SEAT_CM.bar },
      },
      {
        category: 'stool',
        icon: Armchair,
        label: 'Counter stool',
        dims: 'seat 65 · islands',
        overrides: { stoolType: 'counter', height: STOOL_SEAT_CM.counter },
      },
    ],
  };

  const addItem = (category: ElementCategory, overrides: Partial<KitchenItem> = {}) => {
    if (category === 'stool' && wall.kind !== 'island') {
      notify('error', t('Chairs go at an island: select an island first.'));
      return;
    }
    if (isWallOnly(category) && wall.kind === 'island') {
      notify(
        'error',
        t('Doors, windows, sockets, open wall shelves and columns go on a wall: select a wall tab first.'),
      );
      return;
    }
    const item = { ...createItem(category), ...overrides };
    if (category === 'column') item.height = wall.heightCm; // floor to ceiling
    item.x = placeOnWall(wall, item);
    updateWall(wall.id, (w) => ({ ...w, items: [...w.items, item] }));
    setSelectedId(item.id);
  };

  const duplicateItem = (item: KitchenItem) => {
    const copy: KitchenItem = { ...structuredClone(item), id: uid() };
    copy.tallZones = copy.tallZones?.map((z) => ({ ...z, id: uid() }));
    const run = data.walls.find((w) => w.items.some((i) => i.id === item.id)) ?? wall;
    const besideRight = item.x + item.width;
    copy.x = besideRight + item.width <= run.widthCm ? besideRight : placeOnWall(run, copy);
    updateWall(run.id, (w) => ({ ...w, items: [...w.items, copy] }));
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
          updateItem(selected.id, {
            x: clampX(selectedRun ?? wall, selected, selected.x + (e.key === 'ArrowLeft' ? -step : step)),
          });
        } else if (layerOf(selected.category) === 'upper') {
          updateItem(selected.id, { y: selected.y + (e.key === 'ArrowUp' ? step : -step) });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, selectedRun, wall, view, deleteItem, updateItem, undo, redo]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (project.dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [project.dirty]);

  const confirmDiscard = () => !project.dirty || confirm(t('Discard unsaved changes to the current project?'));

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      notify('error', t((e as Error).message || String(e)));
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run('save', async () => {
      const rec = project.id ? await api.update(project.id, project.name, data) : await api.create(project.name, data);
      setProject((p) => ({ ...p, id: rec.id, savedAt: rec.updated_at, dirty: false }));
      notify('ok', t('Saved "{name}"', { name: rec.name }));
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
      notify('ok', t('Imported "{name}" — save to store it in the database', { name }));
    } catch (e) {
      notify('error', t('Import failed: {reason}', { reason: (e as Error).message }));
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Project / save / export bar */}
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-700 bg-slate-800 px-3 py-2 text-slate-100">
        <div className="mr-2 flex items-center gap-2">
          <Ruler size={18} className="text-sky-300" />
          <span className="text-sm font-semibold tracking-wide">{t('KITCHEN DESIGNER')}</span>
          <button
            className="ml-1 rounded border border-slate-600 px-1.5 py-0.5 text-[11px] text-slate-200 hover:bg-slate-700"
            title={lang === 'he' ? 'Switch to English' : 'החלפה לעברית'}
            onClick={() => setLang(lang === 'he' ? 'en' : 'he')}
          >
            {lang === 'he' ? 'English' : 'עברית'}
          </button>
        </div>
        <input
          className="w-56 rounded border border-slate-600 bg-slate-700 px-2 py-1 text-sm text-white focus:border-sky-400 focus:outline-none"
          value={project.name}
          onChange={(e) => setProject((p) => ({ ...p, name: e.target.value, dirty: true }))}
          placeholder={t('Project name')}
        />
        <span className="font-mono text-[11px] text-slate-400">
          {project.dirty
            ? t('● unsaved changes')
            : project.savedAt
              ? t('saved {when}', {
                  when: new Date(project.savedAt).toLocaleString(lang === 'he' ? 'he-IL' : undefined),
                })
              : t('not saved')}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button className="btn px-1.5" title={t('Undo (⌘/Ctrl+Z)')} disabled={!project.past.length} onClick={undo}>
            <Undo2 size={14} />
          </button>
          <button
            className="btn px-1.5"
            title={t('Redo (⇧⌘/Ctrl+Shift+Z)')}
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
            <FilePlus2 size={14} /> {t('New')}
          </button>
          <button className="btn" onClick={() => setShowLoad(true)}>
            <FolderOpen size={14} /> {t('Load Project')}
          </button>
          <button className="btn btn-primary" disabled={busy === 'save' || !project.name.trim()} onClick={save}>
            {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}{' '}
            {t('Save to DB')}
          </button>
          <span className="mx-1 h-5 w-px bg-slate-600" />
          <button className="btn" onClick={() => exportJson(project.name, data)}>
            <FileJson size={14} /> {t('Export JSON')}
          </button>
          <button className="btn" onClick={() => importRef.current?.click()}>
            <FileUp size={14} /> {t('Import JSON')}
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
            <Printer size={14} /> {t('Print / PDF')}
          </button>
        </div>
      </header>

      {/* The 3D view only edits cabinet fronts, so the wall/room settings and the catalog are hidden there. */}
      {view !== '3d' && (
        <WallBar
          data={data}
          onActivate={(id) => {
            // Choosing an island shows it on one screen: plan, the side's elevation and the island panel (#15).
            if (data.walls.find((w) => w.id === id)?.kind === 'island') return selectIsland(id);
            setData((d) => ({ ...d, activeWallId: id }), { record: false });
            setSelectedId(null);
          }}
          onAddIsland={() => {
            const island = createIsland(data.room, data.walls);
            setData((d) => ({ ...d, walls: [...d.walls, island], activeWallId: island.id }));
            setSelectedId(null);
            if (view === 'plan' || view === 'elevation') setView('split');
          }}
          onRename={(id, name) =>
            setData((d) => ({ ...d, walls: d.walls.map((w) => (w.id === id ? { ...w, name } : w)) }))
          }
          onDelete={(id) => {
            setData((d) => {
              // An island goes with its side B; the active tab falls back to a run that is still there and not an
              // open side (review finding R15).
              const walls = d.walls.filter((w) => w.id !== id && w.hostId !== id);
              const fallback = (walls.find((w) => !w.removed) ?? walls[0]).id;
              const activeWallId = walls.some((w) => w.id === d.activeWallId) ? d.activeWallId : fallback;
              return { ...d, walls, activeWallId };
            });
            setSelectedId(null);
          }}
          onRemoveWall={(id) => {
            setData((d) => {
              const walls = d.walls.map((w) => (w.id === id ? { ...w, removed: true, items: [] } : w));
              const fallback = walls.find((w) => !w.removed)!.id;
              // syncRoom drops the partitions that stood on it.
              return syncRoom({ ...d, walls, activeWallId: d.activeWallId === id ? fallback : d.activeWallId });
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
          onUpdateRun={(patch) => {
            // The settings bar shows the island while one of its sides is worked on: edit the island (review R21).
            const target = activeIsland ?? wall;
            updateWall(target.id, (w) => ({ ...w, ...patch }), `run:${target.id}:${Object.keys(patch).join(',')}`);
          }}
          onSetShape={setRoomShape}
          onResizeWall={resizeRoomWall}
          onAddPartition={() => {
            const next = addPartition(data, data.activeWallId);
            if (typeof next === 'string') notify('error', t(next));
            else setData(() => next);
            setSelectedId(null);
          }}
          onUpdatePartition={updatePartition}
          onAddNiche={() => {
            const width = Math.min(NICHE_DEFAULT.width, wall.widthCm - 20);
            const next = addNiche(data, wall.id, Math.round((wall.widthCm - width) / 2), width, NICHE_DEFAULT.depth);
            if (typeof next === 'string')
              notify(
                'error',
                t("Can't add a niche to {wall}: {reason}.", { wall: runName(wall.name), reason: t(next) }),
              );
            else applyRoomChange(next, 'room:niche');
            setSelectedId(null);
          }}
          onDeletePartition={(id) => {
            setData((d) => deletePartition(d, id));
            setSelectedId(null);
          }}
        />
      )}

      <div className="flex min-h-0 flex-1">
        {view !== '3d' && <Palette onAdd={addItem} extra={[CHAIRS]} />}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="absolute left-3 top-3 z-10 flex rounded border border-slate-300 bg-white p-0.5 shadow-sm">
            {VIEWS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium ${view === id ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                onClick={() => setView(id)}
              >
                <Icon size={13} /> {id === 'elevation' ? `${t(label)} · ${runName(wall.name)}` : t(label)}
              </button>
            ))}
          </div>
          {view === '3d' && (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                  {t('Loading 3D view…')}
                </div>
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
                onActivate={(id) => {
                  // Grabbing an island keeps the side being worked on, and shows it on one screen (review R21).
                  if (data.walls.find((w) => w.id === id)?.kind === 'island') {
                    if (activeIsland?.id !== id) selectIsland(id);
                    else if (view === 'plan') setView('split');
                    setSelectedId(null);
                  } else selectInPlan(id, null);
                }}
                onMoveItem={(id, pos) => updateItem(id, pos)}
                onMoveIsland={(id, pos) => updateWall(id, (w) => ({ ...w, ...pos }), `run:${id}:planX,planY`)}
                onDragWall={(next) => setData(() => next, { key: 'room:wall-drag' })}
                onUpdatePartition={updatePartition}
                violations={violations}
              />
            </div>
          )}
          {(view === 'elevation' || view === 'split') && (
            <div className="min-h-0 flex-1">
              <Canvas
                wall={wall}
                {...islandDrawing(data, wall)}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onMoveItem={(id, pos) => updateItem(id, pos)}
                violations={violations}
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
              wall={selectedRun ?? wall}
              walls={data.walls}
              room={data.room}
              item={selected}
              onChange={(patch) => updateItem(selected.id, patch)}
              onMoveToWall={(target) => moveItemToWall(selected.id, target)}
              onDuplicate={() => duplicateItem(selected)}
              onDelete={() => deleteItem(selected.id)}
              problems={violations.filter((v) => v.items.some((r) => r.itemId === selected.id))}
              onFix={applyFix}
            />
          ) : (
            <>
              {activeIsland && (
                <IslandPanel
                  data={data}
                  island={activeIsland}
                  face={activeFace}
                  onFace={workOnIslandSide}
                  onUpdateIsland={(patch) =>
                    updateWall(
                      activeIsland.id,
                      (w) => ({ ...w, ...patch }),
                      `run:${activeIsland.id}:${Object.keys(patch).join(',')}`,
                    )
                  }
                  onLayout={(layout) => setData((d) => applyIslandLayout(d, activeIsland.id, layout))}
                  onAddChair={addChair}
                />
              )}
              <WallOverview
                wall={wall}
                violations={violations}
                onSelect={setSelectedId}
                onSelectProblem={selectInPlan}
                onFix={applyFix}
                onFixAll={applyFixes}
              />
            </>
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
