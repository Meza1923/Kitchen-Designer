import { describe, expect, it } from 'vitest';
import type { KitchenItem, ProjectData } from '../types';
import { createIsland, createItem, createRoomWalls, DEFAULT_ROOM } from './defaults';
import { computeOverlaps, computeSocketIssues, findFreeX, isWallOnly, layerOf } from './geometry';
import { roomOutline } from './outline';
import { itemPlanRect, roomChangeWarnings, syncRoom, wallFrame } from './plan';
import { checkProject } from './rules';
import { addNiche } from './roomShape';

const item = (p: Partial<KitchenItem>): KitchenItem => ({ ...createItem(p.category ?? 'base_cabinet'), ...p });

function room(northItems: Partial<KitchenItem>[] = []): ProjectData {
  const r = { ...DEFAULT_ROOM };
  const walls = createRoomWalls(r);
  walls[0].items = northItems.map(item);
  walls.push({ ...createIsland(r, walls), id: 'isl', planX: 100, planY: 150, widthCm: 120, depthCm: 60 });
  return syncRoom({ room: r, walls, activeWallId: walls[0].id });
}

describe('niches (#6 phase 2)', () => {
  it('cuts a recess into a wall: five walls instead of one, the room grows by its depth', () => {
    const d = room();
    const result = addNiche(d, d.walls[0].id, 150, 100, 30);
    if (typeof result === 'string') throw new Error(result);
    expect(roomOutline(result.room)).toEqual([
      { x: 0, y: 30 },
      { x: 150, y: 30 },
      { x: 150, y: 0 },
      { x: 250, y: 0 },
      { x: 250, y: 30 },
      { x: 400, y: 30 },
      { x: 400, y: 330 },
      { x: 0, y: 330 },
    ]);
    const walls = result.walls.filter((w) => w.kind === 'wall');
    expect(walls.map((w) => [w.name, w.widthCm])).toEqual([
      ['Wall A', 150],
      ['Wall B', 30],
      ['Wall C', 100],
      ['Wall D', 30],
      ['Wall E', 150],
      ['Wall F', 300],
      ['Wall G', 400],
      ['Wall H', 300],
    ]);
    expect(result.walls.find((w) => w.id === 'isl')!.planY).toBe(180); // same place in the room
  });

  it('keeps cabinets where they physically are: before, in and after the niche', () => {
    const d = room([
      { id: 'before', x: 0 },
      { id: 'in', x: 160 },
      { id: 'after', x: 300 },
    ]);
    const result = addNiche(d, d.walls[0].id, 150, 100, 30);
    if (typeof result === 'string') throw new Error(result);
    const where = (id: string) => {
      const run = result.walls.find((w) => w.items.some((i) => i.id === id))!;
      const i = run.items.find((x) => x.id === id)!;
      return { wall: run.name, x: i.x, plan: itemPlanRect(wallFrame(result.room, run), i).x };
    };
    // Plan X doesn't change (the niche is cut northwards; only Y shifts).
    expect(where('before')).toEqual({ wall: 'Wall A', x: 0, plan: 0 });
    expect(where('in')).toEqual({ wall: 'Wall C', x: 10, plan: 160 });
    expect(where('after')).toEqual({ wall: 'Wall E', x: 50, plan: 300 });
  });

  it('refuses a niche that leaves no wall on one side', () => {
    const d = room();
    expect(addNiche(d, d.walls[0].id, 0, 100, 30)).toMatch(/leave at least 1 cm/);
    expect(addNiche(d, d.walls[0].id, 350, 100, 30)).toMatch(/leave at least 1 cm/);
  });
});

describe('columns and pipe boxes (#6 phase 2)', () => {
  it('collide with cabinets at their height, need a wall, and are skipped by new cabinets', () => {
    expect(layerOf('column')).toBe('upper');
    expect(isWallOnly('column')).toBe(true);
    const wall = syncRoom(room([{ category: 'column', id: 'col', x: 60, width: 30, height: 260, depth: 30 }])).walls[0];
    const overlapping = { ...wall, items: [...wall.items, item({ id: 'b', x: 70 })] };
    expect(computeOverlaps(overlapping).map((o) => [o.a, o.b])).toEqual([['col', 'b']]);
    // 0–60 is free, then the column, then free again from 90.
    const full = { ...wall, items: [...wall.items, item({ x: 0 })] };
    expect(findFreeX(full, item({}))).toBe(90);
    // A pipe box near the ceiling doesn't touch a base unit below it.
    const boxed = {
      ...wall,
      items: [
        item({ category: 'column', id: 'box', x: 0, y: 230, width: 100, height: 30, depth: 20 }),
        item({ id: 'b', x: 0 }),
      ],
    };
    expect(computeOverlaps(boxed)).toEqual([]);
  });
});

describe('review finding R16: columns and niches in rules, fixes and warnings', () => {
  const col = { category: 'column' as const, id: 'col', y: 0, width: 30, height: 260, depth: 30 };
  const found = (d: ProjectData, rule: string) => checkProject(d).filter((v) => v.rule === rule);

  it('a filler fix never pushes cabinets into a column', () => {
    // West wall unit in the north-west corner; drawers on the north wall right against it, a column after them.
    const r = { ...DEFAULT_ROOM };
    const walls = createRoomWalls(r);
    walls[3].items = [item({ x: 240 })];
    walls[0].items = [item({ id: 'dr', x: 60, frontType: 'drawers' }), item({ x: 120 }), item({ ...col, x: 180 })];
    const d = syncRoom({ room: r, walls, activeWallId: walls[0].id });
    const r1 = found(d, 'R1')[0];
    const fixed = r1.fix!.apply(d);
    if (typeof fixed === 'string') throw new Error(fixed);
    const north = fixed.walls[0];
    expect(north.items.find((i) => i.id === 'col')!.x).toBe(180);
    expect(computeOverlaps(north)).toEqual([]); // the other cabinet was narrowed instead
  });

  it('a column or hood covering a socket hides it', () => {
    const sockets = [item({ category: 'socket', id: 's', x: 70, y: 105, width: 8, height: 8, depth: 0 })];
    expect(computeSocketIssues({ ...room().walls[0], items: [...sockets, item({ ...col, x: 60 })] })).toMatchObject([
      { reason: 'hidden' },
    ]);
  });

  it('R6 counts a column beside the cooktop; R14 counts a column as the end of a stretch', () => {
    const r = { ...DEFAULT_ROOM };
    const cook = createRoomWalls(r);
    cook[0].items = [item({ ...col, x: 100 }), item({ x: 130 }), item({ category: 'stove', x: 130 })];
    expect(found(syncRoom({ room: r, walls: cook, activeWallId: cook[0].id }), 'R6').length).toBeGreaterThan(0);
    const scribe = createRoomWalls(r);
    scribe[0].items = [item({ x: 0 }), item({ x: 60 }), item({ ...col, x: 120 })];
    expect(found(syncRoom({ room: r, walls: scribe, activeWallId: scribe[0].id }), 'R14').map((v) => v.badge)).toEqual([
      'NO SCRIBE ALLOWANCE',
    ]);
  });

  it('a niche that makes cabinets overlap asks first', () => {
    const d = room([{ x: 140 }, { x: 200 }]);
    const result = addNiche(d, d.walls[0].id, 150, 100, 30);
    if (typeof result === 'string') throw new Error(result);
    expect(roomChangeWarnings(d, result)).toEqual(['The new Wall C (100 cm) gets 2 elements that overlap.']);
  });
});
