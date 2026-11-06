export type ElementCategory =
  | 'base_cabinet'
  | 'upper_cabinet'
  | 'tall_cabinet'
  | 'corner_blocker'
  | 'filler'
  | 'shelf'
  | 'fridge'
  | 'washing_machine'
  | 'under_counter_oven'
  | 'sink'
  | 'stove'
  | 'water_bar'
  | 'coffee_machine'
  | 'window'
  | 'door'
  | 'socket'
  | 'power_socket';

export type TallZoneType = 'door' | 'drawers' | 'oven' | 'microwave' | 'coffee' | 'open';

/** Side-by-side: 2 doors next to each other · French door: 2 on top, 2 below · Top/bottom: fridge above, freezer below. */
export type FridgeType = 'side_by_side' | 'french_door' | 'top_bottom';

export interface TallZoneConfig {
  id: string;
  type: TallZoneType;
  heightPct: number; // Sum of zones must equal 100%
  drawerCount?: number; // Used if type === 'drawers'
}

export interface KitchenItem {
  id: string;
  category: ElementCategory;
  label?: string;
  x: number; // cm from left wall edge
  y: number; // cm from floor (0 for base/tall/appliances, >0 for upper/window)
  width: number; // cm
  height: number; // cm
  depth: number; // cm, from the wall (or island back line) into the room

  // Cabinet specific properties
  hasToeKick: boolean;
  toeKickHeight: number; // Default 10cm or 12cm

  // For counter-bearing units (base cabinet, under-counter oven, corner blocker): leave out the countertop slab
  noCountertop?: boolean;

  // For 'base_cabinet' and 'upper_cabinet'
  frontType: 'doors' | 'drawers' | 'open'; // 'open' = no doors, shelves visible
  doorCount: 1 | 2;
  drawerCount: number; // 1 to 5
  drawerSplitPcts: number[]; // Array of percentages summing to 100, top to bottom
  shelfCount?: number; // shelves inside the cabinet (0–5); missing means none

  // For 'tall_cabinet' (Tower / Built-in), stacked bottom to top
  tallZones?: TallZoneConfig[];

  // For 'sink'
  sinkBowls?: 1 | 2;
  hasFaucet?: boolean;

  // For 'stove'
  burnerCount?: 4 | 5;

  // For 'fridge' (missing means side-by-side)
  fridgeType?: FridgeType;

  // For 'door': hinge side as seen from inside the room, and swing direction.
  // doorHinge also sets the hinge of a tall cabinet's door zones.
  doorHinge?: 'left' | 'right';
  doorSwing?: 'in' | 'out';

  // For 'socket': outlets on the plate
  socketCount?: 1 | 2 | 3 | 4;
}

export type WallSide = 'north' | 'east' | 'south' | 'west';
export type Rotation = 0 | 90 | 180 | 270;

export interface WallRun {
  id: string;
  name: string; // e.g., "Wall A", "Island"
  kind: 'wall' | 'island';
  side?: WallSide; // walls only
  removed?: boolean; // walls only: open side of the room (no wall, no items)
  widthCm: number; // run length; for walls derived from the room
  heightCm: number; // ceiling height, synced from the room
  countertopThicknessCm: number; // Default 3
  items: KitchenItem[];

  // Islands only: footprint top-left in plan (cm), depth and rotation
  planX?: number;
  planY?: number;
  depthCm?: number;
  rotationDeg?: Rotation;
}

export interface Room {
  widthCm: number; // plan X extent (north / south walls)
  depthCm: number; // plan Y extent (east / west walls)
  heightCm: number; // ceiling
}

export interface ProjectData {
  room: Room;
  walls: WallRun[];
  activeWallId: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updated_at: string;
}

export interface ProjectRecord extends ProjectSummary {
  data: ProjectData;
  created_at: string;
}
