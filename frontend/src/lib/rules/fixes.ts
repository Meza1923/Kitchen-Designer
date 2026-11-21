/**
 * One-click fixes that add fillers (FEATURES.md #4/#5): place a filler, shift the neighbouring units along the run,
 * and when the run is full narrow the nearest regular cabinet to make room. A fix returns the new project, or a sentence explaining why it can't be applied.
 */
import type { KitchenItem, ProjectData, WallRun } from '../../types';
import { createItem } from '../defaults';
import { countersOnUnits, fmt, isRunDivider, layerOf, normalizeWall } from '../geometry';
import type { End } from './core';
import { runName, t } from '../i18n';

const right = (i: KitchenItem) => i.x + i.width;
const isFloor = (i: KitchenItem) => layerOf(i.category) === 'floor' && i.depth > 0;

const riders = countersOnUnits;

const replaceRun = (data: ProjectData, run: WallRun): ProjectData => ({
  ...data,
  walls: data.walls.map((w) => (w.id === run.id ? normalizeWall(run) : w)),
});

/** The stretch of a run around [x0, x1] between partition joints (or the run's ends). */
function stretchAround(run: WallRun, x0: number, x1: number): [number, number] {
  // Partition joints and floor-standing columns (review finding R16) split the run.
  const joints = run.items.filter(isRunDivider);
  const lo = Math.max(0, ...joints.filter((j) => right(j) <= x0 + 0.5).map(right));
  const hi = Math.min(run.widthCm, ...joints.filter((j) => j.x >= x1 - 0.5).map((j) => j.x));
  return [lo, hi];
}

/**
 * Move floor units (and what stands on them) so nothing overlaps [x0, x1]; pushes towards `away`.
 * Returns the shortfall (cm) instead when the units would be pushed past the end of the run.
 */
function pushClear(run: WallRun, x0: number, x1: number, away: End): WallRun | number {
  const ride = riders(run);
  const shift = new Map<string, number>();
  // Partition joints (#10) split the run: units are only pushed within the stretch between them.
  const [lo, hi] = stretchAround(run, x0, x1);
  const units = run.items.filter((u) => isFloor(u) && u.x >= lo - 0.5 && right(u) <= hi + 0.5);
  if (away === 'end') {
    let cursor = x1;
    for (const u of units.filter((u) => right(u) > x0 + 0.5).sort((a, b) => a.x - b.x)) {
      const d = Math.max(0, cursor - u.x);
      if (d > 0) shift.set(u.id, d);
      cursor = Math.max(cursor, right(u) + d);
    }
    if (cursor > hi + 0.05) return cursor - hi;
  } else {
    let cursor = x0;
    for (const u of units.filter((u) => u.x < x1 - 0.5).sort((a, b) => right(b) - right(a))) {
      const d = Math.min(0, cursor - right(u));
      if (d < 0) shift.set(u.id, d);
      cursor = Math.min(cursor, u.x + d);
    }
    if (cursor < lo - 0.05) return lo - cursor;
  }
  for (const [host, ids] of ride) for (const id of ids) if (shift.has(host)) shift.set(id, shift.get(host)!);
  return { ...run, items: run.items.map((i) => (shift.has(i.id) ? { ...i, x: i.x + shift.get(i.id)! } : i)) };
}

const MIN_CABINET = 30;

/** Cabinets whose width can change: plain base / tall cabinets (not towers housing an appliance). */
const resizable = (i: KitchenItem) =>
  i.category === 'base_cabinet' ||
  (i.category === 'tall_cabinet' && !(i.tallZones ?? []).some((z) => ['oven', 'microwave', 'coffee'].includes(z.type)));

/**
 * Narrow the cabinet nearest to `from` on the `away` side by `by` cm (keeping its edge nearest `from`), preferring
 * one without a sink or cooktop on it. Returns null when no cabinet can give up that much.
 */
