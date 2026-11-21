import type { EndProfile, IslandFace, KitchenItem, ProjectData, Room, Rotation, WallRun } from '../types';
import {
  bounds,
  cornerKind,
  nearestInside,
  rectInOutline,
  rectOutline,
  roomOutline,
  segmentIndex,
  segments,
  type Pt,
} from './outline';
import {
  canCollide,
  computeCountertops,
  computeOverlaps,
  countersOnUnits,
  carriesCountertop,
  isCounterBearing,
  isJoint,
  layerOf,
  normalizeWall,
  round1,
  type Countertop,
} from './geometry';
import { runName, t } from './i18n';

/** Plan coordinates: cm, X to the right (east), Y down (south), origin at the top-left of the room's bounding box. */
export type { Pt } from './outline';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Local frame of a run. Wall-local x runs along `u` (left to right as seen from inside the room,
 * facing the wall); depth runs along `n` into the room. Plan point = origin + u·x + n·depth.
 */
export interface Frame {
  origin: Pt;
  u: Pt;
  n: Pt;
  length: number;
}

export const WALL_THICKNESS_CM = 10;

/** Plan footprint of an island (axis-aligned bounding box of its rotated length × depth). */
export function islandRect(run: WallRun): Rect {
  const len = run.widthCm;
  const dep = run.depthCm ?? 90;
  const quarter = run.rotationDeg === 90 || run.rotationDeg === 270;
  return { x: run.planX ?? 0, y: run.planY ?? 0, w: quarter ? dep : len, h: quarter ? len : dep };
}

/**
 * Islands (#15): an island is its countertop — side A's run holds its position, length (`widthCm`), depth (`depthCm`)
 * and rotation. Cabinets stand under it against one of its four edges: the front (side A itself), the back (side
 * 'b') or an end ('left' / 'right'), each a run whose frame is derived from the countertop. The front faces the
 * island's rotation direction (south at 0°).
 */
export const isIslandSide = (run: WallRun) => run.kind === 'island' && !!run.face && run.face !== 'a';
/** Side A of an island: the island itself (its countertop and front). */
export const isIslandFront = (run: WallRun) => run.kind === 'island' && !isIslandSide(run);
export const islandSideOf = (data: ProjectData, island: WallRun, face: IslandFace) =>
  face === 'a' ? island : data.walls.find((w) => isIslandSide(w) && w.hostId === island.id && w.face === face);
export const islandBackOf = (data: ProjectData, island: WallRun) => islandSideOf(data, island, 'b');
/** The island a run belongs to (itself for side A); undefined for walls and partitions. */
export const islandOf = (data: ProjectData, run: WallRun) =>
  isIslandSide(run) ? data.walls.find((w) => w.id === run.hostId) : run.kind === 'island' ? run : undefined;

export const STOOL_RADIUS_CM = 20;
/** Seat heights (cm) of the two stool types. */
export const STOOL_SEAT_CM = { bar: 75, counter: 65 } as const;
/** How far the countertop stands proud of the cabinet fronts. */
export const COUNTER_LIP_CM = 2;
/** A chair stands this far out from the countertop edge (its seat half under the countertop). */
const CHAIR_OUT_CM = 12;

/** Depth of a run's cabinets (deepest floor unit), 0 when it has none. */
export const unitDepth = (run: WallRun | undefined) =>
  !run
    ? 0
    : Math.max(0, ...run.items.filter((i) => layerOf(i.category) === 'floor' && i.depth > 0).map((i) => i.depth));

/** Side A's frame as if its cabinets' backs were on the island's back edge (the countertop's own axes). */
function countertopFrame(a: WallRun): Frame {
  const { x, y, w, h } = islandRect(a);
  switch (a.rotationDeg ?? 0) {
    case 0:
      return { origin: { x, y }, u: { x: 1, y: 0 }, n: { x: 0, y: 1 }, length: w };
    case 90:
      return { origin: { x: x + w, y }, u: { x: 0, y: 1 }, n: { x: -1, y: 0 }, length: h };
    case 180:
      return { origin: { x: x + w, y: y + h }, u: { x: -1, y: 0 }, n: { x: 0, y: -1 }, length: w };
    case 270:
      return { origin: { x, y: y + h }, u: { x: 0, y: -1 }, n: { x: 1, y: 0 }, length: h };
  }
}

/**
 * Frame of side `face` of island A whose cabinets are `depth` deep: x runs along that edge left to right as seen from
 * outside, depth runs outwards, and the frame line is where the cabinets' backs stand so their fronts are just inside
 * the countertop edge.
 */
export function islandSideFrame(a: WallRun, face: IslandFace, depth: number): Frame {
  const c = countertopFrame(a);
  const L = a.widthCm;
  const D = a.depthCm ?? 90;
  const back = depth + COUNTER_LIP_CM;
  const neg = (p: Pt): Pt => ({ x: 0 - p.x, y: 0 - p.y });
  switch (face) {
    case 'a':
      return { origin: toPlan(c, 0, Math.max(0, D - back)), u: c.u, n: c.n, length: L };
    case 'b':
      return { origin: toPlan(c, L, Math.min(D, back)), u: neg(c.u), n: neg(c.n), length: L };
    case 'left':
      return { origin: toPlan(c, Math.min(L, back), 0), u: c.n, n: neg(c.u), length: D };
    case 'right':
      return { origin: toPlan(c, Math.max(0, L - back), D), u: neg(c.n), n: c.u, length: D };
  }
}

