/**
 * Room outlines (FEATURES.md #6, PROJECT.md decision 12): any closed outline with 90° corners.
 *
 * The outline is a list of corner points in plan cm, clockwise on screen (X east, Y south), with its bounding box
 * starting at (0, 0). Wall i runs from point i to point i + 1. Seen from inside the room, a wall's left end is its
 * start, so the wall-local frame is: origin = start point, u = direction of the wall, n = (−u.y, u.x) into the room.
 * A rectangle W × D is [(0,0), (W,0), (W,D), (0,D)]: north, east, south, west, the same as the original model.
 */
import type { PlanPoint, Room, WallRun, WallSide } from '../types';
import { t } from './i18n';

export type Pt = PlanPoint;

export interface Segment {
  index: number;
  p: Pt;
  q: Pt;
  /** Unit direction from p to q. */
  u: Pt;
  /** Unit normal into the room. */
  n: Pt;
  length: number;
  side: WallSide;
}

const SIDE_ORDER: WallSide[] = ['north', 'east', 'south', 'west'];
const EPS = 0.01;

export const rectOutline = (w: number, d: number): Pt[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: d },
  { x: 0, y: d },
];

/** The room's corner points (a rectangle when no outline is stored, as in projects from before #6). */
export const roomOutline = (room: Room): Pt[] => room.outline ?? rectOutline(room.widthCm, room.depthCm);

/** Which compass side a wall faces, from its direction: running east it's a north wall, and so on. */
export function sideOf(u: Pt): WallSide {
  if (Math.abs(u.x) > Math.abs(u.y)) return u.x > 0 ? 'north' : 'south';
  return u.y > 0 ? 'east' : 'west';
}

export function segments(outline: Pt[]): Segment[] {
  return outline.map((p, index) => {
    const q = outline[(index + 1) % outline.length];
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    const u = { x: (q.x - p.x) / (length || 1), y: (q.y - p.y) / (length || 1) };
    return { index, p, q, u, n: { x: -u.y, y: u.x }, length, side: sideOf(u) };
  });
}

/** Outline segment of a wall: its stored `segment`, or for older projects its compass side (N/E/S/W = 0–3). */
export const segmentIndex = (run: WallRun): number =>
  run.segment ?? Math.max(0, SIDE_ORDER.indexOf(run.side ?? 'north'));

/**
 * Corner at the END of segment i (where segment i + 1 starts). Inside: an ordinary room corner (90° inside the
 * room). Outside: the corner of an L that points into the room (270° inside the room).
 */
export function cornerKind(outline: Pt[], i: number): 'inside' | 'outside' {
  const [a, b] = [segments(outline)[i], segments(outline)[(i + 1) % outline.length]];
  return a.u.x * b.u.y - a.u.y * b.u.x > 0 ? 'inside' : 'outside';
}

/**
 * Compass label for every wall (Q3): the direction, numbered in outline order when it occurs more than once
 * ("North 1", "North 2"); unique directions are not numbered, so a rectangle reads North / East / South / West.
 */
export function directionLabels(outline: Pt[]): string[] {
  const segs = segments(outline);
  const total = new Map<WallSide, number>();
  for (const s of segs) total.set(s.side, (total.get(s.side) ?? 0) + 1);
  const seen = new Map<WallSide, number>();
  return segs.map((s) => {
    const k = (seen.get(s.side) ?? 0) + 1;
    seen.set(s.side, k);
    const name = s.side[0].toUpperCase() + s.side.slice(1);
    return total.get(s.side)! > 1 ? `${name} ${k}` : name;
  });
}

/** A wall's compass label in its room ("North 2"), or '' for islands. */
export const wallDirection = (room: Room, run: WallRun): string =>
  run.kind === 'wall' ? (directionLabels(roomOutline(room))[segmentIndex(run)] ?? '') : '';

