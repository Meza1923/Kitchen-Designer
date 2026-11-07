import { describe, expect, it } from 'vitest';
import type { KitchenItem, ProjectData, WallRun } from '../types';
import { createIsland, createItem, createRoomWalls, DEFAULT_ROOM } from './defaults';
import { computeOverlaps } from './geometry';
import {
  closingWalls,
  cornerKind,
  directionLabels,
  presetOutline,
  rectInOutline,
  rectOutline,
  segments,
  setWallLength,
} from './outline';
import { computePlanConflicts, itemPlanRect, roomChangeWarnings, runEnds, syncRoom, wallFrame } from './plan';
import { dragWall, reshapeRoom, resizeWall } from './roomShape';
import { checkProject } from './rules';

const item = (p: Partial<KitchenItem>): KitchenItem => ({ ...createItem(p.category ?? 'base_cabinet'), ...p });
const lRoom = () => ({ ...DEFAULT_ROOM, outline: presetOutline('l_shape', 400, 300) });
const lProject = (): ProjectData => {
  const room = lRoom();
  const walls = createRoomWalls(room);
  return syncRoom({ room, walls, activeWallId: walls[0].id });
};
const lengths = (outline: ReturnType<typeof rectOutline>) => segments(outline).map((s) => Math.round(s.length));

describe('outline geometry', () => {
  it('a rectangle is north, east, south, west, in the original order', () => {
    expect(segments(rectOutline(400, 300)).map((s) => [s.side, s.length])).toEqual([
      ['north', 400],
      ['east', 300],
      ['south', 400],
      ['west', 300],
    ]);
    expect(directionLabels(rectOutline(400, 300))).toEqual(['North', 'East', 'South', 'West']);
  });

  it('an L-shaped room has six walls, numbered when a direction repeats (Q3)', () => {
    const l = presetOutline('l_shape', 400, 300);
    expect(lengths(l)).toEqual([400, 150, 150, 150, 250, 300]);
    expect(directionLabels(l)).toEqual(['North', 'East 1', 'South 1', 'East 2', 'South 2', 'West']);
  });

  it('tells inside corners from the outside corner of the L', () => {
    const l = presetOutline('l_shape', 400, 300);
    expect(l.map((_, i) => cornerKind(l, i))).toEqual(['inside', 'inside', 'outside', 'inside', 'inside', 'inside']);
  });

  it('a U-shaped room has eight walls and two outside corners', () => {
    const u = presetOutline('u_shape', 400, 300);
    expect(u).toHaveLength(8);
    expect(u.map((_, i) => cornerKind(u, i)).filter((k) => k === 'outside')).toHaveLength(2);
  });

  it('a rectangle in the cut-out corner of the L is outside the room', () => {
    const l = presetOutline('l_shape', 400, 300);
    expect(rectInOutline(l, { x: 50, y: 50, w: 100, h: 100 })).toBe(true);
    expect(rectInOutline(l, { x: 300, y: 200, w: 50, h: 50 })).toBe(false);
    expect(rectInOutline(l, { x: 200, y: 100, w: 100, h: 100 })).toBe(false); // straddles the outside corner
  });
});

describe('editing wall lengths (the outline always closes)', () => {
  it('the last horizontal and last vertical wall are computed', () => {
    expect(closingWalls(rectOutline(400, 300))).toEqual({ horizontal: 2, vertical: 3 });
    expect(closingWalls(presetOutline('l_shape', 400, 300))).toEqual({ horizontal: 4, vertical: 5 });
  });

  it('a longer north wall makes the closing south wall follow', () => {
    const r = setWallLength(rectOutline(400, 300), 0, 500);
    expect(typeof r === 'string' ? r : lengths(r.outline)).toEqual([500, 300, 500, 300]);
    const l = setWallLength(presetOutline('l_shape', 400, 300), 0, 450);
    expect(typeof l === 'string' ? l : lengths(l.outline)).toEqual([450, 150, 150, 150, 300, 300]);
  });

  it('refuses to edit a closing wall, or a length that would not close', () => {
    expect(setWallLength(rectOutline(400, 300), 2, 300)).toMatch(/computed from the others/);
    expect(setWallLength(presetOutline('l_shape', 400, 300), 2, 420)).toMatch(/would not close/);
    expect(setWallLength(rectOutline(400, 300), 1, 0)).toMatch(/longer than 0/);
  });
});

