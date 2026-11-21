import { describe, expect, it } from 'vitest';
import type { IslandFace, KitchenItem, ProjectData, WallRun } from '../types';
import { createIsland, createItem, createRoomWalls, DEFAULT_ROOM } from './defaults';
import { applyIslandLayout, ensureIslandSide } from './island';
import {
  islandClearances,
  islandDrawing,
  islandFootprint,
  islandOverhangs,
  planFootprint,
  stoolPoint,
  syncIslandSides,
  syncRoom,
  wallFrame,
} from './plan';
import { checkProject } from './rules';

const item = (p: Partial<KitchenItem>): KitchenItem => ({ ...createItem(p.category ?? 'base_cabinet'), ...p });
const row = (n = 4) => Array.from({ length: n }, (_, k) => item({ x: k * 60 }));

/** 400 × 300 room with a 240 × 92 island at (100, 150), its front facing south (rotation 0). */
function withIsland(patch: Partial<WallRun> = {}, north: Partial<KitchenItem>[] = []): ProjectData {
  const room = { ...DEFAULT_ROOM };
  const walls = createRoomWalls(room);
  walls[0].items = north.map(item);
  walls.push({ ...createIsland(room, walls), id: 'isl', planX: 100, planY: 150, widthCm: 240, depthCm: 92, ...patch });
  return syncRoom({ room, walls, activeWallId: walls[0].id });
}
const island = (d: ProjectData) => d.walls.find((w) => w.id === 'isl')!;
function side(d: ProjectData, face: IslandFace, items: KitchenItem[] = []): ProjectData {
  const ens = ensureIslandSide(d, 'isl', face)!;
  return syncIslandSides({
    ...ens.data,
    walls: ens.data.walls.map((w) => (w.id === ens.side.id ? { ...w, items } : w)),
  });
}
const sideOf = (d: ProjectData, face: IslandFace) => d.walls.find((w) => w.hostId === 'isl' && w.face === face)!;
const rules = (d: ProjectData, rule: string) => checkProject(d).filter((v) => v.rule === rule);

