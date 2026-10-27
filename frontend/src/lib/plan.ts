import type { KitchenItem, ProjectData, Room, WallRun } from '../types';
import {
  canCollide,
  computeCountertops,
  carriesCountertop,
  layerOf,
  normalizeWall,
  round1,
  type Countertop,
} from './geometry';

/** Plan coordinates: cm, X to the right (east), Y down (south), origin at the room's north-west inner corner. */
export interface Pt {
  x: number;
  y: number;
}

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

export function wallFrame(room: Room, run: WallRun): Frame {
  // Walls behave like an island whose footprint is the whole room, rotated per side.
  const box: Rect = run.kind === 'island' ? islandRect(run) : { x: 0, y: 0, w: room.widthCm, h: room.depthCm };
  const rotation =
    run.kind === 'island'
      ? (run.rotationDeg ?? 0)
      : ({ north: 0, east: 90, south: 180, west: 270 } as const)[run.side ?? 'north'];
  const { x, y, w, h } = box;
  switch (rotation) {
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
const rectsOverlap = (a: Rect, b: Rect) =>
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
  const placed = data.walls.flatMap((run) => {
    const f = wallFrame(data.room, run);
    return run.items.filter((i) => i.depth > 0).map((item) => ({ run, item, rect: itemPlanRect(f, item) }));
  });
  const conflicts: PlanConflict[] = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const p = placed[i];
      const q = placed[j];
      if (p.run.id === q.run.id || !canCollide(p.item, q.item) || !rectsOverlap(p.rect, q.rect)) continue;
      conflicts.push({ a: p.item.id, b: q.item.id, rect: rectIntersection(p.rect, q.rect), kind: 'clash' });
    }
  }
  for (const run of data.walls.filter((w) => w.kind === 'wall' && !w.removed)) {
    const f = wallFrame(data.room, run);
    for (const door of run.items.filter((i) => i.category === 'door' && i.doorSwing !== 'out')) {
      const swing = doorSwingRect(f, door);
      for (const p of placed) {
        if (p.run.id === run.id || layerOf(p.item.category) !== 'floor' || !rectsOverlap(swing, p.rect)) continue;
        conflicts.push({ a: door.id, b: p.item.id, rect: rectIntersection(swing, p.rect), kind: 'swing' });
      }
      for (const isl of data.walls.filter((w) => w.kind === 'island')) {
        const r = islandRect(isl);
        if (rectsOverlap(swing, r))
          conflicts.push({ a: door.id, b: isl.id, rect: rectIntersection(swing, r), kind: 'swing' });
      }
    }
  }

  const roomRect = { x: 0, y: 0, w: data.room.widthCm, h: data.room.depthCm };
  for (const run of data.walls.filter((w) => w.kind === 'island')) {
    const r = islandRect(run);
    const inside = r.x >= -EPS && r.y >= -EPS && r.x + r.w <= roomRect.w + EPS && r.y + r.h <= roomRect.h + EPS;
    if (!inside) conflicts.push({ a: run.id, rect: r, kind: 'outside' });
  }
  return conflicts;
}

/** Re-derive wall lengths and ceiling heights from the room, then re-normalize every run. */
export function syncRoom(data: ProjectData): ProjectData {
  const { room } = data;
  return {
    ...data,
    walls: data.walls.map((w) =>
      normalizeWall({
        ...w,
        heightCm: room.heightCm,
        widthCm:
          w.kind === 'wall' ? (w.side === 'north' || w.side === 'south' ? room.widthCm : room.depthCm) : w.widthCm,
      }),
    ),
  };
}

export const snapTo = (v: number, step: number) => round1(Math.round(v / step) * step);
