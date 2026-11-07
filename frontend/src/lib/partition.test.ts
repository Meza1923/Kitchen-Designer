import { describe, expect, it } from 'vitest';
import type { KitchenItem, ProjectData } from '../types';
import { createItem, createRoomWalls, DEFAULT_ROOM } from './defaults';
import { computeOverlaps, findFreeX, isJoint } from './geometry';
import { addPartition, deletePartition, setPartition } from './partition';
import { partitionRect, roomChangeWarnings, syncRoom, wallFrame } from './plan';
import { dragWall } from './roomShape';
import { checkProject } from './rules';

const item = (p: Partial<KitchenItem>): KitchenItem => ({ ...createItem(p.category ?? 'base_cabinet'), ...p });

/** 400 × 300 room with a partition on the north wall (Wall A), centred: it stands at x 195–205 and is 120 long. */
function withPartition(): ProjectData {
  const room = { ...DEFAULT_ROOM };
  const walls = createRoomWalls(room);
  const next = addPartition(syncRoom({ room, walls, activeWallId: walls[0].id }), walls[0].id);
  if (typeof next === 'string') throw new Error(next);
  return next;
}
const faces = (d: ProjectData) => d.walls.filter((w) => w.kind === 'partition');
const change = (c: { hostX?: number; length?: number }) => {
  const d = withPartition();
  return setPartition(d, faces(d)[0].partitionId!, c);
};
/** The project with items put on runs (by index), re-synced. */
const place = (d: ProjectData, layout: Record<number, Partial<KitchenItem>[]>) =>
  syncRoom({
    ...d,
    walls: d.walls.map((w, k) => (layout[k] ? { ...w, items: [...w.items, ...layout[k].map(item)] } : w)),
  });

describe('partition walls (#10 phase B)', () => {
  it('adds two faces standing on the wall at 90°, with side A active and a joint on the host', () => {
    const d = withPartition();
    const [a, b] = faces(d);
    expect([a.name, b.name]).toEqual(['Partition 1 · A', 'Partition 1 · B']);
    expect(d.activeWallId).toBe(a.id);
    expect([a.hostX, a.widthCm, b.hostX, b.widthCm]).toEqual([195, 120, 195, 120]);
    // Side A runs south from the wall and faces west; side B runs back north and faces east.
    expect(wallFrame(d.room, a)).toEqual({
      origin: { x: 195, y: 0 },
      u: { x: 0, y: 1 },
      n: { x: -1, y: 0 },
      length: 120,
    });
    expect(wallFrame(d.room, b)).toEqual({
      origin: { x: 205, y: 120 },
      u: { x: 0, y: -1 },
      n: { x: 1, y: 0 },
      length: 120,
    });
    expect(partitionRect(d.room, a)).toEqual({ x: 195, y: 0, w: 10, h: 120 });
    expect(d.walls[0].items.filter(isJoint).map((i) => [i.x, i.width])).toEqual([[195, 10]]);
  });

  it('blocks its stretch of the host wall for cabinets', () => {
    const d = withPartition();
    const flush = place(d, { 0: [{ id: 'l', x: 135 }] });
    expect(computeOverlaps(flush.walls[0])).toEqual([]);
    const through = place(d, { 0: [{ id: 'x', x: 160 }] });
    expect(computeOverlaps(through.walls[0]).map((o) => o.a === 'x' || o.b === 'x')).toEqual([true]);
    // A new 60 cm unit after three 60s skips the joint (180 + 60 would cross it at 195).
    const full = place(d, { 0: [{ x: 0 }, { x: 60 }, { x: 120 }] });
    expect(findFreeX(full.walls[0], item({}))).toBe(205);
  });

  it('moves and resizes as one, clamped to the host wall and a minimum length', () => {
    const d = change({ hostX: 900, length: 5 });
    const [a, b] = faces(d);
    expect([a.hostX, a.widthCm, b.hostX, b.widthCm]).toEqual([390, 20, 390, 20]);
    expect(d.walls[0].items.filter(isJoint).map((i) => i.x)).toEqual([390]);
  });

  it('keeps its physical place when the wall before its host is dragged', () => {
    const d = withPartition();
    const result = dragWall(d, d.walls[3].id, 50); // the west wall 50 cm in: the north wall loses 50 cm at its start
    if (typeof result === 'string') throw new Error(result);
    const a = faces(result.data)[0];
    expect(a.hostX).toBe(145);
    expect(wallFrame(result.data.room, a).origin.x + 50).toBe(195);
  });

  it('goes away with its host wall, or when deleted', () => {
    const d = withPartition();
    const removed = syncRoom({
      ...d,
      walls: d.walls.map((w, k) => (k === 0 ? { ...w, removed: true, items: [] } : w)),
    });
    expect(faces(removed)).toEqual([]);
    expect(removed.walls.some((w) => w.id === removed.activeWallId)).toBe(true);
    const deleted = deletePartition(d, faces(d)[0].partitionId!);
    expect(faces(deleted)).toEqual([]);
    expect(deleted.walls[0].items.filter(isJoint)).toEqual([]);
    expect(deleted.activeWallId).toBe(d.walls[0].id);
  });

  it('is flagged when it reaches outside the room', () => {
    const d = change({ length: 400 });
    expect(
      checkProject(d)
        .filter((v) => v.rule === 'outside_room')
        .map((v) => v.message),
    ).toEqual(['Partition 1 · A extends outside the room.']);
  });
});