describe('walls and rules on an L-shaped room', () => {
  it('each wall gets the length and frame of its segment', () => {
    const data = lProject();
    expect(data.walls.map((w) => [w.name, w.side, w.widthCm])).toEqual([
      ['Wall A', 'north', 400],
      ['Wall B', 'east', 150],
      ['Wall C', 'south', 150],
      ['Wall D', 'east', 150],
      ['Wall E', 'south', 250],
      ['Wall F', 'west', 300],
    ]);
    // Wall C runs from the east wall back to the outside corner, with the room to its north.
    expect(wallFrame(data.room, data.walls[2])).toEqual({
      origin: { x: 400, y: 150 },
      u: { x: -1, y: 0 },
      n: { x: -0, y: -1 },
      length: 150,
    });
  });

  it('run ends know inside and outside corners', () => {
    const data = lProject();
    const [, b, c] = data.walls;
    expect(runEnds(data, b).end.kind).toBe('inside_corner');
    expect(runEnds(data, c).end.kind).toBe('outside_corner');
  });

  it('corner rules fire at inside corners only', () => {
    const data = lProject();
    data.walls[0].items = [item({ id: 'f', category: 'fridge', x: 0 })]; // hinge against Wall F: inside corner
    data.walls[2].items = [item({ id: 'g', category: 'fridge', x: 60 })]; // hinge at the tip of the L: outside corner
    const r2 = checkProject(data).filter((v) => v.rule === 'R2');
    expect(r2.map((v) => v.items[0].itemId)).toEqual(['f']);
  });

  it('an island in the cut-out corner is outside the room', () => {
    const data = lProject();
    data.walls.push({
      ...createIsland(data.room, data.walls),
      id: 'isl',
      planX: 280,
      planY: 200,
      widthCm: 100,
      depthCm: 60,
    });
    expect(computePlanConflicts(data).map((c) => [c.a, c.kind])).toEqual([['isl', 'outside']]);
  });
});

describe('switching the room shape', () => {
  it('rectangle → L keeps every wall and its cabinets on the matching wall', () => {
    const room = { ...DEFAULT_ROOM };
    const walls = createRoomWalls(room);
    walls.forEach((w) => (w.items = [item({ id: `on-${w.side}`, x: 0 })]));
    const rect = syncRoom({ room, walls, activeWallId: walls[0].id });
    const { data, dropped } = reshapeRoom(rect, presetOutline('l_shape', 400, 300));
    expect(dropped).toEqual([]);
    expect(data.walls.map((w) => [w.name, w.items.map((i) => i.id)])).toEqual([
      ['Wall A', ['on-north']],
      ['Wall B', ['on-east']],
      ['Wall C', []],
      ['Wall D', []],
      ['Wall E', ['on-south']],
      ['Wall F', ['on-west']],
    ]);
  });

  it('L → rectangle drops the inner walls, reported so their cabinets can be confirmed', () => {
    const l = lProject();
    l.walls[2].items = [item({ x: 0 })];
    const { data, dropped } = reshapeRoom(l, rectOutline(400, 300));
    expect(data.walls.filter((w) => w.kind === 'wall')).toHaveLength(4);
    expect(dropped.map((w) => w.name)).toEqual(['Wall C', 'Wall D']);
  });

  it('renamed walls keep their name, default names follow the new order', () => {
    const room = { ...DEFAULT_ROOM };
    const walls = createRoomWalls(room);
    walls[3].name = 'Window wall';
    const { data } = reshapeRoom(
      syncRoom({ room, walls, activeWallId: walls[0].id }),
      presetOutline('l_shape', 400, 300),
    );
    expect(data.walls.map((w) => w.name)).toEqual(['Wall A', 'Wall B', 'Wall C', 'Wall D', 'Wall E', 'Window wall']);
  });

  it('resizing a wall keeps every wall on its own segment', () => {
    const l = lProject();
    l.walls[1].items = [item({ id: 'b', x: 0 })];
    const resized = resizeWall(l, l.walls[0].id, 450);
    if (typeof resized === 'string') throw new Error(resized);
    expect(resized.walls.map((w) => w.widthCm)).toEqual([450, 150, 150, 150, 300, 300]);
    expect(resized.walls[1].items.map((i) => i.id)).toEqual(['b']);
    expect(resizeWall(l, l.walls[4].id, 100)).toMatch(/computed from the others/);
  });
});

