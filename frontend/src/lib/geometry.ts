import type { ElementCategory, KitchenItem, WallRun } from '../types';
import { DEFAULT_BASE_HEIGHT } from './defaults';

export type Layer = 'floor' | 'upper' | 'counter' | 'electrical';

export const SNAP_DISTANCE_CM = 3;
export const GAP_WARNING_CM = 10;
/** Gaps narrower than this are treated as flush (gap = 0). */
export const FLUSH_EPS_CM = 0.1;

const FLOOR: ElementCategory[] = [
  'base_cabinet',
  'tall_cabinet',
  'corner_blocker',
  'fridge',
  'washing_machine',
  'under_counter_oven',
];
/**
 * Upper layer: wall cabinets and wall openings. A door is an opening from the floor up, so through
 * the vertical-overlap rule it collides with base units, upper cabinets and windows in front of / above it.
 */
const UPPER: ElementCategory[] = ['upper_cabinet', 'window', 'door'];
/** Wall sockets: their own layer, so they never collide with cabinets (a socket behind a base unit is fine). */
const ELECTRICAL: ElementCategory[] = ['socket', 'power_socket'];

/** Floor items that carry a countertop slab. */
export const COUNTER_BEARING: ElementCategory[] = ['base_cabinet', 'under_counter_oven', 'corner_blocker'];

export const layerOf = (c: ElementCategory): Layer =>
  FLOOR.includes(c) ? 'floor' : UPPER.includes(c) ? 'upper' : ELECTRICAL.includes(c) ? 'electrical' : 'counter';

export const isElectrical = (c: ElementCategory) => ELECTRICAL.includes(c);

export const isCounterBearing = (c: ElementCategory) => COUNTER_BEARING.includes(c);
/** A counter-bearing unit that actually gets a countertop slab (the user can switch it off per unit). */
export const carriesCountertop = (i: KitchenItem) => isCounterBearing(i.category) && !i.noCountertop;
export const hasCabinetFronts = (c: ElementCategory) => c === 'base_cabinet' || c === 'upper_cabinet';
export const hasToeKickOption = (c: ElementCategory) =>
  ['base_cabinet', 'tall_cabinet', 'corner_blocker', 'under_counter_oven', 'upper_cabinet'].includes(c);
export const canMoveVertically = (c: ElementCategory) => (layerOf(c) === 'upper' && c !== 'door') || isElectrical(c);
/** Openings live in the wall itself (no depth into the room); only walls can hold them. */
export const isOpening = (c: ElementCategory) => c === 'window' || c === 'door';
/** Items fixed in or on a wall (openings and sockets): walls only, never islands. */
export const isWallMounted = (c: ElementCategory) => isOpening(c) || isElectrical(c);

export const round1 = (v: number) => Math.round(v * 10) / 10;
export const fmt = (v: number) => (Number.isInteger(round1(v)) ? String(round1(v)) : round1(v).toFixed(1));

/**
 * Convert a cm coordinate (Y measured up from the floor) to an SVG Y (measured down from the ceiling).
 * Returns the SVG Y of the item's TOP edge.
 */
export const toScreenY = (wallHeightCm: number, itemYCm: number, itemHeightCm: number, scale: number) =>
  wallHeightCm * scale - (itemYCm + itemHeightCm) * scale;

const overlaps1d = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 - FLUSH_EPS_CM && b0 < a1 - FLUSH_EPS_CM;

const right = (i: KitchenItem) => i.x + i.width;
const top = (i: KitchenItem) => i.y + i.height;

export const itemsInLayer = (wall: WallRun, layer: Layer) => wall.items.filter((i) => layerOf(i.category) === layer);

/** Top of the countertop-bearing unit under the item's centre (where sinks and cooktops sit). */
export function counterBaseTop(wall: WallRun, item: KitchenItem): number {
  const cx = item.x + item.width / 2;
  const under = wall.items.filter((i) => isCounterBearing(i.category) && i.x <= cx && right(i) >= cx);
  return under.length ? Math.max(...under.map(top)) : DEFAULT_BASE_HEIGHT;
}