function narrowNearest(run: WallRun, from: number, by: number, away: End): WallRun | null {
  const ride = riders(run);
  // Only cabinets in the same stretch: never one on the other side of a partition wall (review finding R12).
  const [lo, hi] = stretchAround(run, from, from);
  const candidates = run.items
    .filter((i) => resizable(i) && i.width - by >= MIN_CABINET)
    .filter((i) => i.x >= lo - 0.5 && right(i) <= hi + 0.5)
    .filter((i) => (away === 'end' ? right(i) > from : i.x < from))
    .sort(
      (a, b) =>
        Number(ride.has(a.id)) - Number(ride.has(b.id)) ||
        Math.abs(a.x + a.width / 2 - from) - Math.abs(b.x + b.width / 2 - from),
    );
  const target = candidates[0];
  if (!target) return null;
  return {
    ...run,
    items: run.items.map((i) =>
      i.id === target.id ? { ...i, width: i.width - by, x: away === 'end' ? i.x : i.x + by } : i,
    ),
  };
}

/**
 * Add a filler of `width` against `edge` (a wall or the fronts of a corner run), on the side facing `away`, and push
 * the units beyond it. When the run is full, the nearest regular cabinet is narrowed by the missing cm.
 * Smaller fillers already in that spot are replaced.
 */
export function insertFiller(
  data: ProjectData,
  runId: string,
  edge: number,
  width: number,
  away: End,
  /** The unit the filler serves: it takes its height, depth and plinth (a fridge gets a full-height filler). */
  serves?: KitchenItem,
): ProjectData | string {
  const run = data.walls.find((w) => w.id === runId);
  if (!run) return t('that run no longer exists');
  const [x0, x1] = away === 'end' ? [edge, edge + width] : [edge - width, edge];
  const kept = {
    ...run,
    items: run.items.filter((i) => !(i.category === 'filler' && i.x >= x0 - 0.5 && right(i) <= x1 + 0.5)),
  };
  let pushed = pushClear(kept, x0, x1, away);
  if (typeof pushed === 'number') {
    const shortfall = Math.ceil(pushed * 10) / 10;
    const narrowed = narrowNearest(kept, edge, shortfall, away);
    if (!narrowed) {
      return t(
        'not enough room on {run}: it needs {shortfall} cm more, and no cabinet there can be narrowed that much (minimum {MIN_CABINET} cm; appliances are never resized)',
        { run: runName(run.name), shortfall: fmt(shortfall), MIN_CABINET },
      );
    }
    pushed = pushClear(narrowed, x0, x1, away);
    if (typeof pushed === 'number')
      return t('not enough room on {run}: it needs {pushed} cm more', { run: runName(run.name), pushed: fmt(pushed) });
  }
  const filler: KitchenItem = {
    ...createItem('filler'),
    x: x0,
    width,
    ...(serves && {
      height: serves.height,
      depth: serves.depth,
      hasToeKick: serves.hasToeKick,
      toeKickHeight: serves.toeKickHeight,
    }),
  };
  return replaceRun(data, { ...pushed, items: [...pushed.items, filler] });
}

/**
 * Make `needed` cm at the end of a full run for a scribe filler: narrow its widest cabinet, slide the units after it
 * back, and put the filler against the end wall.
 */
export function addScribeFiller(
  data: ProjectData,
  runId: string,
  needed: number,
  /** The stretch of the run that is full (default: the whole run). */
  [lo, hi]: [number, number] = [0, Infinity],
): ProjectData | string {
  const run = data.walls.find((w) => w.id === runId);
  if (!run) return t('that run no longer exists');
  const end = Math.min(hi, run.widthCm);
  const inStretch = (i: KitchenItem) => i.x >= lo - 0.5 && right(i) <= end + 0.5;
  const target = run.items
    .filter((i) => inStretch(i) && resizable(i) && i.width - needed >= MIN_CABINET)
    .sort((a, b) => b.width - a.width)[0];
  if (!target)
    return t("no cabinet on {run} can be narrowed by {needed} cm (they'd drop below {MIN_CABINET} cm)", {
      run: runName(run.name),
      needed: fmt(needed),
      MIN_CABINET,
    });
  const ride = riders(run);
  const moved = new Set(
    run.items
      .filter((i) => isFloor(i) && inStretch(i) && i.x > target.x + 0.5)
      .flatMap((u) => [u.id, ...(ride.get(u.id) ?? [])]),
  );
  const items = run.items.map((i) =>
    i.id === target.id ? { ...i, width: i.width - needed } : moved.has(i.id) ? { ...i, x: i.x - needed } : i,
  );
  const filler: KitchenItem = { ...createItem('filler'), x: end - needed, width: needed };
  return replaceRun(data, { ...run, items: [...items, filler] });
}