describe('islands, countertop first (#15)', () => {
  it('stands cabinets under the countertop against each edge, fronts just inside it', () => {
    let d = withIsland({ items: row() });
    // Front: 60 cm units with their backs 62 cm in from the south edge (y 242), so their fronts are at y 240.
    expect(wallFrame(d.room, island(d))).toEqual({
      origin: { x: 100, y: 180 },
      u: { x: 1, y: 0 },
      n: { x: 0, y: 1 },
      length: 240,
    });
    d = side(side(side(d, 'b'), 'left'), 'right');
    expect(wallFrame(d.room, sideOf(d, 'b'))).toEqual({
      origin: { x: 340, y: 152 },
      u: { x: -1, y: 0 },
      n: { x: 0, y: -1 },
      length: 240,
    });
    expect(wallFrame(d.room, sideOf(d, 'left'))).toEqual({
      origin: { x: 102, y: 150 },
      u: { x: 0, y: 1 },
      n: { x: -1, y: 0 },
      length: 92,
    });
    expect(wallFrame(d.room, sideOf(d, 'right'))).toEqual({
      origin: { x: 338, y: 242 },
      u: { x: 0, y: -1 },
      n: { x: 1, y: 0 },
      length: 92,
    });
  });

  it('works out the overhang from the countertop and the cabinets', () => {
    expect(islandOverhangs(withIsland({ items: row() }), island(withIsland({ items: row() })))).toMatchObject([
      { face: 'b', cantilever: 30, rect: { x: 100, y: 150, w: 240, h: 30 } },
    ]);
    // Cabinets on both sides: no overhang. Three units on 240 cm: the right end sticks out 60 cm.
    const both = side(withIsland({ items: row() }), 'b', row());
    expect(islandOverhangs(both, island(both))).toEqual([]);
    const short = withIsland({ items: row(3) });
    expect(islandOverhangs(short, island(short)).map((o) => [o.face, o.cantilever])).toEqual([
      ['b', 30],
      ['right', 60],
    ]);
    expect(rules(short, 'R13').map((v) => v.badge)).toEqual(['OVERHANG']);
  });

  it('R13: over 30 cm needs waterfalls at both ends; the fix makes the island less deep', () => {
    const deep = withIsland({ items: row(), depthCm: 102 });
    const r13 = rules(deep, 'R13');
    expect(r13.map((v) => [v.badge, v.fix?.label])).toEqual([['OVERHANG', 'Make the island 92 cm deep']]);
    const fixed = r13[0].fix!.apply(deep);
    if (typeof fixed === 'string') throw new Error(fixed);
    expect(rules(syncRoom(fixed), 'R13')).toEqual([]);
    expect(
      rules(withIsland({ items: row(), depthCm: 102, leftProfile: 'waterfall', rightProfile: 'waterfall' }), 'R13'),
    ).toEqual([]);
  });

  it('chairs stand at the countertop edge and need room for their knees', () => {
    const chair = item({ category: 'stool', id: 'c1', x: 0 });
    const d = side(withIsland({ items: row() }), 'b', [chair]);
    expect(stoolPoint(d, sideOf(d, 'b'), chair)).toEqual({ x: 320, y: 138 });
    expect(planFootprint(d, sideOf(d, 'b'), chair)).toEqual({ x: 300, y: 118, w: 40, h: 40 });
    expect(rules(d, 'R13')).toEqual([]);
    // A 62 cm countertop over 60 cm units: nothing over the knees.
    const tight = side(withIsland({ items: row(), depthCm: 62 }), 'b', [chair]);
    expect(rules(tight, 'R13').map((v) => [v.severity, v.badge])).toEqual([['warning', 'NO KNEE ROOM']]);
    expect(islandFootprint(d, island(d))).toEqual({ x: 100, y: 118, w: 240, h: 124 });
  });

  it('measures the aisle from each side of the island to what faces it', () => {
    // A 60 cm deep unit on the north wall over x 120–180: 150 − 60 = 90 cm to the island's back.
    const d = withIsland({ items: row() }, [{ x: 120 }]);
    const byFace = Object.fromEntries(islandClearances(d, island(d)).map((c) => [c.face, c.distance]));
    expect(byFace).toEqual({ b: 90, right: 60, a: 58, left: 100 });
  });

  it('layouts give a ready island: seating has a 30 cm overhang and chairs, waterfall ends hold a deeper one', () => {
    const seating = applyIslandLayout(withIsland(), 'isl', 'seating');
    expect(island(seating).depthCm).toBe(92);
    expect(sideOf(seating, 'b').items.map((i) => i.category)).toEqual(['stool', 'stool', 'stool', 'stool']);
    expect(rules(seating, 'R13')).toEqual([]);
    const waterfall = applyIslandLayout(withIsland(), 'isl', 'waterfall');
    expect([island(waterfall).depthCm, island(waterfall).leftProfile, island(waterfall).rightProfile]).toEqual([
      102,
      'waterfall',
      'waterfall',
    ]);
    expect(rules(waterfall, 'R13')).toEqual([]);
    const both = applyIslandLayout(withIsland(), 'isl', 'both');
    expect(sideOf(both, 'b').items).toHaveLength(4);
    expect(islandOverhangs(both, island(both))).toEqual([]);
  });

  it('drops the sides of a deleted island', () => {
    const d = side(withIsland(), 'b');
    const gone = syncIslandSides({ ...d, walls: d.walls.filter((w) => w.id !== 'isl') });
    expect(gone.walls.some((w) => w.kind === 'island')).toBe(false);
  });
});

describe('review findings R21–R23 (#15)', () => {
  it('R22: an island with no cabinets yet has no overhang warnings; the next island is numbered by islands', () => {
    const d = withIsland();
    expect(islandOverhangs(d, island(d))).toEqual([]);
    expect(rules(d, 'R13')).toEqual([]);
    const seating = applyIslandLayout(d, 'isl', 'seating'); // adds the island's back side
    expect(createIsland(seating.room, seating.walls).name).toBe('Island 2');
  });

  it('R23: aisles skip open sides of the room and stop at a column', () => {
    const d = withIsland({ items: row() }, [
      { category: 'column', id: 'col', x: 150, y: 0, width: 30, height: 260, depth: 30 },
    ]);
    const north = islandClearances(d, island(d)).find((c) => c.face === 'b')!;
    expect(north.distance).toBe(120); // 150 − 30: to the column, not the wall behind it
    const open = { ...d, walls: d.walls.map((w) => (w.side === 'south' ? { ...w, removed: true } : w)) };
    expect(islandClearances(open, island(open)).some((c) => c.face === 'a')).toBe(false);
  });

  it('R23: an island side is drawn with the island countertop and, at an end, its profile', () => {
    const d = side(withIsland({ items: row(), rightProfile: 'waterfall' }), 'right');
    expect(islandDrawing(d, sideOf(d, 'right'))).toEqual({
      island: { top: 90, thickness: 3 },
      backdrop: { kind: 'waterfall', top: 90 },
    });
    expect(islandDrawing(d, d.walls[0])).toEqual({});
  });
});