describe('review findings R8–R10 (feature #6 phase 1)', () => {
  const project = (outline: ReturnType<typeof presetOutline>, place: (walls: WallRun[]) => void = () => {}) => {
    const room = { ...DEFAULT_ROOM, outline };
    const walls = createRoomWalls(room);
    place(walls);
    return syncRoom({ room, walls, activeWallId: walls[0].id });
  };

  it('R8: runs facing each other across the notch of a U share no aisle', () => {
    // 220 cm wide U: the notch (x 66–154, y 200–300) stands between the two legs.
    const data = project(presetOutline('u_shape', 220, 300), (walls) => {
      walls[1].items = [item({ x: 220 })]; // East 1, y 220–280
      walls[7].items = [item({ x: 20 })]; // West 2, y 220–280
    });
    expect(checkProject(data).filter((v) => v.rule === 'R4')).toEqual([]);
  });

  it('R8: a wall of the room cutting a leg of the work triangle is reported', () => {
    const data = project(presetOutline('l_shape', 400, 300), (walls) => {
      walls[1].items = [item({ id: 'sink', category: 'sink', x: 45 })]; // East 1
      walls[4].items = [item({ id: 'fridge', category: 'fridge', x: 10 })]; // South 2, across the outside corner
      walls[5].items = [item({ id: 'hob', category: 'stove', x: 120 })]; // West
    });
    const walls = checkProject(data).filter((v) => v.badge === 'WALL IN THE WAY');
    expect(walls.map((v) => v.items.map((i) => i.itemId).sort())).toEqual([['fridge', 'sink']]);
  });

  it('R9: a new island in an L room lands inside the room', () => {
    const room = { ...DEFAULT_ROOM, outline: presetOutline('l_shape', 400, 300) };
    const island = createIsland(room, []);
    expect(
      rectInOutline(room.outline, { x: island.planX!, y: island.planY!, w: island.widthCm, h: island.depthCm! }),
    ).toBe(true);
  });

  it('R9: shortening the leg an island stands in moves it back inside', () => {
    const data = project(presetOutline('l_shape', 400, 300), (walls) =>
      walls.push({
        ...createIsland(DEFAULT_ROOM, walls),
        id: 'isl',
        planX: 140,
        planY: 200,
        widthCm: 100,
        depthCm: 60,
      }),
    );
    const resized = resizeWall(data, data.walls[2].id, 200); // Wall C 150 → 200: the bottom leg narrows to 0–200
    if (typeof resized === 'string') throw new Error(resized);
    expect(computePlanConflicts(resized).filter((c) => c.kind === 'outside')).toEqual([]);
  });

  it('R10: shape-change warnings name the wall as it is called now', () => {
    const rect = project(rectOutline(400, 300), (walls) => {
      walls[2].items = [0, 60, 120, 180, 240, 300].map((x) => item({ x }));
    });
    const { data } = reshapeRoom(rect, presetOutline('l_shape', 400, 300));
    expect(roomChangeWarnings(rect, data)).toEqual([
      'Wall C becomes 250 cm: 3 of its elements no longer fit and will overlap.',
    ]);
  });
});

describe('dragging a wall (phase 1b)', () => {
  const planRectOf = (data: ProjectData, wallIdx: number, itemId: string) => {
    const w = data.walls[wallIdx];
    return itemPlanRect(
      wallFrame(data.room, w),
      w.items.find((i) => i.id === itemId)!,
    );
  };

  it('pulling the north wall of a rectangle in makes the room shallower, nothing else moves physically', () => {
    const room = { ...DEFAULT_ROOM };
    const walls = createRoomWalls(room);
    walls[1].items = [item({ id: 'e', x: 200 })]; // on the east wall, 200 cm from the north-east corner
    walls.push({ ...createIsland(room, walls), id: 'isl', planX: 100, planY: 150, widthCm: 120, depthCm: 60 });
    const data = syncRoom({ room, walls, activeWallId: walls[0].id });
    const result = dragWall(data, walls[0].id, 50);
    if (typeof result === 'string') throw new Error(result);
    const after = result.data;
    expect([after.room.widthCm, after.room.depthCm]).toEqual([400, 250]);
    expect(result.shift).toEqual({ x: 0, y: -50 });
    // Same physical spot = old position plus the plan's shift.
    const before = planRectOf(data, 1, 'e');
    expect(planRectOf(after, 1, 'e')).toEqual({ ...before, y: before.y - 50 });
    expect(after.walls.find((w) => w.id === 'isl')!.planY).toBe(100);
  });

  it('pushing the inner wall of an L outward lengthens one neighbour and shortens the other', () => {
    const l = lProject();
    const result = dragWall(l, l.walls[2].id, -50); // Wall C · South 1, away from the room
    if (typeof result === 'string') throw new Error(result);
    expect(result.data.walls.map((w) => w.widthCm)).toEqual([400, 200, 150, 100, 250, 300]);
  });

  it('refuses a move that would make a neighbour vanish or flip', () => {
    const l = lProject();
    expect(dragWall(l, l.walls[1].id, 160)).toMatch(/shorter than 1 cm/); // East 1 past the tip of the L
  });
});

describe('review finding R11 (phase 1b)', () => {
  it('dragging the previous wall in pushes the next wall’s cabinets forward without piling them up', () => {
    const room = { ...DEFAULT_ROOM };
    const walls = createRoomWalls(room);
    walls[1].items = [item({ id: 'b1', x: 0 }), item({ id: 'b2', x: 60 }), item({ id: 's', category: 'sink', x: 0 })];
    const data = syncRoom({ room, walls, activeWallId: walls[0].id });
    const result = dragWall(data, walls[0].id, 50); // Wall A in by 50: Wall B (300) loses 50 cm at its start
    if (typeof result === 'string') throw new Error(result);
    const east = result.data.walls[1];
    expect(east.widthCm).toBe(250);
    expect(east.items.map((i) => [i.id, i.x])).toEqual([
      ['b1', 0],
      ['b2', 60],
      ['s', 0],
    ]);
    expect(computeOverlaps(east)).toEqual([]);
  });

  it('cabinets further along the wall keep their physical position', () => {
    const room = { ...DEFAULT_ROOM };
    const walls = createRoomWalls(room);
    walls[1].items = [item({ id: 'far', x: 200 })];
    const result = dragWall(syncRoom({ room, walls, activeWallId: walls[0].id }), walls[0].id, 50);
    if (typeof result === 'string') throw new Error(result);
    expect(result.data.walls[1].items[0].x).toBe(150);
  });
});