/** Keep every island side on its island (derived frame, length and height); a side whose island is gone is dropped. */
export function syncIslandSides(data: ProjectData): ProjectData {
  if (!data.walls.some(isIslandSide)) return data;
  const walls = data.walls.flatMap((w): WallRun[] => {
    if (!isIslandSide(w)) return [w];
    const a = data.walls.find((h) => h.id === w.hostId && isIslandFront(h));
    if (!a) return [];
    const f = islandSideFrame(a, w.face!, unitDepth(w));
    const next = {
      planX: round1(f.origin.x),
      planY: round1(f.origin.y),
      widthCm: round1(f.length),
      heightCm: a.heightCm,
      rotationDeg: rotationOf(f.u),
      countertopThicknessCm: a.countertopThicknessCm,
    };
    const same = (Object.keys(next) as (keyof typeof next)[]).every((k) => w[k] === next[k]);
    return [same ? w : normalizeWall({ ...w, ...next })];
  });
  const activeWallId = walls.some((w) => w.id === data.activeWallId) ? data.activeWallId : walls[0].id;
  return { ...data, walls, activeWallId };
}

/** Height of an island's countertop top (its tallest cabinet's top + the countertop; 90 cm with no cabinets). */
export function islandTop(data: ProjectData, a: WallRun): number {
  const runs = [a, ...data.walls.filter((w) => isIslandSide(w) && w.hostId === a.id)];
  const tops = runs.flatMap((r) =>
    r.items.filter((i) => isCounterBearing(i.category) && !i.noCountertop).map((i) => i.y + i.height),
  );
  return (tops.length ? Math.max(...tops) : 87) + a.countertopThicknessCm;
}

/**
 * How an island side's elevation is drawn (#15): the island's countertop right across it, and at an end its profile
 * behind everything. Nothing for walls and partitions.
 */
export function islandDrawing(
  data: ProjectData,
  run: WallRun,
): { island?: { top: number; thickness: number }; backdrop?: { kind: 'panel' | 'waterfall'; top: number } } {
  const a = islandOf(data, run);
  if (!a) return {};
  const top = islandTop(data, a);
  const t = a.countertopThicknessCm;
  const face = run.face && run.face !== 'a' ? run.face : 'a';
  const pr = face === 'left' || face === 'right' ? endProfiles(a).find((e) => e.side === face) : undefined;
  return {
    island: { top, thickness: t },
    ...(pr && {
      backdrop: { kind: pr.kind === 'waterfall' ? 'waterfall' : 'panel', top: pr.kind === 'waterfall' ? top : top - t },
    }),
  };
}

/** One edge of an island's countertop that has nothing under it, and how far it sticks out past its support. */
export interface IslandOverhang {
  face: IslandFace;
  /** The unsupported strip of countertop along that edge, in plan. */
  rect: Rect;
  cantilever: number;
  /** Held up by waterfall ends (front and back only). */
  supported: boolean;
}

/**
 * Where island A's countertop overhangs (#15): along each edge with no cabinets under it, from the nearest cabinets
 * (the other side's backs, or along the island for the ends) out to the edge. Computed from the countertop and the
 * cabinets, never entered.
 */
export function islandOverhangs(data: ProjectData, a: WallRun): IslandOverhang[] {
  const c = countertopFrame(a);
  const L = a.widthCm;
  const D = a.depthCm ?? 90;
  const side = (face: IslandFace) => islandSideOf(data, a, face);
  const dA = unitDepth(a);
  const dB = unitDepth(side('b'));
  const has = (r: WallRun | undefined) => !!r && unitDepth(r) > 0;
  const waterfalls = a.leftProfile === 'waterfall' && a.rightProfile === 'waterfall';
  const out: IslandOverhang[] = [];
  const minEps = 0.5;
  // An island with no cabinets yet hasn't been designed: nothing overhangs (review finding R22).
  if (!['a', 'b', 'left', 'right'].some((f) => has(side(f as IslandFace)))) return out;
  // Front and back: the depth between the edge and the cabinets on the other side (or the whole depth).
  if (!has(a)) {
    const support = has(side('b')) ? dB + COUNTER_LIP_CM : 0;
    const cantilever = D - support;
    if (cantilever > minEps)
      out.push({ face: 'a', rect: localRect(c, 0, L, support, D), cantilever, supported: waterfalls });
  }
  if (!has(side('b'))) {
    const support = has(a) ? D - dA - COUNTER_LIP_CM : D;
    const cantilever = support;
    if (cantilever > minEps)
      out.push({ face: 'b', rect: localRect(c, 0, L, 0, support), cantilever, supported: waterfalls });
  }
  // Ends: along the island, from the edge to the first cabinet on the front or the back.
  const spans = [
    ...a.items.filter((i) => layerOf(i.category) === 'floor' && i.depth > 0).map((i) => [i.x, i.x + i.width]),
    ...(side('b')?.items ?? [])
      .filter((i) => layerOf(i.category) === 'floor' && i.depth > 0)
      .map((i) => [L - i.x - i.width, L - i.x]),
  ];
  if (spans.length) {
    const first = Math.min(...spans.map((sp) => sp[0]));
    const last = Math.max(...spans.map((sp) => sp[1]));
    if (!has(side('left')) && first > minEps)
      out.push({
        face: 'left',
        rect: localRect(c, 0, first, 0, D),
        cantilever: first,
        supported: a.leftProfile === 'waterfall',
      });
    if (!has(side('right')) && L - last > minEps)
      out.push({
        face: 'right',
        rect: localRect(c, last, L, 0, D),
        cantilever: L - last,
        supported: a.rightProfile === 'waterfall',
      });
  }
  return out;
}

