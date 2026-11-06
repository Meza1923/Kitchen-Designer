import { describe, expect, it } from 'vitest';
import type { KitchenItem, ProjectData } from '../types';
import { createItem, createRoomWalls, DEFAULT_ROOM } from './defaults';
import { describeItem } from './export';
import { canCollide, canMoveVertically, layerOf, normalizeWall } from './geometry';
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