/** Re-derive constrained values: counter items ride on the countertop, everything stays inside the wall. */
export function normalizeWall(wall: WallRun): WallRun {
  return {
    ...wall,
    items: wall.items.map((i) => {
      const layer = layerOf(i.category);
      const x = Math.min(Math.max(0, i.x), Math.max(0, wall.widthCm - i.width));
      let y = i.y;
      if (layer === 'counter') y = counterBaseTop(wall, { ...i, x });
      else if (i.category === 'door') y = 0;
      else if (layer === 'upper' || layer === 'electrical')
        y = Math.min(Math.max(0, i.y), Math.max(0, wall.heightCm - i.height));
      return x === i.x && y === i.y ? i : { ...i, x, y };
    }),
  };
}

export const clampX = (wall: WallRun, item: KitchenItem, x: number) =>
  Math.min(Math.max(0, x), Math.max(0, wall.widthCm - item.width));

export const clampY = (wall: WallRun, item: KitchenItem, y: number) =>
  Math.min(Math.max(0, y), Math.max(0, wall.heightCm - item.height));

/**
 * Whether two items can collide: same layer (upper items must also overlap vertically), or a
 * floor unit (tower, fridge) reaching up into an upper cabinet's / window's height band.
 */
export function canCollide(a: KitchenItem, b: KitchenItem): boolean {
  const la = layerOf(a.category);
  const lb = layerOf(b.category);
  const vertical = overlaps1d(a.y, top(a), b.y, top(b));
  if (la === lb) return la === 'floor' || la === 'counter' || vertical;
  if ((la === 'floor' && lb === 'upper') || (la === 'upper' && lb === 'floor')) return vertical;
  return false;
}

/** Edges an item may magnetically snap to while being dragged. */
function snapEdges(wall: WallRun, item: KitchenItem): number[] {
  const layer = layerOf(item.category);
  const edges = [0, wall.widthCm];
  for (const other of wall.items) {
    if (other.id === item.id) continue;
    const relevant =
      layerOf(other.category) === layer ||
      canCollide(item, other) ||
      (layer === 'counter' && isCounterBearing(other.category));
    if (relevant) edges.push(other.x, right(other));
  }
  return edges;
}

/** Snap the item's left or right edge to the nearest edge within SNAP_DISTANCE_CM, then clamp to the wall. */
export function snapX(wall: WallRun, item: KitchenItem, rawX: number, snapping: boolean): number {
  let x = rawX;
  if (snapping) {
    let best: number | null = null;
    for (const e of snapEdges(wall, item)) {
      for (const d of [e - rawX, e - (rawX + item.width)]) {
        if (Math.abs(d) <= SNAP_DISTANCE_CM && (best === null || Math.abs(d) < Math.abs(best))) best = d;
      }
    }
    x = best === null ? Math.round(rawX) : rawX + best;
  } else {
    x = Math.round(rawX);
  }
  return round1(clampX(wall, item, x));
}

export interface Gap {
  layer: Layer;
  x0: number;
  x1: number;
  width: number;
  y0: number;
  y1: number;
  warning: boolean;
}

function gapVertical(neighbours: KitchenItem[]): [number, number] {
  const y0 = Math.max(...neighbours.map((n) => n.y));
  const y1 = Math.min(...neighbours.map(top));
  if (y1 > y0) return [y0, y1];
  return [neighbours[0].y, top(neighbours[0])];
}

/**
 * Horizontal empty spans between items of one layer and between items and the side walls.
 * The upper layer also counts floor units that reach up into an upper item's height band,
 * but only reports gaps that touch at least one upper item (floor gaps are reported by the floor layer).
 */