/** Plan centre of a chair: just past the countertop edge of its side, its seat half under the countertop. */
export function stoolPoint(data: ProjectData, run: WallRun, stool: KitchenItem): Pt {
  const f = wallFrame(data.room, run);
  return toPlan(f, stool.x + stool.width / 2, unitDepth(run) + COUNTER_LIP_CM + CHAIR_OUT_CM);
}

/** Where an element stands in the plan: a chair round its seat, anything else in front of its run. */
export function planFootprint(data: ProjectData, run: WallRun, item: KitchenItem): Rect {
  if (item.category !== 'stool') return itemPlanRect(wallFrame(data.room, run), item);
  const c = stoolPoint(data, run, item);
  const r = Math.min(item.width, item.depth) / 2;
  return { x: c.x - r, y: c.y - r, w: 2 * r, h: 2 * r };
}

/** The end profiles of island A as plan rectangles (a strip at each end of the countertop). */
export function endProfiles(a: WallRun): { side: 'left' | 'right'; kind: EndProfile; rect: Rect }[] {
  const c = countertopFrame(a);
  const L = a.widthCm;
  const D = a.depthCm ?? 90;
  const out: { side: 'left' | 'right'; kind: EndProfile; rect: Rect }[] = [];
  for (const side of ['left', 'right'] as const) {
    const kind = side === 'left' ? a.leftProfile : a.rightProfile;
    if (!kind || kind === 'none') continue;
    // A waterfall is the countertop turning down (its full depth); a plain panel stops at the cabinet fronts.
    const t = kind === 'waterfall' ? 4 : 2;
    const [d0, d1] = kind === 'waterfall' ? [0, D] : [COUNTER_LIP_CM, D - COUNTER_LIP_CM];
    const along = side === 'left' ? [0, t] : [L - t, L];
    out.push({ side, kind, rect: localRect(c, along[0], along[1], d0, d1) });
  }
  return out;
}

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/** Everything island A takes up in the plan: its countertop and its chairs. */
export function islandFootprint(data: ProjectData, a: WallRun): Rect {
  let r = islandRect(a);
  for (const run of [a, ...data.walls.filter((w) => isIslandSide(w) && w.hostId === a.id)])
    for (const st of run.items.filter((i) => i.category === 'stool')) r = union(r, planFootprint(data, run, st));
  return r;
}

/** One measured aisle: from an edge of an island's countertop to the nearest thing facing it. */
export interface IslandClearance {
  face: IslandFace;
  from: Pt;
  to: Pt;
  distance: number;
}

/**
 * The distance from each edge of island A's countertop to what faces it (#15): the nearest floor unit of another run
 * (wall cabinets' fronts, another island) or the room's wall.
 */
