/**
 * Changing the room's shape (FEATURES.md #6): switching presets and editing wall lengths, keeping each existing wall
 * (with its cabinets) on the matching wall of the new outline.
 */
import type { ProjectData, WallRun } from '../types';
import { uid, wallLetter } from './defaults';
import { bounds, moveWall, roomOutline, segmentIndex, segments, setWallLength, type Pt, type Segment } from './outline';
import { syncRoom } from './plan';

const DEFAULT_NAME = /^Wall [A-Z]+$/;

/**
 * Which old wall goes onto each new segment: the same compass side, preferring one on the same line (most overlap),
 * otherwise the nearest parallel one. Each old wall is used at most once.
 */
function matchWalls(oldSegs: Segment[], walls: WallRun[], newSegs: Segment[]): Map<number, WallRun> {
  const candidates = walls.filter((w) => w.kind === 'wall');
  const scored: { seg: number; wall: WallRun; score: number }[] = [];
  for (const ns of newSegs) {
    for (const w of candidates) {
      const os = oldSegs[segmentIndex(w)];
      if (!os || os.side !== ns.side) continue;
      const horizontal = Math.abs(ns.u.x) > 0.5;
      const lineGap = horizontal ? Math.abs(os.p.y - ns.p.y) : Math.abs(os.p.x - ns.p.x);
      const span = (s: Segment) =>
        horizontal
          ? [Math.min(s.p.x, s.q.x), Math.max(s.p.x, s.q.x)]
          : [Math.min(s.p.y, s.q.y), Math.max(s.p.y, s.q.y)];
      const [a0, a1] = span(os);
      const [b0, b1] = span(ns);
      const overlap = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
      scored.push({ seg: ns.index, wall: w, score: lineGap < 0.5 ? 10000 + overlap : -lineGap });
    }
  }
  const out = new Map<number, WallRun>();
  const used = new Set<string>();
  for (const c of scored.sort((p, q) => q.score - p.score)) {
    if (out.has(c.seg) || used.has(c.wall.id)) continue;
    out.set(c.seg, c.wall);
    used.add(c.wall.id);
  }
  return out;
}

/**
 * The project with a new room outline. Existing walls move to their matching new wall (with their cabinets), new
 * segments get new empty walls, and walls with no match are dropped (returned, so the caller can confirm losing
 * their cabinets). Default names ("Wall A") are re-lettered in outline order; renamed walls keep their name.
 */
export function reshapeRoom(data: ProjectData, outline: Pt[]): { data: ProjectData; dropped: WallRun[] } {
  const oldSegs = segments(roomOutline(data.room));
  const newSegs = segments(outline);
  const match = matchWalls(oldSegs, data.walls, newSegs);
  const walls: WallRun[] = newSegs.map((seg) => {
    const old = match.get(seg.index);
    const name = !old || DEFAULT_NAME.test(old.name) ? `Wall ${wallLetter(seg.index)}` : old.name;
    return old
      ? { ...old, name, segment: seg.index, side: seg.side }
      : {
          id: uid(),
          name,
          kind: 'wall',
          side: seg.side,
          segment: seg.index,
          widthCm: seg.length,
          heightCm: data.room.heightCm,
          countertopThicknessCm: 3,
          items: [],
        };
  });
  const kept = new Set(walls.map((w) => w.id));
  const dropped = data.walls.filter((w) => w.kind === 'wall' && !kept.has(w.id));
  const islands = data.walls.filter((w) => w.kind === 'island');
  const box = bounds(outline);
  const room = { ...data.room, outline, widthCm: box.w, depthCm: box.h };
  const activeWallId = [...walls, ...islands].some((w) => w.id === data.activeWallId) ? data.activeWallId : walls[0].id;
  return { data: syncRoom({ ...data, room, walls: [...walls, ...islands], activeWallId }), dropped };
}

/**
 * The project with one wall set to `length` cm; the outline's closing walls adapt so the room stays closed.
 * Islands keep their place in the room when the outline's top-left moves. Returns a sentence when not possible.
 */
export function resizeWall(data: ProjectData, wallId: string, length: number): ProjectData | string {
  const wall = data.walls.find((w) => w.id === wallId);
  if (!wall || wall.kind !== 'wall') return 'that wall no longer exists';
  const result = setWallLength(roomOutline(data.room), segmentIndex(wall), length);
  if (typeof result === 'string') return result;
  // Same corners in the same order: every wall stays on its own segment, only lengths change.
  const { shift, outline } = result;
  const walls = data.walls.map((w) =>
    w.kind === 'island' ? { ...w, planX: (w.planX ?? 0) + shift.x, planY: (w.planY ?? 0) + shift.y } : w,
  );
  const box = bounds(outline);
  return syncRoom({ ...data, room: { ...data.room, outline, widthCm: box.w, depthCm: box.h }, walls });
}

/**
 * The project with wall `wallId` pulled `delta` cm along its normal (positive = into the room). The neighbouring walls
 * follow; cabinets on the next wall keep their physical position (that wall's start moved), and islands keep their
 * place in the room. Also returns how far the plan's coordinates moved (the room's top-left is always 0, 0), so a
 * view can follow. Returns a sentence when the move isn't possible.
 */
export function dragWall(data: ProjectData, wallId: string, delta: number): { data: ProjectData; shift: Pt } | string {
  const wall = data.walls.find((w) => w.id === wallId);
  if (!wall || wall.kind !== 'wall') return 'that wall no longer exists';
  const outline = roomOutline(data.room);
  const index = segmentIndex(wall);
  const result = moveWall(outline, index, delta);
  if (typeof result === 'string') return result;
  const segs = segments(outline);
  const moved = segs[index];
  const next = segs[(index + 1) % segs.length];
  // How far the next wall's start slid along that wall: shift its cabinets back by the same amount.
  const slide = delta * (moved.n.x * next.u.x + moved.n.y * next.u.y);
  const { shift } = result;
  const walls = data.walls.map((w) => {
    if (w.kind === 'island') return { ...w, planX: (w.planX ?? 0) + shift.x, planY: (w.planY ?? 0) + shift.y };
    if (segmentIndex(w) === next.index && slide !== 0)
      return { ...w, items: w.items.map((i) => ({ ...i, x: i.x - slide })) };
    return w;
  });
  const box = bounds(result.outline);
  const room = { ...data.room, outline: result.outline, widthCm: box.w, depthCm: box.h };
  return { data: syncRoom({ ...data, room, walls }), shift };
}