/** Point inside the outline (or on its boundary). */
export function pointInOutline(outline: Pt[], p: Pt): boolean {
  for (const s of segments(outline)) {
    const along = (p.x - s.p.x) * s.u.x + (p.y - s.p.y) * s.u.y;
    const across = (p.x - s.p.x) * s.n.x + (p.y - s.p.y) * s.n.y;
    if (Math.abs(across) < EPS && along >= -EPS && along <= s.length + EPS) return true;
  }
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [a, b] = [outline[i], outline[j]];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** An axis-aligned rectangle lies inside the outline: its corners are inside and no room corner pokes into it. */
export function rectInOutline(outline: Pt[], r: { x: number; y: number; w: number; h: number }): boolean {
  const corners = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  if (!corners.every((c) => pointInOutline(outline, c))) return false;
  if (outline.some((p) => p.x > r.x + EPS && p.x < r.x + r.w - EPS && p.y > r.y + EPS && p.y < r.y + r.h - EPS)) {
    return false;
  }
  // A wall can also run straight through the rectangle with no corner inside it (the notch of a U between two legs).
  return !segments(outline).some((s) => {
    const horizontal = Math.abs(s.u.x) > 0.5;
    const [line, lo, hi] = horizontal
      ? [s.p.y, Math.min(s.p.x, s.q.x), Math.max(s.p.x, s.q.x)]
      : [s.p.x, Math.min(s.p.y, s.q.y), Math.max(s.p.y, s.q.y)];
    const [r0, r1, a0, a1] = horizontal ? [r.y, r.y + r.h, r.x, r.x + r.w] : [r.x, r.x + r.w, r.y, r.y + r.h];
    return line > r0 + EPS && line < r1 - EPS && hi > a0 + EPS && lo < a1 - EPS;
  });
}

/** The straight line a → b stays inside the room (no wall of the room cuts across it). */
export function lineInOutline(outline: Pt[], a: Pt, b: Pt): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 5));
  for (let t = 0; t <= steps; t++) {
    if (!pointInOutline(outline, { x: a.x + ((b.x - a.x) * t) / steps, y: a.y + ((b.y - a.y) * t) / steps })) {
      return false;
    }
  }
  return true;
}

/**
 * Nearest position (5 cm grid, top-left corner) where a w × h rectangle fits inside the room, closest to `near`;
 * null when it fits nowhere.
 */
export function nearestInside(outline: Pt[], w: number, h: number, near: Pt): Pt | null {
  const box = bounds(outline);
  let best: { p: Pt; d: number } | null = null;
  for (let x = 0; x + w <= box.w + EPS; x += 5) {
    for (let y = 0; y + h <= box.h + EPS; y += 5) {
      const d = Math.hypot(x - near.x, y - near.y);
      if ((!best || d < best.d) && rectInOutline(outline, { x, y, w, h })) best = { p: { x, y }, d };
    }
  }
  return best?.p ?? null;
}

export const bounds = (outline: Pt[]) => ({
  w: Math.max(...outline.map((p) => p.x)) - Math.min(...outline.map((p) => p.x)),
  h: Math.max(...outline.map((p) => p.y)) - Math.min(...outline.map((p) => p.y)),
});

// ---------------------------------------------------------------------------------------------------------------
// Presets and editing (Q1): presets for a quick start, and a wall list whose last horizontal and last vertical wall
// are computed so the outline always closes.

export type ShapePreset = 'rectangle' | 'l_shape' | 'u_shape';

export function presetOutline(preset: ShapePreset, w = 400, d = 300): Pt[] {
  switch (preset) {
    case 'rectangle':
      return rectOutline(w, d);
    case 'l_shape': {
      // The bottom-right corner is cut out: the room is full width at the top and narrower at the bottom.
      const a = Math.round(d / 2);
      const b = Math.round((w * 5) / 8);
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: a },
        { x: b, y: a },
        { x: b, y: d },
        { x: 0, y: d },
      ];
    }
    case 'u_shape': {
      // A notch in the middle of the bottom wall.
      const c = Math.round((w * 3) / 10);
      const e = Math.round(d / 3);
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: d },
        { x: w - c, y: d },
        { x: w - c, y: d - e },
        { x: c, y: d - e },
        { x: c, y: d },
        { x: 0, y: d },
      ];
    }
  }
}

/** Index of the walls the outline closes with: the last horizontal and the last vertical wall. */
export function closingWalls(outline: Pt[]): { horizontal: number; vertical: number } {
  const segs = segments(outline);
  const last = (pred: (s: Segment) => boolean) => [...segs].reverse().find(pred)!.index;
  return { horizontal: last((s) => Math.abs(s.u.x) > 0.5), vertical: last((s) => Math.abs(s.u.y) > 0.5) };
}

/** Two non-adjacent walls touch or cross: the outline folds over itself. */
function selfIntersects(outline: Pt[]): boolean {
  const segs = segments(outline);
  const n = segs.length;
  const box = (s: Segment) => ({
    x0: Math.min(s.p.x, s.q.x),
    x1: Math.max(s.p.x, s.q.x),
    y0: Math.min(s.p.y, s.q.y),
    y1: Math.max(s.p.y, s.q.y),
  });
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const [a, b] = [box(segs[i]), box(segs[j])];
      if (a.x0 <= b.x1 + EPS && b.x0 <= a.x1 + EPS && a.y0 <= b.y1 + EPS && b.y0 <= a.y1 + EPS) return true;
    }
  }
  return false;
}

/**
 * Move wall `index` by `delta` cm along its normal (positive = into the room, so the room gets smaller there). Its two
 * corners move; the walls on either side get longer or shorter. Returns the new outline (bounding box back at 0, 0)
 * and that move, or a sentence explaining why not (a neighbour would vanish or flip, or the room would fold).
 */
