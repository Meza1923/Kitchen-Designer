import { describe, expect, it } from 'vitest';
import type { KitchenItem, ProjectData, WallRun } from '../types';
import { createIsland, createItem, createRoomWalls, DEFAULT_ROOM } from './defaults';
import { computeCountertops, computeOverlaps, findFreeX, normalizeWall, widestGapX } from './geometry';
import { roomChangeWarnings, syncRoom } from './plan';
import { checkProject } from './rules';

const item = (p: Partial<KitchenItem>): KitchenItem => ({ ...createItem(p.category ?? 'base_cabinet'), ...p });
const wall = (items: Partial<KitchenItem>[], widthCm = 400): WallRun => ({
  ...createRoomWalls({ ...DEFAULT_ROOM })[0],
  widthCm,
  items: items.map(item),
});
const project = (north: Partial<KitchenItem>[], extra: (walls: WallRun[]) => void = () => {}): ProjectData => {
  const room = { ...DEFAULT_ROOM };
  const walls = createRoomWalls(room);
  walls[0] = normalizeWall({ ...walls[0], items: north.map(item) });
  extra(walls);
  return { room, walls, activeWallId: walls[0].id };
};

describe('#13 placing a new element when nothing fits', () => {
  it('reports that there is no free slot instead of returning X 0', () => {
    const full = wall([
      { x: 0, width: 200 },
      { x: 200, width: 200 },
    ]);
    expect(findFreeX(full, item({}))).toBeNull();
  });

  it('falls back to the widest gap, so it overlaps as little as possible', () => {
    const w = wall([{ x: 0 }, { x: 70, width: 300 }]); // gaps: 60–70 (10 cm) and 370–400 (30 cm)
    expect(widestGapX(w, item({}))).toBe(340); // clamped so the 60 cm unit stays on the wall
  });

  it('treats a window over wall cabinets the same way', () => {
    const w = wall([
      { category: 'upper_cabinet', x: 0, width: 200 },
      { category: 'upper_cabinet', x: 280, width: 120 },
    ]);
    const win = item({ category: 'window' });
    expect(findFreeX(w, win)).toBeNull();
    expect(widestGapX(w, win)).toBe(200);
  });
});

describe('#14 shrinking the room', () => {
  it('keeps units in order and touching instead of piling them up', () => {
    const data = project([
      { id: 'a', x: 0 },
      { id: 'b', x: 60 },
      { id: 'c', x: 300 },
    ]);
    const shrunk = syncRoom({ ...data, room: { ...data.room, widthCm: 200 } });
    const north = shrunk.walls[0];
    expect(north.items.map((i) => [i.id, i.x])).toEqual([
      ['a', 0],
      ['b', 60],
      ['c', 140],
    ]);
    expect(computeOverlaps(north)).toEqual([]);
    expect(roomChangeWarnings(data, shrunk)).toEqual([]);
  });

  it('moves a sink with its cabinet', () => {
    const data = project([{ x: 300 }, { id: 's', category: 'sink', x: 300 }]);
    const north = syncRoom({ ...data, room: { ...data.room, widthCm: 200 } }).walls[0];
    expect(north.items.find((i) => i.id === 's')!.x).toBe(140);
  });

  it('warns when the units truly no longer fit', () => {
    const data = project([{ x: 0 }, { x: 60 }]);
    const shrunk = syncRoom({ ...data, room: { ...data.room, widthCm: 100 } });
    expect(roomChangeWarnings(data, shrunk)).toEqual([
      'Wall A becomes 100 cm: 2 of its elements no longer fit and will overlap.',
    ]);
  });

  it('moves an island back inside the room when it fits, and warns when it does not', () => {
    // 240 cm island at X 150–390, inside the 400 cm room.
    const data = project([], (walls) => walls.push({ ...createIsland(DEFAULT_ROOM, walls), id: 'isl', planX: 150 }));
    const narrower = syncRoom({ ...data, room: { ...data.room, widthCm: 350 } });
    expect(narrower.walls.find((w) => w.id === 'isl')!.planX).toBe(110);
    expect(roomChangeWarnings(data, narrower)).toEqual([]);
    const tiny = syncRoom({ ...data, room: { ...data.room, widthCm: 200 } });
    expect(roomChangeWarnings(data, tiny)).toEqual(['Island no longer fits in the room.']);
  });
});