export function islandClearances(data: ProjectData, a: WallRun): IslandClearance[] {
  const r = islandRect(a);
  const mine = new Set([a.id, ...data.walls.filter((w) => w.hostId === a.id && w.kind === 'island').map((w) => w.id)]);
  const obstacles: Rect[] = data.walls.flatMap((run) => {
    if (mine.has(run.id) || (run.kind === 'wall' && run.removed)) return [];
    const f = wallFrame(data.room, run);
    // Floor units, and columns or pipe boxes standing on the floor (review finding R23).
    const items = run.items
      .filter((i) => i.depth > 0 && (layerOf(i.category) === 'floor' || (i.category === 'column' && i.y < 1)))
      .map((i) => itemPlanRect(f, i));
    return isIslandFront(run)
      ? [...items, islandRect(run)]
      : run.kind === 'partition'
        ? [...items, ...(run.face === 'b' ? [] : [partitionRect(data.room, run)])]
        : items;
  });
  // Walls of the room, but not open sides (review finding R23).
  const open = new Set(data.walls.filter((w) => w.kind === 'wall' && w.removed).map((w) => segmentIndex(w)));
  const segs = segments(roomOutline(data.room)).filter((sg) => !open.has(sg.index));
  const c = countertopFrame(a);
  // The four edges as outward directions; which face each is follows the rotation.
  const faceOf = (n: Pt): IslandFace => {
    const dot = (p: Pt) => p.x * n.x + p.y * n.y;
    if (dot(c.n) > 0.5) return 'a';
    if (dot(c.n) < -0.5) return 'b';
    return dot(c.u) > 0.5 ? 'right' : 'left';
  };
  const out: IslandClearance[] = [];
  for (const n of [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ]) {
    const horizontal = n.x === 0; // edge runs along x
    const [s0, s1] = horizontal ? [r.x, r.x + r.w] : [r.y, r.y + r.h];
    const edge = n.y < 0 ? r.y : n.y > 0 ? r.y + r.h : n.x < 0 ? r.x : r.x + r.w;
    let best: { distance: number; at: number } | null = null;
    const consider = (lo: number, hi: number, near: number) => {
      const o0 = Math.max(s0, lo);
      const o1 = Math.min(s1, hi);
      if (o1 - o0 < 1) return;
      const distance = (near - edge) * (n.x + n.y);
      if (distance < -0.5) return;
      if (!best || distance < best.distance) best = { distance: Math.max(0, distance), at: (o0 + o1) / 2 };
    };
    for (const o of obstacles) {
      const [lo, hi] = horizontal ? [o.x, o.x + o.w] : [o.y, o.y + o.h];
      const near = n.y < 0 ? o.y + o.h : n.y > 0 ? o.y : n.x < 0 ? o.x + o.w : o.x;
      consider(lo, hi, near);
    }
    for (const sg of segs) {
      const along = horizontal ? Math.abs(sg.u.x) > 0.5 : Math.abs(sg.u.y) > 0.5;
      if (!along) continue;
      const [lo, hi] = horizontal
        ? [Math.min(sg.p.x, sg.q.x), Math.max(sg.p.x, sg.q.x)]
        : [Math.min(sg.p.y, sg.q.y), Math.max(sg.p.y, sg.q.y)];
      consider(lo, hi, horizontal ? sg.p.y : sg.p.x);
    }
    const found = best as { distance: number; at: number } | null;
    if (!found) continue;
    const from = horizontal ? { x: found.at, y: edge } : { x: edge, y: found.at };
    const to = { x: from.x + n.x * found.distance, y: from.y + n.y * found.distance };
    out.push({ face: faceOf(n), from, to, distance: round1(found.distance) });
  }
  return out;
}

const DIRECTION: Record<Rotation, Pt> = {
  0: { x: 1, y: 0 },
  90: { x: 0, y: 1 },
  180: { x: -1, y: 0 },
  270: { x: 0, y: -1 },
};
const rotationOf = (u: Pt): Rotation => (u.x > 0.5 ? 0 : u.y > 0.5 ? 90 : u.x < -0.5 ? 180 : 270);

export function wallFrame(room: Room, run: WallRun): Frame {
  if (run.kind === 'island') {
    // Islands (#15): side A from its countertop and its cabinets; the other sides as stored by syncIslandSides.
    if (isIslandFront(run)) return islandSideFrame(run, 'a', unitDepth(run));
    const u = DIRECTION[run.rotationDeg ?? 0];
    return { origin: { x: run.planX ?? 0, y: run.planY ?? 0 }, u, n: { x: 0 - u.y, y: u.x }, length: run.widthCm };
  }
  if (run.kind === 'partition') {
    // Stored by syncPartitions: the face's start point and the direction it runs in.
    const u = DIRECTION[run.rotationDeg ?? 0];
    return { origin: { x: run.planX ?? 0, y: run.planY ?? 0 }, u, n: { x: 0 - u.y, y: u.x }, length: run.widthCm };
  }
  if (run.kind === 'wall') {
    // A wall is a segment of the room outline: x runs from its start (left as seen from inside) to its end.
    const seg = segments(roomOutline(room))[segmentIndex(run)];
    if (seg) return { origin: seg.p, u: seg.u, n: seg.n, length: seg.length };
  }
  // A wall whose segment no longer exists: along the room's top edge.
  return { origin: { x: 0, y: 0 }, u: { x: 1, y: 0 }, n: { x: 0, y: 1 }, length: room.widthCm };
}

export const toPlan = (f: Frame, along: number, depth: number): Pt => ({
  x: f.origin.x + f.u.x * along + f.n.x * depth,
  y: f.origin.y + f.u.y * along + f.n.y * depth,
});

