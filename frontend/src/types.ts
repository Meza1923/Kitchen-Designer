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
  | 'power_socket'
  /** A chair at an island (#14). */
  | 'stool'
  // Phase C of the design rules (#5)
  | 'dishwasher'
  | 'trash_cabinet'
  | 'hood'
  | 'end_panel'
  /** Column or pipe box against a wall (FEATURES.md #6 phase 2): any width, depth, Y and height. */
  | 'column'
  /** Derived, not user-editable: where a partition wall meets its host wall (FEATURES.md #10). */
  | 'partition_joint';

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
  cooktopType?: 'electric' | 'induction' | 'gas'; // missing means electric (R8: gas needs 75 cm above it)

  // For 'dishwasher' (#11): behind a cabinet front, or its own stainless front. Missing means integrated.
  dishwasherFront?: 'integrated' | 'visible';

  // For 'stool' (#14): bar stool (seat 75 cm) or counter stool (seat 65 cm). Missing means bar.
  stoolType?: 'bar' | 'counter';

  // For 'fridge' (missing means side-by-side)
  fridgeType?: FridgeType;

  // For 'door': hinge side as seen from inside the room, and swing direction.
  // doorHinge also sets the hinge of a tall cabinet's door zones, and of a top/bottom (single-door) fridge.
  doorHinge?: 'left' | 'right';
  doorSwing?: 'in' | 'out';

  // For 'socket': outlets on the plate
  socketCount?: 1 | 2 | 3 | 4;
}

/** A side of an island (#14), or a face of a partition ('a' / 'b'). */
export type IslandFace = 'a' | 'b' | 'left' | 'right';
export type EndProfile = 'none' | 'panel' | 'waterfall';

export type WallSide = 'north' | 'east' | 'south' | 'west';
export type Rotation = 0 | 90 | 180 | 270;

export interface WallRun {
  id: string;
  name: string; // e.g., "Wall A", "Island"
  kind: 'wall' | 'island' | 'partition';
  side?: WallSide; // walls only: the compass side it faces
  segment?: number; // walls only: index of its room-outline segment (missing: derived from `side`)
  removed?: boolean; // walls only: open side of the room (no wall, no items)
  widthCm: number; // run length; for walls derived from the room
  heightCm: number; // ceiling height, synced from the room
  countertopThicknessCm: number; // Default 3
  items: KitchenItem[];

  // Islands (#15): side A holds the countertop — top-left in plan (cm), length (widthCm), depth and rotation.
  // Partition faces: derived from the host (lib/partition.ts): planX/planY = the face's start point, rotationDeg = the
  // direction it runs in (0 = east, 90 = south, 180 = west, 270 = north).
  planX?: number;
  planY?: number;
  depthCm?: number;
  rotationDeg?: Rotation;

  // Partition faces (FEATURES.md #10): a partition wall is two runs, side A and side B, sharing partitionId.
  // Two-sided islands (#9): side B is a second island run with face 'b' and hostId = its side-A island; its
  // position, length and rotation are derived from side A (lib/plan.ts → syncIslandBacks), its depthCm is its own.
  partitionId?: string;
  face?: IslandFace; // partitions: 'a' / 'b'; islands: 'b' (back), 'left' / 'right' (ends), missing = front
  hostId?: string; // partition: the wall it stands on, at 90° (T-joint); island side B: its side-A island
  hostX?: number; // partitions: cm along the host wall to the side-A face

  // Island side A only (#14, #15): the profile at each end of the island. (The overhang is computed.)
  leftProfile?: EndProfile;
  rightProfile?: EndProfile;
}

export interface PlanPoint {
  x: number;
  y: number;
}

export interface Room {
  widthCm: number; // plan X extent (bounding box of the outline)
  depthCm: number; // plan Y extent (bounding box of the outline)
  heightCm: number; // ceiling
  /** Corner points clockwise, 90° corners, bounding box from (0, 0). Missing: the widthCm × depthCm rectangle. */
  outline?: PlanPoint[];
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