describe('corner rules at the T-joint', () => {
  const found = (d: ProjectData, rule: string) => checkProject(d).filter((v) => v.rule === rule);

  it('R1: drawers on side A against the host’s corner unit, and the fix', () => {
    const d = place(withPartition(), { 0: [{ id: 'h', x: 135 }], 4: [{ id: 'dr', x: 60, frontType: 'drawers' }] });
    const r1 = found(d, 'R1');
    expect(r1.map((v) => v.items.map((i) => i.itemId))).toEqual([['dr', 'h']]);
    const fixed = r1[0].fix!.apply(d);
    if (typeof fixed === 'string') throw new Error(fixed);
    const sideA = fixed.walls[4].items.map((i) => [i.category, i.x]);
    expect(sideA).toEqual([
      ['base_cabinet', 65],
      ['filler', 60],
    ]);
  });

  it('R1: drawers on the host wall against a unit on side A (the host’s side of the joint)', () => {
    const d = place(withPartition(), { 0: [{ id: 'dr', x: 75, frontType: 'drawers' }], 4: [{ id: 'p', x: 0 }] });
    expect(found(d, 'R1').map((v) => v.items.map((i) => i.itemId))).toEqual([['dr', 'p']]);
  });

  it('R14: a host stretch filled from the room corner to the joint needs scribe fillers', () => {
    const d = place(withPartition(), { 0: [{ x: 0 }, { x: 60 }, { x: 120, width: 75 }] });
    expect(found(d, 'R14').map((v) => v.message)).toEqual([
      'The units on Wall A (0–195 cm) run wall to wall with 0 cm of filler; leave 3–5 cm in total to fit against crooked walls.',
    ]);
  });
});

describe('review findings R12–R14 (#10 phase B)', () => {
  const found = (d: ProjectData, rule: string) => checkProject(d).filter((v) => v.rule === rule);
  const room = (w: number, d: number) => ({ ...DEFAULT_ROOM, widthCm: w, depthCm: d });
  const partitioned = (r: ProjectData['room']) => {
    const walls = createRoomWalls(r);
    const next = addPartition(syncRoom({ room: r, walls, activeWallId: walls[0].id }), walls[0].id);
    if (typeof next === 'string') throw new Error(next);
    return next;
  };

  it('R12: a filler fix never narrows a cabinet on the other side of the partition', () => {
    const d = place(withPartition(), {
      0: [
        { id: 'ref', category: 'fridge', x: 0 },
        { category: 'tall_cabinet', x: 90, width: 45 },
        { x: 135, width: 30 },
        { x: 165, width: 30 },
        { id: 'far', x: 205 },
      ],
    });
    const r2 = found(d, 'R2').find((v) => v.items.some((i) => i.itemId === 'ref'))!;
    const result = r2.fix!.apply(d);
    expect(result).toMatch(/not enough room on Wall A/);
  });

  it('R13: no aisle is measured through a partition', () => {
    // 220 × 300 room: units on the west and east walls 100 cm apart, with the partition (x 105–115) between them.
    const layout = { 3: [{ x: 220 }], 1: [{ x: 20 }] };
    const r = room(220, 300);
    const walls = createRoomWalls(r);
    const open = place(syncRoom({ room: r, walls, activeWallId: walls[0].id }), layout);
    expect(found(open, 'R4').map((v) => v.badge)).toContain('NARROW AISLE');
    expect(found(place(partitioned(r), layout), 'R4')).toEqual([]);
  });

  it('R13: a partition across a work-triangle leg is a wall in the way', () => {
    const d = place(withPartition(), {
      0: [{ x: 30 }, { category: 'sink', x: 30 }, { category: 'fridge', x: 250 }],
      2: [{ x: 170 }, { category: 'stove', x: 170 }],
    });
    expect(found(d, 'R17').map((v) => v.message)).toContain(
      'Partition 1 stands between the fridge and the sink: the work triangle has to go around it.',
    );
  });

  it('R13: a door swinging into a partition is flagged', () => {
    const base = withPartition();
    const d = place(setPartition(base, faces(base)[0].partitionId!, { length: 250 }), {
      2: [{ id: 'door', category: 'door', x: 150, doorSwing: 'in' }],
    });
    expect(found(d, 'door_swing').map((v) => v.message)).toEqual([
      'The swing of Door on Wall C (X 150) is blocked by Partition 1 · A.',
    ]);
  });

  it('R14: shrinking the host wall stops cabinets at the partition', () => {
    const d = place(withPartition(), { 0: [{ x: 205 }, { x: 265 }, { x: 325 }] });
    const after = syncRoom({ ...d, room: { ...d.room, widthCm: 330 } });
    const host = after.walls[0];
    expect(host.items.filter((i) => !isJoint(i)).every((i) => i.x >= 205)).toBe(true);
    expect(computeOverlaps(host).some((o) => o.a.startsWith('joint-') || o.b.startsWith('joint-'))).toBe(false);
  });

  it('R14: a room change that pushes a partition out of the room asks first', () => {
    const base = withPartition();
    const d = setPartition(base, faces(base)[0].partitionId!, { length: 200 });
    const after = syncRoom({ ...d, room: { ...d.room, depthCm: 150 } });
    expect(roomChangeWarnings(d, after)).toContain('Partition 1 no longer fits in the room.');
  });
});