/** Axis-aligned plan rectangle spanning wall-local [x0, x1] × [d0, d1]. */
export function localRect(f: Frame, x0: number, x1: number, d0: number, d1: number): Rect {
  const a = toPlan(f, x0, d0);
  const b = toPlan(f, x1, d1);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export const itemPlanRect = (f: Frame, item: KitchenItem): Rect =>
  localRect(f, item.x, item.x + item.width, 0, item.depth);

/** Floor area swept by a door leaf opening into the room (a width × width square in front of it). */
export const doorSwingRect = (f: Frame, door: KitchenItem): Rect =>
  localRect(f, door.x, door.x + door.width, 0, door.width);

/** Wall-local x of a plan point (projection onto the run's axis). */
export const planPointToWallX = (f: Frame, p: Pt): number => (p.x - f.origin.x) * f.u.x + (p.y - f.origin.y) * f.u.y;

/** Countertop slab with its plan depth: the deepest unit under it plus a 2 cm front overhang. */
export function countertopDepth(run: WallRun, c: Countertop): number {
  const under = run.items.filter((i) => carriesCountertop(i) && i.x < c.x + c.width && i.x + i.width > c.x);
  return (under.length ? Math.max(...under.map((i) => i.depth)) : 60) + 2;
}

export const countertopRects = (f: Frame, run: WallRun) =>
  computeCountertops(run).map((c) => localRect(f, c.x, c.x + c.width, 0, countertopDepth(run, c)));

const EPS = 0.1;
export const rectsOverlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;

export const rectIntersection = (a: Rect, b: Rect): Rect => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y };
};

export interface PlanConflict {
  a: string; // item id (or run id for an island outside the room)
  b?: string;
  rect: Rect;
  kind: 'clash' | 'outside' | 'swing';
}

/**
 * Collisions between items on different runs (wall corners, islands), islands leaving the room,
 * and inward-opening doors whose swing hits floor units on other runs or an island.
 */
export function computePlanConflicts(data: ProjectData): PlanConflict[] {
  const placed = data.walls.flatMap((run) =>
    run.items.filter((i) => i.depth > 0).map((item) => ({ run, item, rect: planFootprint(data, run, item) })),
  );
  // A chair takes floor space, so it clashes with other chairs and with floor units (review finding R19).
  const floorish = (i: KitchenItem) => ['floor', 'seat'].includes(layerOf(i.category));
  const clash = (a: KitchenItem, b: KitchenItem) =>
    canCollide(a, b) || ((a.category === 'stool' || b.category === 'stool') && floorish(a) && floorish(b));
  const conflicts: PlanConflict[] = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const p = placed[i];
      const q = placed[j];
      if (p.run.id === q.run.id || !clash(p.item, q.item) || !rectsOverlap(p.rect, q.rect)) continue;
      conflicts.push({ a: p.item.id, b: q.item.id, rect: rectIntersection(p.rect, q.rect), kind: 'clash' });
    }
  }
  for (const run of data.walls.filter((w) => (w.kind === 'wall' && !w.removed) || w.kind === 'partition')) {
    const f = wallFrame(data.room, run);
    for (const door of run.items.filter((i) => i.category === 'door' && i.doorSwing !== 'out')) {
      const swing = doorSwingRect(f, door);
      // A partition wall in the way of the leaf (review finding R13), other than the one the door is in.
      for (const { run: part, rect } of partitionRects(data)) {
        if (part.partitionId === run.partitionId && run.kind === 'partition') continue;
        if (rectsOverlap(swing, rect))
          conflicts.push({ a: door.id, b: part.id, rect: rectIntersection(swing, rect), kind: 'swing' });
      }
      for (const p of placed) {
        if (p.run.id === run.id || layerOf(p.item.category) !== 'floor' || !rectsOverlap(swing, p.rect)) continue;
        conflicts.push({ a: door.id, b: p.item.id, rect: rectIntersection(swing, p.rect), kind: 'swing' });
      }
      for (const isl of data.walls.filter(isIslandFront)) {
        const r = islandFootprint(data, isl);
        if (rectsOverlap(swing, r))
          conflicts.push({ a: door.id, b: isl.id, rect: rectIntersection(swing, r), kind: 'swing' });
      }
    }
  }

  const outline = roomOutline(data.room);
  for (const run of data.walls.filter(isIslandFront)) {
    const r = islandFootprint(data, run);
    if (!rectInOutline(outline, r)) conflicts.push({ a: run.id, rect: r, kind: 'outside' });
  }
  // Partition walls (#10): inside the room, and not through units of other runs (its host is handled by the joint).
  for (const run of data.walls.filter((w) => w.kind === 'partition' && w.face !== 'b')) {
    const body = partitionRect(data.room, run);
    if (!rectInOutline(outline, body)) conflicts.push({ a: run.id, rect: body, kind: 'outside' });
    for (const p of placed) {
      if (p.run.id === run.hostId || p.run.partitionId === run.partitionId) continue;
      if (!floorish(p.item) || !rectsOverlap(body, p.rect)) continue;
      conflicts.push({ a: p.item.id, b: run.id, rect: rectIntersection(body, p.rect), kind: 'clash' });
    }
    for (const isl of data.walls.filter(isIslandFront)) {
      const r = islandFootprint(data, isl);
      if (rectsOverlap(body, r))
        conflicts.push({ a: isl.id, b: run.id, rect: rectIntersection(body, r), kind: 'clash' });
    }
  }
  return conflicts;
}

/**
 * Make a run's units fit a shorter length without piling them up: per layer, walking from the far end, each unit
 * moves back only as far as needed to clear the end of the wall and the unit after it (order is kept). Counter
 * items move with the unit they stand on. Units overlap only when the layer truly doesn't fit.
 */
