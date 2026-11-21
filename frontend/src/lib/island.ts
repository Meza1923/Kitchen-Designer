/**
 * Islands (FEATURES.md #15): side A is the island itself (its countertop and its front); the back and the two ends
 * are island runs derived from it (lib/plan.ts → syncIslandSides), created the first time something goes on them.
 */
import type { IslandFace, KitchenItem, ProjectData, WallRun } from '../types';
import { createItem, uid } from './defaults';
import { COUNTER_LIP_CM, islandSideOf, STOOL_SEAT_CM, syncIslandSides } from './plan';

/** Name suffix of each side (translated for display by `runName`). */
export const SIDE_NAMES: Record<IslandFace, string> = { a: 'Front', b: 'Back', left: 'Left end', right: 'Right end' };

/** The island with side `face` present (created empty when missing), and that side. */
export function ensureIslandSide(
  data: ProjectData,
  islandId: string,
  face: IslandFace,
): { data: ProjectData; side: WallRun } | null {
  const island = data.walls.find((w) => w.id === islandId && w.kind === 'island');
  if (!island) return null;
  const existing = islandSideOf(data, island, face);
  if (existing) return { data, side: existing };
  const side: WallRun = {
    id: uid(),
    name: `${island.name} · ${SIDE_NAMES[face]}`,
    kind: 'island',
    face,
    hostId: island.id,
    widthCm: island.widthCm,
    heightCm: island.heightCm,
    countertopThicknessCm: island.countertopThicknessCm,
    items: [],
  };
  // Right after its island (and its other sides) in the run list.
  const last = Math.max(...data.walls.map((w, k) => (w.id === island.id || w.hostId === island.id ? k : -1)));
  const walls = [...data.walls.slice(0, last + 1), side, ...data.walls.slice(last + 1)];
  const next = syncIslandSides({ ...data, walls });
  return { data: next, side: next.walls.find((w) => w.id === side.id)! };
}

/** Ready layouts a new island can start from (#15). */
export type IslandLayout = 'cabinets' | 'seating' | 'both' | 'waterfall';
export const LAYOUTS: { id: IslandLayout; label: string; hint: string }[] = [
  { id: 'cabinets', label: 'Cabinets only', hint: 'A row of base cabinets under a countertop.' },
  {
    id: 'seating',
    label: 'Cabinets + seating',
    hint: 'Cabinets at the front, chairs at the back under a 30 cm overhang.',
  },
  { id: 'both', label: 'Cabinets on both sides', hint: 'Cabinets back to back, one countertop over both.' },
  {
    id: 'waterfall',
    label: 'Seating + waterfall ends',
    hint: 'A deeper overhang for chairs, held up by waterfall ends.',
  },
];

/** Island `islandId` rebuilt from a layout: its depth, cabinets, chairs and ends (its length and place stay). */
export function applyIslandLayout(data: ProjectData, islandId: string, layout: IslandLayout): ProjectData {
  const island = data.walls.find((w) => w.id === islandId && w.kind === 'island');
  if (!island) return data;
  const L = island.widthCm;
  const n = Math.max(1, Math.floor(L / 60));
  const row = (): KitchenItem[] =>
    Array.from({ length: n }, (_, k) => ({ ...createItem('base_cabinet'), x: (L - n * 60) / 2 + k * 60 }));
  const chairs = (): KitchenItem[] => {
    const m = Math.max(1, Math.floor((L + 20) / 60));
    const start = (L - (m * 60 - 20)) / 2;
    return Array.from({ length: m }, (_, k) => ({
      ...createItem('stool'),
      stoolType: 'bar' as const,
      height: STOOL_SEAT_CM.bar,
      x: start + k * 60,
    }));
  };
  const cab = 60 + COUNTER_LIP_CM;
  const plan: Record<IslandLayout, { depth: number; back: 'none' | 'cabinets' | 'chairs'; ends?: 'waterfall' }> = {
    cabinets: { depth: cab, back: 'none' },
    seating: { depth: cab + 30, back: 'chairs' },
    both: { depth: 2 * cab, back: 'cabinets' },
    waterfall: { depth: cab + 40, back: 'chairs', ends: 'waterfall' },
  };
  const p = plan[layout];
  // Start clean: this island's other sides go, then the layout's back side is added.
  let next: ProjectData = {
    ...data,
    walls: data.walls
      .filter((w) => w.hostId !== islandId || w.kind !== 'island')
      .map((w) =>
        w.id === islandId ? { ...w, depthCm: p.depth, items: row(), leftProfile: p.ends, rightProfile: p.ends } : w,
      ),
  };
  if (p.back !== 'none') {
    const ens = ensureIslandSide(next, islandId, 'b')!;
    const items = p.back === 'chairs' ? chairs() : row();
    next = { ...ens.data, walls: ens.data.walls.map((w) => (w.id === ens.side.id ? { ...w, items } : w)) };
  }
  return syncIslandSides({ ...next, activeWallId: islandId });
}