export function computeGaps(wall: WallRun, layer: 'floor' | 'upper'): Gap[] {
  const own = itemsInLayer(wall, layer);
  const reaching =
    layer === 'upper' ? itemsInLayer(wall, 'floor').filter((f) => own.some((u) => canCollide(f, u))) : [];
  const items = [...own, ...reaching].sort((a, b) => a.x - b.x);
  if (!own.length) return [];
  const gaps: Gap[] = [];
  const push = (x0: number, x1: number, neighbours: KitchenItem[]) => {
    const width = round1(x1 - x0);
    if (width < FLUSH_EPS_CM) return;
    if (!neighbours.some((n) => layerOf(n.category) === layer)) return;
    const [y0, y1] = gapVertical(neighbours);
    gaps.push({ layer, x0, x1, width, y0, y1, warning: width < GAP_WARNING_CM });
  };
  let cursor = 0;
  let prev: KitchenItem | null = null;
  for (const item of items) {
    if (item.x > cursor) push(cursor, item.x, prev ? [prev, item] : [item]);
    if (right(item) > cursor) {
      cursor = right(item);
      prev = item;
    }
  }
  if (prev && cursor < wall.widthCm) push(cursor, wall.widthCm, [prev]);
  return gaps;
}

export interface Overlap {
  a: string;
  b: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Collisions between items that can collide (see canCollide). */
export function computeOverlaps(wall: WallRun): Overlap[] {
  const result: Overlap[] = [];
  const items = wall.items;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (!canCollide(a, b) || !overlaps1d(a.x, right(a), b.x, right(b))) continue;
      result.push({
        a: a.id,
        b: b.id,
        x0: Math.max(a.x, b.x),
        x1: Math.min(right(a), right(b)),
        y0: Math.max(a.y, b.y),
        y1: Math.min(top(a), top(b)),
      });
    }
  }
  return result;
}

export interface Countertop {
  x: number;
  width: number;
  /** Y of the slab's underside (top of the units below). */
  y: number;
  thickness: number;
}

/**
 * Continuous countertop runs over base cabinets, under-counter ovens and corner blockers (unless switched off
 * per unit, which splits the run). Touching units merge into one slab; washing machines are bridged when flanked
 * by base units.
 */
export function computeCountertops(wall: WallRun): Countertop[] {
  const units = wall.items
    .filter((i) => carriesCountertop(i) || i.category === 'washing_machine')
    .sort((a, b) => a.x - b.x);

  // 1. Contiguous groups (touching or overlapping).
  const groups: KitchenItem[][] = [];
  let groupEnd = -Infinity;
  for (const u of units) {
    if (groups.length && u.x <= groupEnd + FLUSH_EPS_CM) groups[groups.length - 1].push(u);
    else groups.push([u]);
    groupEnd = groups[groups.length - 1].length === 1 ? right(u) : Math.max(groupEnd, right(u));
  }

  const slabs: Countertop[] = [];
  for (const group of groups) {
    // 2. Washers only get a countertop when flanked by bearing units, so trim them from the ends.
    let s = 0;
    let e = group.length - 1;
    while (s <= e && !carriesCountertop(group[s])) s++;
    while (e >= s && !carriesCountertop(group[e])) e--;
    if (s > e) continue;

    // 3. Split the run where the base height changes.
    let run: Countertop | null = null;
    for (const u of group.slice(s, e + 1)) {
      const uTop: number = carriesCountertop(u) ? top(u) : (run?.y ?? top(u));
      if (run && Math.abs(run.y - uTop) < FLUSH_EPS_CM) {
        run.width = Math.max(run.width, right(u) - run.x);
      } else {
        if (run) slabs.push(run);
        run = {
          x: run ? Math.max(u.x, run.x + run.width) : u.x,
          width: 0,
          y: uTop,
          thickness: wall.countertopThicknessCm,
        };
        run.width = right(u) - run.x;
      }
    }
    if (run) slabs.push(run);
  }
  return slabs.filter((sl) => sl.width > 0);
}