function fitToLength(run: WallRun, length: number, fixed: KitchenItem[] = []): WallRun {
  const end = (i: KitchenItem) => i.x + i.width;
  if (length >= run.widthCm) return run;
  const shift = new Map<string, number>();
  // Walking from the far end, each unit stops at the wall end or at the new position of a unit to its right that it
  // can actually collide with (same height band, or a tall unit vs. a wall cabinet / window). Partition joints
  // (`fixed`) don't move: units stop at them too, and aren't pushed back across one (review finding R14).
  const placed: { item: KitchenItem; x: number }[] = fixed.map((j) => ({ item: j, x: j.x }));
  const units = run.items.filter((i) => ['floor', 'upper'].includes(layerOf(i.category)));
  for (const u of units.sort((a, b) => end(b) - end(a))) {
    const limit = Math.min(length, ...placed.filter((p) => p.item.x >= u.x && canCollide(u, p.item)).map((p) => p.x));
    const floor = Math.max(0, ...fixed.filter((j) => end(j) <= u.x + 0.5).map(end));
    const x = Math.max(floor, Math.min(u.x, limit - u.width));
    if (x !== u.x) shift.set(u.id, x - u.x);
    placed.push({ item: u, x });
  }
  for (const [host, ids] of countersOnUnits(run))
    for (const id of ids) if (shift.has(host)) shift.set(id, shift.get(host)!);
  return { ...run, items: run.items.map((i) => (shift.has(i.id) ? { ...i, x: i.x + shift.get(i.id)! } : i)) };
}

/**
 * The mirror of fitToLength, for units pushed past the START of a run (x < 0, e.g. when dragging the previous wall
 * shortens this one from its start): walking from the start, each unit moves forward only as far as needed to clear
 * the start and the units before it that it can collide with (order is kept; counter items move with their unit).
 * Partition joints (`fixed`) stay put and stop units the same way. Review findings R11, R14.
 */
function fitFromStart(run: WallRun, fixed: KitchenItem[] = []): WallRun {
  const units = run.items.filter((i) => ['floor', 'upper'].includes(layerOf(i.category)));
  if (!units.some((u) => u.x < 0)) return run;
  const shift = new Map<string, number>();
  const placed: { item: KitchenItem; x: number }[] = fixed.map((j) => ({ item: j, x: j.x }));
  for (const u of units.sort((a, b) => a.x - b.x)) {
    const limit = Math.max(
      0,
      ...placed.filter((p) => p.item.x <= u.x && canCollide(u, p.item)).map((p) => p.x + p.item.width),
    );
    const ceiling = Math.min(Infinity, ...fixed.filter((j) => j.x >= u.x + u.width - 0.5).map((j) => j.x));
    const x = Math.min(Math.max(u.x, limit), Math.max(u.x, ceiling - u.width));
    if (x !== u.x) shift.set(u.id, x - u.x);
    placed.push({ item: u, x });
  }
  for (const [host, ids] of countersOnUnits(run))
    for (const id of ids) if (shift.has(host)) shift.set(id, shift.get(host)!);
  return { ...run, items: run.items.map((i) => (shift.has(i.id) ? { ...i, x: i.x + shift.get(i.id)! } : i)) };
}

/** Re-derive wall lengths and ceiling heights from the room, then re-normalize every run. Islands that fit are
 * kept inside the room. */
export function syncRoom(data: ProjectData): ProjectData {
  // A rectangle follows the Width / Depth fields; any other outline drives the bounding box instead.
  const given = data.room.outline;
  const outline = given && given.length > 4 ? given : rectOutline(data.room.widthCm, data.room.depthCm);
  const box = bounds(outline);
  const room: Room = { ...data.room, outline, widthCm: box.w, depthCm: box.h };
  const segs = segments(outline);
  return syncIslandSides(
    syncPartitions({
      ...data,
      room,
      walls: data.walls.map((w) => {
        const seg = w.kind === 'wall' ? segs[segmentIndex(w)] : undefined;
        const widthCm = seg ? round1(seg.length) : w.widthCm;
        // Partition joints stay put while units are fitted (clamped onto the new length, as syncPartitions will),
        // and are re-derived by syncPartitions afterwards.
        const joints = w.items
          .filter(isJoint)
          .map((j) => ({ ...j, x: Math.min(j.x, Math.max(0, widthCm - WALL_THICKNESS_CM)) }));
        const own = { ...w, items: w.items.filter((i) => !isJoint(i)) };
        let run: WallRun = {
          ...fitToLength(fitFromStart(own, joints), widthCm, joints),
          heightCm: room.heightCm,
          widthCm,
        };
        if (seg) run = { ...run, segment: seg.index, side: seg.side };
        if (isIslandFront(run)) {
          // Keep the whole island (side B and seating included) inside the room; side B follows in syncIslandBacks.
          const r = islandFootprint(data, run);
          const off = { x: r.x - (run.planX ?? 0), y: r.y - (run.planY ?? 0) };
          if (r.w <= room.widthCm && r.h <= room.depthCm) {
            let x = Math.min(Math.max(0, r.x), room.widthCm - r.w);
            let y = Math.min(Math.max(0, r.y), room.depthCm - r.h);
            // In an L or U room the bounding box isn't enough: move it to the nearest spot inside, if there is one.
            if (!rectInOutline(outline, { x, y, w: r.w, h: r.h })) {
              const spot = nearestInside(outline, r.w, r.h, { x, y });
              if (spot) ({ x, y } = spot);
            }
            run = { ...run, planX: x - off.x, planY: y - off.y };
          }
        }
        return normalizeWall(run);
      }),
    }),
  );
}