describe('#15 fillers next to tall units', () => {
  it('a hinge filler next to a fridge is full height and gets no countertop', () => {
    const data = project([{ id: 'f', category: 'fridge', x: 0 }, { x: 90 }, { x: 150 }]);
    const fix = checkProject(data).find((v) => v.rule === 'R2')!.fix!;
    const fixed = fix.apply(data) as ProjectData;
    const north = fixed.walls[0];
    const filler = north.items.find((i) => i.category === 'filler')!;
    expect([filler.height, filler.depth, filler.hasToeKick]).toEqual([185, 65, false]);
    expect(computeCountertops(north).map((c) => [c.x, c.width])).toEqual([[100, 120]]);
  });

  it('a filler next to a base unit still carries the countertop', () => {
    const w = wall([{ category: 'filler', x: 0, width: 5 }, { x: 5 }, { x: 65 }]);
    expect(computeCountertops(w).map((c) => [c.x, c.width])).toEqual([[0, 125]]);
  });

  it('a filler alone, or between a wall and a fridge, gets no countertop', () => {
    expect(computeCountertops(wall([{ category: 'filler', x: 100, width: 5 }]))).toEqual([]);
    expect(
      computeCountertops(
        wall([
          { category: 'filler', x: 0, width: 10 },
          { category: 'fridge', x: 10 },
        ]),
      ),
    ).toEqual([]);
  });
});

describe('review findings for fix/13-15-placement', () => {
  it('R5: a shelf below a wall cabinet does not push the cabinet when the room shrinks', () => {
    const data = project([
      { id: 'u', category: 'upper_cabinet', x: 200, y: 145 },
      { id: 'sh', category: 'shelf', x: 200, y: 115 },
    ]);
    const north = syncRoom({ ...data, room: { ...data.room, widthCm: 260 } }).walls[0];
    expect(north.items.map((i) => [i.id, i.x])).toEqual([
      ['u', 200],
      ['sh', 180],
    ]);
  });

  it('R5: a tall unit and a window it collides with still push each other', () => {
    const data = project([
      { id: 'w', category: 'window', x: 200 },
      { id: 't', category: 'tall_cabinet', x: 330 },
    ]);
    const north = syncRoom({ ...data, room: { ...data.room, widthCm: 360 } }).walls[0];
    expect(north.items.map((i) => [i.id, i.x])).toEqual([
      ['w', 180],
      ['t', 300],
    ]);
  });

  it('R5: the warning counts the elements that will overlap, across layers too', () => {
    const data = project([
      { category: 'window', x: 0 },
      { category: 'fridge', x: 200 },
    ]);
    const shrunk = syncRoom({ ...data, room: { ...data.room, widthCm: 150 } });
    expect(roomChangeWarnings(data, shrunk)).toEqual([
      'Wall A becomes 150 cm: 2 of its elements no longer fit and will overlap.',
    ]);
  });

  it('R6: a counter item that does not fit stays on the countertop, not in mid-air', () => {
    const cooktop = item({ category: 'stove' });
    // Countertop 0–120 fully taken: it goes onto the countertop (old code: X 120, off the countertop).
    const taken = wall([{ x: 0 }, { x: 60 }, { category: 'sink', x: 0 }, { category: 'stove', x: 60 }]);
    expect(findFreeX(taken, cooktop)).toBeNull();
    expect(widestGapX(taken, cooktop) + cooktop.width).toBeLessThanOrEqual(120);
    // Countertop 0–160 with 40 cm free at 120–160: it starts at the free stretch.
    const partly = wall([{ x: 0 }, { x: 60, width: 100 }, { category: 'sink', x: 0 }, { category: 'stove', x: 60 }]);
    expect(findFreeX(partly, cooktop)).toBeNull();
    expect(widestGapX(partly, cooktop)).toBe(120);
    // No countertop at all.
    expect(widestGapX(wall([]), cooktop)).toBe(0);
  });

  it('R7: a counter item over a full-height filler keeps countertop height', () => {
    const w = normalizeWall(
      wall([
        { category: 'filler', x: 0, width: 10, height: 185 },
        { category: 'fridge', x: 10 },
        { id: 'wb', category: 'water_bar', x: 0 },
      ]),
    );
    expect(w.items.find((i) => i.id === 'wb')!.y).toBe(87);
  });
});
