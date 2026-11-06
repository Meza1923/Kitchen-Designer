import { describe, expect, it } from 'vitest';
import type { KitchenItem, ProjectData } from '../types';
import { createItem, createRoomWalls, DEFAULT_ROOM } from './defaults';
import { describeItem } from './export';
import {
  canCollide,
  canMoveVertically,
  computeGaps,
  computeSocketIssues,
  isWallMounted,
  isWallOnly,
  layerOf,
  normalizeWall,
} from './geometry';
import { checkProject } from './rules';
import { openReach } from './rules/core';

const item = (p: Partial<KitchenItem>): KitchenItem => ({ ...createItem(p.category ?? 'base_cabinet'), ...p });
const north = (items: Partial<KitchenItem>[]): ProjectData => {
  const walls = createRoomWalls({ ...DEFAULT_ROOM });
  walls[0] = normalizeWall({ ...walls[0], items: items.map(item) });
  return { room: { ...DEFAULT_ROOM }, walls, activeWallId: walls[0].id };
};

describe('open wall shelf', () => {
  it('lives on the wall-cabinet layer and moves up and down', () => {
    expect(layerOf('shelf')).toBe('upper');
    expect(canMoveVertically('shelf')).toBe(true);
  });

  it('collides with a wall cabinet at the same height, not with base units', () => {
    expect(canCollide(item({ category: 'shelf', y: 150 }), item({ category: 'upper_cabinet', y: 145 }))).toBe(true);
    expect(canCollide(item({ category: 'shelf', y: 150 }), item({ category: 'base_cabinet' }))).toBe(false);
  });

  it('is too low above a cooktop (R8)', () => {
    const data = north([{ x: 100 }, { category: 'stove', x: 100 }, { category: 'shelf', x: 90, y: 130 }]);
    expect(checkProject(data).filter((v) => v.rule === 'R8')).toHaveLength(1);
  });
});

describe('open cabinets and internal shelves', () => {
  it('open fronts reach nothing into the room', () => {
    expect(openReach(item({ frontType: 'open' }))).toBe(0);
    expect(openReach(item({ frontType: 'doors' }))).toBe(60);
  });

  it('are described in the schedule', () => {
    expect(describeItem(item({ frontType: 'open', shelfCount: 2 }))).toContain('open, 2 shelves');
    expect(describeItem(item({ frontType: 'doors', doorCount: 2, shelfCount: 1 }))).toContain('2 doors, 1 shelf');
    expect(describeItem(item({ frontType: 'doors' }))).not.toContain('shel');
  });
});

describe('review findings for #7', () => {
  const wall = (items: Partial<KitchenItem>[]) => ({
    ...createRoomWalls({ ...DEFAULT_ROOM })[0],
    items: items.map(item),
  });

  it('R1: no gap warning between a shelf and a wall cabinet at different heights', () => {
    const w = wall([
      { category: 'upper_cabinet', x: 0, y: 145 },
      { category: 'shelf', x: 65, y: 115 },
    ]);
    expect(computeGaps(w, 'upper').filter((g) => g.warning)).toEqual([]);
  });

  it('R1: still warns about a narrow gap between two wall cabinets at the same height', () => {
    const w = wall([
      { category: 'upper_cabinet', x: 0 },
      { category: 'upper_cabinet', x: 65 },
    ]);
    expect(
      computeGaps(w, 'upper')
        .filter((g) => g.warning)
        .map((g) => [g.x0, g.x1]),
    ).toEqual([[60, 65]]);
  });

  it('R1: stacked shelves each get their own side gaps, reported once', () => {
    const w = wall([
      { category: 'shelf', x: 3, y: 140 },
      { category: 'shelf', x: 3, y: 180 },
    ]);
    expect(computeGaps(w, 'upper').map((g) => [g.x0, g.x1, g.warning])).toEqual([
      [0, 3, true],
      [83, 400, false],
    ]);
  });

  it('R4: shelves need a wall, and a shelf over a socket hides it', () => {
    expect(isWallOnly('shelf')).toBe(true);
    expect(isWallMounted('shelf')).toBe(false); // still drawn as a normal item in 3D
    const w = wall([
      { category: 'socket', id: 's', x: 100, y: 106 },
      { category: 'shelf', x: 80, y: 108 },
    ]);
    expect(computeSocketIssues(w).map((i) => [i.item.id, i.reason])).toEqual([['s', 'hidden']]);
  });
});