/** Shortest partition wall (cm). */
export const MIN_PARTITION_CM = 20;

/**
 * Frame of one face of a partition wall standing at `hostX` on `host` (FEATURES.md #10). Side A starts at the host
 * wall (its left end, as seen facing it) and runs into the room; side B is the other face, so it runs back towards
 * the host and ends there. The partition's body is wall-local depth −T…0 on either face.
 */
export function partitionFrame(room: Room, host: WallRun, hostX: number, length: number, face: 'a' | 'b'): Frame {
  const hf = wallFrame(room, host);
  const T = WALL_THICKNESS_CM;
  if (face === 'a') return { origin: toPlan(hf, hostX, 0), u: hf.n, n: { x: 0 - hf.u.x, y: 0 - hf.u.y }, length };
  return { origin: toPlan(hf, hostX + T, length), u: { x: 0 - hf.n.x, y: 0 - hf.n.y }, n: hf.u, length };
}

/** Plan footprint of a partition wall, from either of its faces. */
export const partitionRect = (room: Room, face: WallRun): Rect =>
  localRect(wallFrame(room, face), 0, face.widthCm, -WALL_THICKNESS_CM, 0);

/** Plan footprints of all partition walls (one per partition). */
export const partitionRects = (data: ProjectData): { run: WallRun; rect: Rect }[] =>
  data.walls
    .filter((w) => w.kind === 'partition' && w.face !== 'b')
    .map((run) => ({ run, rect: partitionRect(data.room, run) }));

/** Whether the straight line a → b passes through the inside of `r` (touching its edges doesn't count). */
export function segmentHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  // Liang–Barsky clipping against the rectangle shrunk by a hair.
  const e = 0.01;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q > 0;
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    return t0 < t1;
  };
  return (
    clip(-dx, a.x - (r.x + e)) &&
    clip(dx, r.x + r.w - e - a.x) &&
    clip(-dy, a.y - (r.y + e)) &&
    clip(dy, r.y + r.h - e - a.y)
  );
}

/** The derived item that blocks the host wall where a partition stands (see `isJoint`). */
function jointItem(partitionId: string, hostX: number, height: number): KitchenItem {
  return {
    id: `joint-${partitionId}`,
    category: 'partition_joint',
    label: 'Partition',
    x: hostX,
    y: 0,
    width: WALL_THICKNESS_CM,
    height,
    depth: 0,
    hasToeKick: false,
    toeKickHeight: 10,
    frontType: 'doors',
    doorCount: 1,
    drawerCount: 1,
    drawerSplitPcts: [100],
  };
}

/**
 * Keep partitions consistent with their host walls: side A's geometry is the truth (position clamped onto the host,
 * length at least MIN_PARTITION_CM), both faces get their frame, and each host gets one joint item per partition.
 * A partition whose host wall is gone or removed is dropped.
 */
function syncPartitions(data: ProjectData): ProjectData {
  const hosts = new Map(data.walls.filter((w) => w.kind === 'wall' && !w.removed).map((w) => [w.id, w]));
  const geometry = new Map<string, { host: WallRun; hostX: number; length: number }>();
  const faces = data.walls.filter((w) => w.kind === 'partition');
  for (const r of [...faces].sort((p, q) => (p.face === 'a' ? 0 : 1) - (q.face === 'a' ? 0 : 1))) {
    const host = hosts.get(r.hostId ?? '');
    if (!r.partitionId || !host || geometry.has(r.partitionId)) continue;
    const hostX = round1(Math.min(Math.max(0, r.hostX ?? 0), Math.max(0, host.widthCm - WALL_THICKNESS_CM)));
    geometry.set(r.partitionId, { host, hostX, length: round1(Math.max(MIN_PARTITION_CM, r.widthCm)) });
  }
  if (!faces.length && !data.walls.some((w) => w.items.some(isJoint))) return data;
  const walls = data.walls.flatMap((r): WallRun[] => {
    if (r.kind === 'partition') {
      const g = geometry.get(r.partitionId ?? '');
      if (!g) return [];
      const f = partitionFrame(data.room, g.host, g.hostX, g.length, r.face === 'b' ? 'b' : 'a');
      return [
        normalizeWall({
          ...r,
          hostId: g.host.id,
          hostX: g.hostX,
          widthCm: g.length,
          heightCm: data.room.heightCm,
          planX: round1(f.origin.x),
          planY: round1(f.origin.y),
          rotationDeg: rotationOf(f.u),
        }),
      ];
    }
    if (r.kind !== 'wall') return [r];
    const joints = [...geometry]
      .filter(([, g]) => g.host.id === r.id)
      .map(([id, g]) => jointItem(id, g.hostX, data.room.heightCm));
    const items = r.items.filter((i) => !isJoint(i));
    return joints.length || items.length !== r.items.length ? [{ ...r, items: [...items, ...joints] }] : [r];
  });
  const activeWallId = walls.some((w) => w.id === data.activeWallId) ? data.activeWallId : walls[0].id;
  return { ...data, walls, activeWallId };
}

