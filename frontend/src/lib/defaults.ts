import type {
  ElementCategory,
  KitchenItem,
  ProjectData,
  Room,
  TallZoneConfig,
  TallZoneType,
  WallRun,
  WallSide,
} from '../types';

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export const CATEGORY_LABELS: Record<ElementCategory, string> = {
  base_cabinet: 'Base Cabinet',
  upper_cabinet: 'Upper Wall Cabinet',
  tall_cabinet: 'Tall Tower Cabinet',
  corner_blocker: 'Corner Blocker',
  fridge: 'Fridge',
  washing_machine: 'Washing Machine',
  under_counter_oven: 'Under-Counter Oven',
  sink: 'Sink',
  stove: 'Stove (Cooktop)',
  water_bar: 'Water Bar',
  coffee_machine: 'Coffee Machine',
  window: 'Window',
  door: 'Door',
  socket: 'Socket',
  power_socket: 'Power Socket 16A',
};

export const TALL_ZONE_LABELS: Record<TallZoneType, string> = {
  drawers: 'Drawers',
  oven: 'Built-in Oven',
  microwave: 'Microwave',
  coffee: 'Coffee Machine',
  door: 'Cabinet Door',
  open: 'Open Shelf',
};

export const WIDTH_PRESETS = [30, 40, 45, 60, 80, 90, 100, 120];
export const DEPTH_PRESETS = [35, 45, 60, 65];

export const SIDE_LABELS: Record<WallSide, string> = { north: 'North', east: 'East', south: 'South', west: 'West' };
export const WALL_SIDES: WallSide[] = ['north', 'east', 'south', 'west'];

export const DEFAULT_ROOM: Room = { widthCm: 400, depthCm: 300, heightCm: 260 };

export const DEFAULT_BASE_HEIGHT = 87;

interface Spec {
  width: number;
  height: number;
  depth: number;
  y: number;
  toeKick: number;
}

const SPECS: Record<ElementCategory, Spec> = {
  base_cabinet: { width: 60, height: 87, depth: 60, y: 0, toeKick: 10 },
  upper_cabinet: { width: 60, height: 70, depth: 35, y: 145, toeKick: 0 },
  tall_cabinet: { width: 60, height: 215, depth: 60, y: 0, toeKick: 10 },
  corner_blocker: { width: 65, height: 87, depth: 60, y: 0, toeKick: 10 },
  fridge: { width: 90, height: 185, depth: 65, y: 0, toeKick: 0 },
  washing_machine: { width: 60, height: 85, depth: 60, y: 0, toeKick: 0 },
  under_counter_oven: { width: 60, height: 87, depth: 60, y: 0, toeKick: 10 },
  sink: { width: 60, height: 20, depth: 45, y: DEFAULT_BASE_HEIGHT, toeKick: 0 },
  stove: { width: 60, height: 5, depth: 52, y: DEFAULT_BASE_HEIGHT, toeKick: 0 },
  water_bar: { width: 30, height: 45, depth: 40, y: DEFAULT_BASE_HEIGHT, toeKick: 0 },
  coffee_machine: { width: 35, height: 40, depth: 40, y: DEFAULT_BASE_HEIGHT, toeKick: 0 },
  window: { width: 120, height: 100, depth: 0, y: 105, toeKick: 0 },
  door: { width: 90, height: 210, depth: 0, y: 0, toeKick: 0 },
  // Wall sockets: y is the plate's bottom edge; the default centre height is 110 cm.
  socket: { width: 8, height: 8, depth: 0, y: 106, toeKick: 0 },
  power_socket: { width: 9, height: 9, depth: 0, y: 105.5, toeKick: 0 },
};

export const SOCKET_HEIGHT_PRESETS = [30, 60, 110, 120];

/** Plate width for a socket with `n` outlets (8 cm single plate, +7 cm per extra outlet). */
export const socketWidth = (n: number) => 8 + 7 * (n - 1);

export function socketName(item: Pick<KitchenItem, 'category' | 'socketCount'>): string {
  if (item.category === 'power_socket') return 'Power socket 16A';
  return `${['Single', 'Double', 'Triple', 'Quadruple'][(item.socketCount ?? 1) - 1]} socket`;
}

export const defaultDepth = (c: ElementCategory) => SPECS[c].depth;

export const equalSplit = (count: number): number[] => {
  const base = Math.floor((100 / count) * 100) / 100;
  const pcts = Array.from({ length: count }, () => base);
  pcts[count - 1] = Math.round((100 - base * (count - 1)) * 100) / 100;
  return pcts;
};

export const makeZone = (type: TallZoneType, heightPct: number): TallZoneConfig => ({
  id: uid(),
  type,
  heightPct,
  ...(type === 'drawers' ? { drawerCount: 3 } : {}),
});

export function createItem(category: ElementCategory): KitchenItem {
  const s = SPECS[category];
  const item: KitchenItem = {
    id: uid(),
    category,
    x: 0,
    y: s.y,
    width: s.width,
    height: s.height,
    depth: s.depth,
    hasToeKick: s.toeKick > 0,
    toeKickHeight: s.toeKick > 0 ? s.toeKick : 10,
    frontType: 'doors',
    doorCount: 1,
    drawerCount: 3,
    drawerSplitPcts: equalSplit(3),
  };
  if (category === 'tall_cabinet') {
    item.tallZones = [makeZone('drawers', 40), makeZone('oven', 28), makeZone('door', 32)];
  }
  if (category === 'sink') {
    item.sinkBowls = 1;
    item.hasFaucet = true;
  }
  if (category === 'stove') item.burnerCount = 4;
  if (category === 'socket') item.socketCount = 1;
  if (category === 'door') {
    item.doorHinge = 'left';
    item.doorSwing = 'in';
  }
  return item;
}

const WALL_LETTERS = 'ABCD';

/** The four fixed room walls, A–D clockwise from north, sized from the room. */
export function createRoomWalls(room: Room): WallRun[] {
  return WALL_SIDES.map((side, i) => ({
    id: uid(),
    name: `Wall ${WALL_LETTERS[i]}`,
    kind: 'wall',
    side,
    widthCm: side === 'north' || side === 'south' ? room.widthCm : room.depthCm,
    heightCm: room.heightCm,
    countertopThicknessCm: 3,
    items: [],
  }));
}

/** A new island centred in the room. */
export function createIsland(room: Room, existing: WallRun[]): WallRun {
  const n = existing.filter((w) => w.kind === 'island').length;
  const widthCm = Math.min(240, Math.max(60, room.widthCm - 120));
  const depthCm = 90;
  return {
    id: uid(),
    name: n ? `Island ${n + 1}` : 'Island',
    kind: 'island',
    widthCm,
    heightCm: room.heightCm,
    countertopThicknessCm: 3,
    items: [],
    planX: Math.round((room.widthCm - widthCm) / 2),
    planY: Math.round((room.depthCm - depthCm) / 2),
    depthCm,
    rotationDeg: 0,
  };
}

export function createProjectData(): ProjectData {
  const room = { ...DEFAULT_ROOM };
  const walls = createRoomWalls(room);
  return { room, walls, activeWallId: walls[0].id };
}