/** Counter items (sink, cooktop, water bar, coffee machine) not fully standing on a countertop slab. */
export function computeUnsupported(wall: WallRun): KitchenItem[] {
  const slabs = computeCountertops(wall);
  return itemsInLayer(wall, 'counter').filter(
    (i) => !slabs.some((s) => i.x >= s.x - FLUSH_EPS_CM && right(i) <= s.x + s.width + FLUSH_EPS_CM),
  );
}

export interface SocketIssue {
  item: KitchenItem;
  reason: 'opening' | 'hidden';
}

/** Sockets inside a window/door opening, or covered by an upper or tall cabinet (unreachable). */
export function computeSocketIssues(wall: WallRun): SocketIssue[] {
  const issues: SocketIssue[] = [];
  for (const s of wall.items.filter((i) => isElectrical(i.category))) {
    const covers = (o: KitchenItem) => overlaps1d(s.x, right(s), o.x, right(o)) && overlaps1d(s.y, top(s), o.y, top(o));
    if (wall.items.some((o) => isOpening(o.category) && covers(o))) issues.push({ item: s, reason: 'opening' });
    else if (wall.items.some((o) => (o.category === 'upper_cabinet' || o.category === 'tall_cabinet') && covers(o))) {
      issues.push({ item: s, reason: 'hidden' });
    }
  }
  return issues;
}

/** First reachable spot for a new socket: above the countertop if there is one, else along the wall. */
function findSocketX(wall: WallRun, item: KitchenItem): number {
  const fits = (x: number) => {
    const s = { ...item, x };
    const clash = wall.items.some(
      (o) => isElectrical(o.category) && canCollide(s, o) && overlaps1d(x, x + s.width, o.x, right(o)),
    );
    return !clash && !computeSocketIssues({ ...wall, items: [...wall.items, s] }).some((i) => i.item.id === s.id);
  };
  const ranges = [...computeCountertops(wall).map((c) => [c.x + 10, c.x + c.width]), [10, wall.widthCm]];
  for (const [from, to] of ranges) {
    for (let x = from; x + item.width <= to; x += 5) if (fits(x)) return x;
  }
  return 0;
}

/** First free horizontal slot on the item's layer that fits it; used when spawning new elements. */
export function findFreeX(wall: WallRun, item: KitchenItem): number {
  const layer = layerOf(item.category);
  if (layer === 'electrical') return findSocketX(wall, item);
  if (layer === 'counter') {
    const occupied = itemsInLayer(wall, 'counter');
    const host = wall.items
      .filter((i) => carriesCountertop(i) && i.category !== 'corner_blocker')
      .sort((a, b) => a.x - b.x)
      .find((b) => !occupied.some((c) => overlaps1d(c.x, right(c), b.x, right(b))));
    if (host) return clampX(wall, item, host.x + (host.width - item.width) / 2);
    // Otherwise the first free stretch of countertop wide enough for it.
    for (const slab of computeCountertops(wall)) {
      let cursor = slab.x;
      for (const c of occupied
        .filter((o) => overlaps1d(o.x, right(o), slab.x, slab.x + slab.width))
        .sort((a, b) => a.x - b.x)) {
        if (c.x - cursor >= item.width) return cursor;
        cursor = Math.max(cursor, right(c));
      }
      if (slab.x + slab.width - cursor >= item.width) return cursor;
    }
    return 0;
  }
  const blockers = wall.items.filter((o) => canCollide(o, item)).sort((a, b) => a.x - b.x);
  let cursor = 0;
  for (const b of blockers) {
    if (b.x - cursor >= item.width) return cursor;
    cursor = Math.max(cursor, right(b));
  }
  return wall.widthCm - cursor >= item.width ? cursor : 0;
}

/** Usable front height of a cabinet box (excluding the plinth). */
export const boxHeight = (item: KitchenItem) => item.height - (item.hasToeKick ? item.toeKickHeight : 0);