/** Plain-language consequences of changing the room from `before` to `after` (empty when nothing breaks). */
export function roomChangeWarnings(before: ProjectData, after: ProjectData): string[] {
  const out: string[] = [];
  // Overlaps anywhere before the change, by element pair: elements can move to another (or a new) wall, e.g. into
  // a niche (review finding R16).
  const was = new Set(before.walls.flatMap((r) => computeOverlaps(r).map((o) => `${o.a}|${o.b}`)));
  for (const run of after.walls) {
    if (run.kind === 'wall' && run.removed) continue;
    const old = before.walls.find((w) => w.id === run.id);
    const added = computeOverlaps(run).filter((o) => !was.has(`${o.a}|${o.b}`) && !was.has(`${o.b}|${o.a}`));
    if (added.length) {
      const n = new Set(added.flatMap((o) => [o.a, o.b])).size;
      out.push(
        old
          ? t('{old} becomes {widthCm} cm: {n} of its elements no longer fit and will overlap.', {
              old: runName(old.name),
              widthCm: round1(run.widthCm),
              n,
            })
          : t('The new {wall} ({widthCm} cm) gets {n} elements that overlap.', {
              wall: runName(run.name),
              widthCm: round1(run.widthCm),
              n,
            }),
      );
    }
    if (!old) continue;
    const inside = (d: ProjectData, r: Rect) => rectInOutline(roomOutline(d.room), r);
    if (
      isIslandFront(run) &&
      inside(before, islandFootprint(before, old)) &&
      !inside(after, islandFootprint(after, run))
    )
      out.push(t('{old} no longer fits in the room.', { old: runName(old.name) }));
    // Review finding R14: a partition that ends up sticking out of the room (reported once, from side A).
    if (run.kind === 'partition' && run.face !== 'b') {
      const fitted = inside(before, partitionRect(before.room, old));
      if (fitted && !inside(after, partitionRect(after.room, run)))
        out.push(
          t('{old} no longer fits in the room.', { old: runName((old.name.match(/^Partition \d+/) ?? [old.name])[0]) }),
        );
    }
  }
  return out;
}

export const snapTo = (v: number, step: number) => round1(Math.round(v / step) * step);

/**
 * What is at one end of a run. Rules ask this instead of looking at walls directly, so they keep working when
 * room shapes beyond the rectangle (FEATURES.md #6) change how runs meet.
 */
export type RunEnd =
  | { kind: 'inside_corner'; runId: string; neighbourId: string; neighbourEnd: 'start' | 'end' }
  | { kind: 'outside_corner'; runId: string; neighbourId: string; neighbourEnd: 'start' | 'end' }
  | { kind: 'open'; runId: string };

/**
 * Both ends of a run (start = wall-local x 0, end = x = length). In the rectangular room each wall's end meets the
 * next wall clockwise at its start (north → east → south → west); a removed neighbour leaves the end open.
 * Islands are open at both ends.
 */
export function runEnds(data: ProjectData, run: WallRun): { start: RunEnd; end: RunEnd } {
  const open = { kind: 'open', runId: run.id } as const;
  if (run.kind === 'partition') {
    // Side A starts at its host wall, side B ends there; the far end is free-standing.
    const host = data.walls.find((w) => w.id === run.hostId);
    if (!host) return { start: open, end: open };
    return run.face === 'b'
      ? { start: open, end: { kind: 'inside_corner', runId: run.id, neighbourId: host.id, neighbourEnd: 'start' } }
      : { start: { kind: 'inside_corner', runId: run.id, neighbourId: host.id, neighbourEnd: 'end' }, end: open };
  }
  if (run.kind !== 'wall' || run.removed) return { start: open, end: open };
  const outline = roomOutline(data.room);
  const n = outline.length;
  const i = segmentIndex(run);
  const wallOn = (seg: number) => data.walls.find((w) => w.kind === 'wall' && !w.removed && segmentIndex(w) === seg);
  const prev = wallOn((i + n - 1) % n);
  const next = wallOn((i + 1) % n);
  // The corner at our start is the end of the previous segment; at our end, the end of ours.
  const kindAt = (corner: number) => (cornerKind(outline, corner) === 'inside' ? 'inside_corner' : 'outside_corner');
  return {
    start: prev ? { kind: kindAt((i + n - 1) % n), runId: run.id, neighbourId: prev.id, neighbourEnd: 'end' } : open,
    end: next ? { kind: kindAt(i), runId: run.id, neighbourId: next.id, neighbourEnd: 'start' } : open,
  };
}
