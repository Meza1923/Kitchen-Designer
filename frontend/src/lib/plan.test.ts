import { describe, expect, it } from 'vitest';
import type { KitchenItem, ProjectData, WallRun, WallSide } from '../types';
import { createIsland, createItem, createRoomWalls, DEFAULT_ROOM } from './defaults';
import { migrateProjectData } from './migrate';
import { computePlanConflicts, islandRect, itemPlanRect, planPointToWallX, syncRoom, toPlan, wallFrame } from './plan';

const room = { ...DEFAULT_ROOM }; // 400 × 300 × 260

const project = (place: (walls: WallRun[]) => void): ProjectData => {
  const walls = createRoomWalls(room);
  place(walls);
  return { room, walls, activeWallId: walls[0].id };
};

const wallOn = (walls: WallRun[], side: WallSide) => walls.find((w) => w.side === side)!;

const item = (category: KitchenItem['category'], props: Partial<KitchenItem> = {}): KitchenItem => ({
  ...createItem(category),
  ...props,
});

describe('wallFrame / toPlan', () => {
  // Spec mapping: North (x, d) · East (W − d, x) · South (W − x, D − d) · West (d, D − x)
  it.each<[WallSide, { x: number; y: number }]>([
    ['north', { x: 50, y: 10 }],
    ['east', { x: 390, y: 50 }],
    ['south', { x: 350, y: 290 }],
    ['west', { x: 10, y: 250 }],
  ])('maps wall-local (50, depth 10) on the %s wall', (side, expected) => {
    const f = wallFrame(room, wallOn(createRoomWalls(room), side));
    expect(toPlan(f, 50, 10)).toEqual(expected);
  });

  it('uses the room side as the wall length', () => {
    const walls = createRoomWalls(room);
    expect(wallFrame(room, wallOn(walls, 'north')).length).toBe(400);
    expect(wallFrame(room, wallOn(walls, 'east')).length).toBe(300);
  });

  it('planPointToWallX inverts toPlan along the wall', () => {
    for (const side of ['north', 'east', 'south', 'west'] as const) {
      const f = wallFrame(room, wallOn(createRoomWalls(room), side));
      expect(planPointToWallX(f, toPlan(f, 123, 40))).toBeCloseTo(123);
    }
  });
});

describe('islands', () => {
  it('swaps footprint width and depth when rotated by 90°', () => {
    const island = { ...createIsland(room, []), planX: 10, planY: 20, widthCm: 200, depthCm: 90 };
    expect(islandRect(island)).toEqual({ x: 10, y: 20, w: 200, h: 90 });
    expect(islandRect({ ...island, rotationDeg: 90 })).toEqual({ x: 10, y: 20, w: 90, h: 200 });
  });

  it('places island items relative to the island footprint', () => {
    const island = { ...createIsland(room, []), planX: 100, planY: 100, rotationDeg: 0 as const };
    const f = wallFrame(room, island);
    expect(itemPlanRect(f, item('base_cabinet', { x: 0 }))).toEqual({ x: 100, y: 100, w: 60, h: 60 });
  });
});

describe('computePlanConflicts', () => {
  it('reports units clashing in a corner', () => {
    const data = project((walls) => {
      wallOn(walls, 'north').items.push(item('base_cabinet', { id: 'n', x: 0 }));
      wallOn(walls, 'west').items.push(item('base_cabinet', { id: 'w', x: 250 })); // west x=250 → plan y 0..50
    });
    const conflicts = computePlanConflicts(data);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ a: 'n', b: 'w', kind: 'clash' });
  });

  it('does not report units on the same wall (handled by the elevation)', () => {
    const data = project((walls) => {
      wallOn(walls, 'north').items.push(item('base_cabinet', { x: 0 }), item('base_cabinet', { x: 30 }));
    });
    expect(computePlanConflicts(data)).toEqual([]);
  });

  it('reports an island outside the room', () => {
    const data = project((walls) => walls.push({ ...createIsland(room, walls), id: 'isl', planX: 300 }));
    expect(computePlanConflicts(data)).toEqual([expect.objectContaining({ a: 'isl', kind: 'outside' })]);
  });

  it('reports an inward door swing hitting a unit on another wall', () => {
    const data = project((walls) => {
      wallOn(walls, 'north').items.push(item('door', { id: 'door', x: 0, width: 90 }));
      wallOn(walls, 'west').items.push(item('base_cabinet', { id: 'w', x: 200 })); // plan y 40..100
    });
    expect(computePlanConflicts(data)).toEqual([expect.objectContaining({ a: 'door', b: 'w', kind: 'swing' })]);
  });

  it('ignores outward-opening doors', () => {
    const data = project((walls) => {
      wallOn(walls, 'north').items.push(item('door', { x: 0, width: 90, doorSwing: 'out' }));
      wallOn(walls, 'west').items.push(item('base_cabinet', { x: 200 }));
    });
    expect(computePlanConflicts(data)).toEqual([]);
  });
});

describe('syncRoom', () => {
  it('resizes walls and heights from the room and clamps items', () => {
    const data = project((walls) => wallOn(walls, 'north').items.push(item('base_cabinet', { id: 'b', x: 300 })));
    const synced = syncRoom({ ...data, room: { widthCm: 320, depthCm: 250, heightCm: 240 } });
    const north = wallOn(synced.walls, 'north');
    expect([north.widthCm, north.heightCm]).toEqual([320, 240]);
    expect(wallOn(synced.walls, 'east').widthCm).toBe(250);
    expect(north.items[0].x).toBe(260);
  });
});

describe('migrateProjectData', () => {
  it('turns legacy walls into room walls plus islands and fills in depths', () => {
    const legacyWall = (id: string, widthCm: number) => ({
      id,
      name: id,
      widthCm,
      heightCm: 250,
      countertopThicknessCm: 3,
      items: [] as Omit<KitchenItem, 'depth'>[],
    });
    const { depth: _depth, ...noDepth } = item('base_cabinet');
    const walls = ['a', 'b', 'c', 'd', 'e'].map((id, i) => legacyWall(id, i % 2 ? 280 : 380));
    walls[0].items.push(noDepth);

    const migrated = migrateProjectData({ walls, activeWallId: 'e' });

    expect(migrated.room).toEqual({ widthCm: 380, depthCm: 280, heightCm: 250 });
    expect(migrated.walls.map((w) => [w.id, w.kind, w.side])).toEqual([
      ['a', 'wall', 'north'],
      ['b', 'wall', 'east'],
      ['c', 'wall', 'south'],
      ['d', 'wall', 'west'],
      ['e', 'island', undefined],
    ]);
    expect(migrated.walls[0].items[0].depth).toBe(60);
    expect(migrated.activeWallId).toBe('e');
  });

  it('leaves current-format data intact', () => {
    const data = project((walls) => wallOn(walls, 'north').items.push(item('base_cabinet', { x: 10 })));
    expect(migrateProjectData(data)).toEqual(data);
  });
});