export function moveWall(outline: Pt[], index: number, delta: number): { outline: Pt[]; shift: Pt } | string {
  const n = outline.length;
  const before = segments(outline);
  const { n: normal } = before[index];
  const moved = outline.map((p, k) =>
    k === index || k === (index + 1) % n ? { x: p.x + normal.x * delta, y: p.y + normal.y * delta } : { ...p },
  );
  const after = segments(moved);
  for (const k of [(index + n - 1) % n, (index + 1) % n]) {
    if (after[k].length < 1 || after[k].u.x * before[k].u.x + after[k].u.y * before[k].u.y < 0) {
      return t('a wall next to it would get shorter than 1 cm');
    }
  }
  if (selfIntersects(moved)) return t('the room would fold over itself');
  const shift = { x: 0 - Math.min(...moved.map((q) => q.x)), y: 0 - Math.min(...moved.map((q) => q.y)) }; // 0 − min, so no -0
  const round = (v: number) => Math.round(v * 10) / 10;
  return { outline: moved.map((q) => ({ x: round(q.x + shift.x), y: round(q.y + shift.y) })), shift };
}

/**
 * Set wall `index` to `length` cm and re-close the outline by recomputing its closing walls. Returns the new outline
 * (moved so its bounding box starts at 0, 0) and that move, or a sentence explaining why the length can't be used.
 */
export function setWallLength(outline: Pt[], index: number, length: number): { outline: Pt[]; shift: Pt } | string {
  const segs = segments(outline);
  const closing = closingWalls(outline);
  if (index === closing.horizontal || index === closing.vertical) {
    return t('this wall is computed from the others so the room stays closed: change another wall instead');
  }
  if (!(length > 0)) return t('a wall must be longer than 0 cm');
  const lengths = segs.map((s) => (s.index === index ? length : s.length));
  // Closing lengths: whatever brings the walk back to the start, along each closing wall's own direction.
  const sum = (axis: 'x' | 'y', skip: number) =>
    segs.reduce((acc, s, k) => (k === skip ? acc : acc + s.u[axis] * lengths[k]), 0);
  const h = segs[closing.horizontal];
  const v = segs[closing.vertical];
  lengths[closing.horizontal] = -sum('x', closing.horizontal) / h.u.x;
  lengths[closing.vertical] = -sum('y', closing.vertical) / v.u.y;
  if (lengths[closing.horizontal] < 1 || lengths[closing.vertical] < 1) {
    return t(
      'with that length the room would not close: the walls on the other side would have to be shorter than 1 cm',
    );
  }
  let p = { ...outline[0] };
  const walked = segs.map((s, k) => {
    const start = p;
    p = { x: p.x + s.u.x * lengths[k], y: p.y + s.u.y * lengths[k] };
    return { x: Math.round(start.x * 10) / 10, y: Math.round(start.y * 10) / 10 };
  });
  if (selfIntersects(walked)) return t('with that length the room would fold over itself');
  const shift = { x: 0 - Math.min(...walked.map((q) => q.x)), y: 0 - Math.min(...walked.map((q) => q.y)) }; // 0 − min, so no -0
  return { outline: walked.map((q) => ({ x: q.x + shift.x, y: q.y + shift.y })), shift };
}

/**
 * Cut a niche (a recess behind the wall, FEATURES.md #6 phase 2) into wall `index`: `width` cm wide starting `x` cm
 * along the wall, `depth` cm deep. The wall becomes five walls: the part before the niche, the niche's two sides, its
 * back and the part after. Returns the new outline (bounding box back at 0, 0) and that move, or why it can't be cut.
 */
export function nicheOutline(
  outline: Pt[],
  index: number,
  x: number,
  width: number,
  depth: number,
): { outline: Pt[]; shift: Pt } | string {
  const seg = segments(outline)[index];
  if (!seg) return t('that wall no longer exists');
  if (!(width >= 1) || !(depth >= 1)) return t('a niche needs a width and a depth of at least 1 cm');
  if (x < 1 || x + width > seg.length - 1)
    return t("it doesn't fit: leave at least 1 cm of wall on both sides (the wall is {segLength} cm)", {
      segLength: Math.round(seg.length),
    });
  const at = (along: number, out: number) => ({
    x: seg.p.x + seg.u.x * along - seg.n.x * out,
    y: seg.p.y + seg.u.y * along - seg.n.y * out,
  });
  const inserted = [at(x, 0), at(x, depth), at(x + width, depth), at(x + width, 0)];
  const cut = [...outline.slice(0, index + 1), ...inserted, ...outline.slice(index + 1)];
  if (selfIntersects(cut)) return t('the niche would run into another wall of the room');
  const shift = { x: 0 - Math.min(...cut.map((q) => q.x)), y: 0 - Math.min(...cut.map((q) => q.y)) };
  const round = (v: number) => Math.round(v * 10) / 10;
  return { outline: cut.map((q) => ({ x: round(q.x + shift.x), y: round(q.y + shift.y) })), shift };
}
