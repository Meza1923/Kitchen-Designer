import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { KitchenItem, ProjectData, WallRun } from '../types';
import { boxHeight, computeCountertops, fridgeDoors, isElectrical, isOpening, isWallMounted } from './geometry';
import {
  countertopRects,
  islandRect,
  localRect,
  toPlan,
  wallFrame,
  WALL_THICKNESS_CM,
  type Frame,
  type Pt,
  type Rect,
} from './plan';

/**
 * Builds a shaded 3D model of the project. Units are cm; plan X → three X, plan Y → three Z, height → three Y.
 * Every mesh of a kitchen item carries `userData.itemId` / `userData.runId` for picking. Each wall is its own
 * group with `userData.wall = { point, normal }` (inner face, normal into the room) so the viewer can hide
 * walls that stand between the camera and the room.
 */

const C = {
  floor: 0xe7e5e4,
  wall: 0xf5f5f4,
  carcass: 0xf1f5f9,
  front: 0xffffff,
  plinth: 0x94a3b8,
  counter: 0xd6d3d1,
  handle: 0x475569,
  dark: 0x1e293b,
  steel: 0xe2e8f0,
  hatch: 0xcbd5e1,
  sink: 0x9ca3af,
  hob: 0x111827,
  glass: 0xbae6fd,
  door: 0xd6c7b0,
  open: 0xcbd5e1,
};

const FRONT = 1.8; // front panel thickness (cm)
const GAP = 0.3; // reveal between fronts (cm)
const T = WALL_THICKNESS_CM;

export interface WallMeta {
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

/** Appliance finishes; the plain `mat` colours stay matte for cabinets, walls and counters. */
const FINISHES = {
  steel: { color: 0xd1d5db, metalness: 0.9, roughness: 0.38 },
  chrome: { color: 0xe5e7eb, metalness: 0.9, roughness: 0.18 },
  glossWhite: { color: 0xe5e9ee, roughness: 0.35 },
  glossBlack: { color: 0x1f2937, roughness: 0.3 },
  blackGlass: { color: 0x0b1120, roughness: 0.08 },
  screen: { color: 0x0f172a, roughness: 0.1, emissive: 0x38bdf8, emissiveIntensity: 0.55 },
  led: { color: 0xe0f2fe, emissive: 0x7dd3fc, emissiveIntensity: 1 },
  ceramic: { color: 0xffffff, roughness: 0.45 },
  waterGlass: { color: 0xbae6fd, roughness: 0.05, opacity: 0.45, depthWrite: false },
} satisfies Record<string, THREE.MeshStandardMaterialParameters>;
type Finish = keyof typeof FINISHES;

class Builder {
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  readonly edge = new THREE.LineBasicMaterial({ color: 0x334155 });
  readonly edgeSelected = new THREE.LineBasicMaterial({ color: 0x2563eb });

  private special = new Map<string, THREE.MeshStandardMaterial>();

  constructor(
    public selectedId: string | null,
    /** Environment map for reflective appliance materials; without one they fall back to a duller look. */
    private envMap: THREE.Texture | null = null,
  ) {}

  /** Appliance surface finish (see FINISHES), reflecting the environment map when there is one. */
  finish(name: Finish) {
    let m = this.special.get(name);
    if (!m) {
      const { metalness = 0, ...rest }: THREE.MeshStandardMaterialParameters = FINISHES[name];
      // Without reflections, metal renders almost black; tone it down.
      m = new THREE.MeshStandardMaterial({
        ...rest,
        metalness: this.envMap ? metalness : metalness * 0.3,
        envMap: this.envMap,
        transparent: rest.opacity !== undefined,
      });
      this.special.set(name, m);
    }
    return m;
  }

  /** Box over plan rect `r` between heights y0..y1 with rounded edges and no outline (appliance bodies, doors). */
  roundedBox(
    parent: THREE.Object3D,
    r: Rect,
    y0: number,
    y1: number,
    material: THREE.Material,
    radius: number,
    o: { item?: KitchenItem; run?: WallRun } = {},
  ) {
    const h = y1 - y0;
    if (r.w <= 0.01 || r.h <= 0.01 || h <= 0.01) return;
    const geom = new RoundedBoxGeometry(r.w, h, r.h, 4, Math.min(radius, r.w / 2, h / 2, r.h / 2));
    const mesh = new THREE.Mesh(geom, material);
    mesh.position.set(r.x + r.w / 2, y0 + h / 2, r.y + r.h / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    if (o.item) mesh.userData = { itemId: o.item.id, runId: o.run?.id };
    parent.add(mesh);
  }

  /** Cylinder centred at plan point `p`, height `y`; vertical, or pointing along `axis` (a plan direction). */
  cylinder(
    parent: THREE.Object3D,
    p: Pt,
    y: number,
    radius: number,
    length: number,
    material: THREE.Material,
    axis: Pt | null,
    o: { item?: KitchenItem; run?: WallRun } = {},
  ) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 20), material);
    mesh.position.set(p.x, y, p.y);
    if (axis) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(axis.x, 0, axis.y));
    mesh.castShadow = !material.transparent; // transparent shadows render as dithered noise
    if (o.item) mesh.userData = { itemId: o.item.id, runId: o.run?.id };
    parent.add(mesh);
  }

  /** Selection outline only (for items drawn without edges). */
  outline(parent: THREE.Object3D, r: Rect, y0: number, y1: number) {
    const h = y1 - y0;
    const lines = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(r.w, h, r.h)),
      this.edgeSelected,
    );
    lines.position.set(r.x + r.w / 2, y0 + h / 2, r.y + r.h / 2);
    lines.raycast = () => {};
    parent.add(lines);
  }

  mat(color: number, opacity = 1) {
    const key = `${color}:${opacity}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, transparent: opacity < 1, opacity });
      this.mats.set(key, m);
    }
    return m;
  }

  /** Axis-aligned box over plan rect `r` between heights y0..y1. */
  box(
    parent: THREE.Object3D,
    r: Rect,
    y0: number,
    y1: number,
    color: number,
    o: { opacity?: number; edges?: boolean; item?: KitchenItem; run?: WallRun } = {},
  ) {
    const h = y1 - y0;
    if (r.w <= 0.01 || r.h <= 0.01 || h <= 0.01) return;
    const geom = new THREE.BoxGeometry(r.w, h, r.h);
    const mesh = new THREE.Mesh(geom, this.mat(color, o.opacity));
    mesh.position.set(r.x + r.w / 2, y0 + h / 2, r.y + r.h / 2);
    mesh.castShadow = mesh.receiveShadow = (o.opacity ?? 1) === 1;
    if (o.item) mesh.userData = { itemId: o.item.id, runId: o.run?.id };
    parent.add(mesh);
    if (o.edges !== false) {
      const lines = new THREE.LineSegments(
        new THREE.EdgesGeometry(geom),
        o.item?.id === this.selectedId ? this.edgeSelected : this.edge,
      );
      lines.position.copy(mesh.position);
      lines.raycast = () => {}; // edges never steal clicks
      parent.add(lines);
    }
  }

  /** A disc (washer drum, burner) facing out of the run along its normal. */
  disc(
    parent: THREE.Object3D,
    f: Frame,
    along: number,
    depth: number,
    y: number,
    radius: number,
    color: number,
    flatOnTop = false,
  ) {
    const geom = new THREE.CylinderGeometry(radius, radius, 0.6, 32);
    const mesh = new THREE.Mesh(geom, this.mat(color));
    const p = toPlan(f, along, depth);
    mesh.position.set(p.x, y, p.y);
    if (!flatOnTop) {
      // Cylinder axis is +Y; turn it to point along the run's normal.
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(f.n.x, 0, f.n.y));
    }
    parent.add(mesh);
  }
}

interface Panel {
  a0: number;
  a1: number;
  y0: number;
  y1: number;
  color?: number;
  /** Optional dark window inset (oven, microwave, coffee) as fractions of the panel. */
  window?: { fa0: number; fa1: number; fy0: number; fy1: number };
  handle?: 'top' | 'bottom' | 'middle' | 'drawer';
  hinge?: 'left' | 'right';
}

/** Front panels (doors / drawers / zones) of a cabinet box spanning a0..a1 × y0..y1. */
function frontPanels(item: KitchenItem, a0: number, a1: number, y0: number, y1: number): Panel[] {
  const g = GAP;
  const doors = (count: number, handle: Panel['handle'], ya = y0, yb = y1, hinge: Panel['hinge'] = 'left'): Panel[] =>
    count === 2
      ? [
          { a0: a0 + g, a1: (a0 + a1) / 2 - g / 2, y0: ya + g, y1: yb - g, handle, hinge: 'left' },
          { a0: (a0 + a1) / 2 + g / 2, a1: a1 - g, y0: ya + g, y1: yb - g, handle, hinge: 'right' },
        ]
      : [{ a0: a0 + g, a1: a1 - g, y0: ya + g, y1: yb - g, handle, hinge }];
  const drawers = (pcts: number[], ya = y0, yb = y1): Panel[] => {
    const total = pcts.reduce((s, p) => s + p, 0) || 1;
    let top = yb;
    return pcts.map((p) => {
      const h = ((yb - ya) * p) / total;
      const panel: Panel = { a0: a0 + g, a1: a1 - g, y0: top - h + g / 2, y1: top - g / 2, handle: 'drawer' };
      top -= h;
      return panel;
    });
  };

  switch (item.category) {
    case 'base_cabinet':
    case 'upper_cabinet':
      if (item.frontType === 'open') return [];
      if (item.frontType === 'drawers') {
        const pcts =
          item.drawerSplitPcts.length === item.drawerCount ? item.drawerSplitPcts : Array(item.drawerCount).fill(1);
        return drawers(pcts);
      }
      return doors(item.doorCount, item.category === 'upper_cabinet' ? 'bottom' : 'top');
    case 'tall_cabinet': {
      const zones = item.tallZones ?? [];
      const total = zones.reduce((s, z) => s + z.heightPct, 0) || 1;
      let bottom = y0;
      return zones.flatMap((z) => {
        const h = ((y1 - y0) * z.heightPct) / total;
        const ya = bottom;
        const yb = bottom + h;
        bottom = yb;
        switch (z.type) {
          case 'drawers':
            return drawers(Array(Math.max(1, z.drawerCount ?? 3)).fill(1), ya, yb);
          case 'door':
            return doors(1, 'middle', ya, yb, item.doorHinge ?? 'left');
          case 'oven':
            return [
              {
                a0: a0 + g,
                a1: a1 - g,
                y0: ya + g,
                y1: yb - g,
                handle: 'drawer',
                window: { fa0: 0.12, fa1: 0.88, fy0: 0.1, fy1: 0.72 },
              },
            ];
          case 'microwave':
            return [
              {
                a0: a0 + g,
                a1: a1 - g,
                y0: ya + g,
                y1: yb - g,
                window: { fa0: 0.06, fa1: 0.68, fy0: 0.12, fy1: 0.88 },
              },
            ];
          case 'coffee':
            return [
              {
                a0: a0 + g,
                a1: a1 - g,
                y0: ya + g,
                y1: yb - g,
                color: C.steel,
                window: { fa0: 0.3, fa1: 0.7, fy0: 0.2, fy1: 0.75 },
              },
            ];
          case 'open':
            return [];
        }
      });
    }
    case 'under_counter_oven':
      return [
        { a0: a0 + g, a1: a1 - g, y0: y1 - 12, y1: y1 - g, color: C.dark },
        {
          a0: a0 + g,
          a1: a1 - g,
          y0: y0 + g,
          y1: y1 - 12 - g,
          handle: 'drawer',
          window: { fa0: 0.12, fa1: 0.88, fy0: 0.12, fy1: 0.72 },
        },
      ];
    default:
      return [];
  }
}

function addPanels(
  b: Builder,
  group: THREE.Object3D,
  f: Frame,
  depth: number,
  item: KitchenItem,
  run: WallRun,
  panels: Panel[],
) {
  for (const p of panels) {
    b.box(group, localRect(f, p.a0, p.a1, depth - FRONT, depth), p.y0, p.y1, p.color ?? C.front, { item, run });
    const w = p.a1 - p.a0;
    const h = p.y1 - p.y0;
    if (p.window) {
      const wr = localRect(f, p.a0 + w * p.window.fa0, p.a0 + w * p.window.fa1, depth, depth + 0.3);
      b.box(group, wr, p.y0 + h * p.window.fy0, p.y0 + h * p.window.fy1, C.dark, { item, run, edges: false });
    }
    if (!p.handle) continue;
    if (p.handle === 'drawer') {
      const hw = Math.min(w * 0.4, 30);
      const cy = p.y1 - Math.min(h / 2, 6);
      b.box(
        group,
        localRect(f, p.a0 + (w - hw) / 2, p.a0 + (w + hw) / 2, depth, depth + 2),
        cy - 0.6,
        cy + 0.6,
        C.handle,
        { edges: false, item, run },
      );
    } else {
      const ax = p.hinge === 'right' ? p.a0 + 4 : p.a1 - 4;
      const len = Math.min(14, h * 0.3);
      const cy =
        p.handle === 'top' ? p.y1 - 5 - len / 2 : p.handle === 'bottom' ? p.y0 + 5 + len / 2 : (p.y0 + p.y1) / 2;
      b.box(group, localRect(f, ax - 0.6, ax + 0.6, depth, depth + 2), cy - len / 2, cy + len / 2, C.handle, {
        edges: false,
        item,
        run,
      });
    }
  }
}

function addItem(
  b: Builder,
  group: THREE.Object3D,
  f: Frame,
  run: WallRun,
  item: KitchenItem,
  counterThickness: number,
) {
  const a0 = item.x;
  const a1 = item.x + item.width;
  const d = item.depth;
  const y0 = item.y;
  const y1 = item.y + item.height;
  const o = { item, run };

  switch (item.category) {
    case 'base_cabinet':
    case 'upper_cabinet':
    case 'tall_cabinet':
    case 'corner_blocker':
    case 'under_counter_oven': {
      const tk = item.hasToeKick ? item.toeKickHeight : 0;
      if (tk > 0) b.box(group, localRect(f, a0 + 0.5, a1 - 0.5, 0, d - 6), y0, y0 + tk, C.plinth, o);
      if (item.frontType === 'open' && (item.category === 'base_cabinet' || item.category === 'upper_cabinet')) {
        // Open cabinet: built from boards so the inside and its shelves show.
        const t = 1.8;
        const [yb, yt] = [y0 + tk, y1];
        b.box(group, localRect(f, a0, a1, 0, t), yb, yt, C.carcass, o); // back
        b.box(group, localRect(f, a0, a0 + t, 0, d), yb, yt, C.front, o); // sides
        b.box(group, localRect(f, a1 - t, a1, 0, d), yb, yt, C.front, o);
        b.box(group, localRect(f, a0 + t, a1 - t, 0, d), yb, yb + t, C.front, o); // bottom, top
        b.box(group, localRect(f, a0 + t, a1 - t, 0, d), yt - t, yt, C.front, o);
        const n = item.shelfCount ?? 0;
        for (let k = 1; k <= n; k++) {
          const ys = yb + ((yt - yb) * k) / (n + 1);
          b.box(group, localRect(f, a0 + t, a1 - t, t, d - 1), ys - t / 2, ys + t / 2, C.front, o);
        }
        return;
      }
      const isCorner = item.category === 'corner_blocker';
      b.box(group, localRect(f, a0, a1, 0, isCorner ? d : d - FRONT), y0 + tk, y1, isCorner ? C.hatch : C.carcass, o);
      addPanels(b, group, f, d, item, run, frontPanels(item, a0, a1, y0 + tk, y0 + tk + boxHeight(item)));
      return;
    }
    case 'shelf': {
      // Open wall shelf: a board on two brackets.
      b.box(group, localRect(f, a0, a1, 0, d), y0, y1, C.front, o);
      for (const fx of [0.15, 0.85]) {
        const bx = a0 + (a1 - a0) * fx;
        b.box(group, localRect(f, bx - 0.6, bx + 0.6, 0, d * 0.7), y0 - Math.min(12, d * 0.5), y0, C.handle, {
          ...o,
          edges: false,
        });
      }
      return;
    }
    case 'filler': {
      // A plain panel flush with the cabinet fronts.
      const tk = item.hasToeKick ? item.toeKickHeight : 0;
      if (tk > 0) b.box(group, localRect(f, a0, a1, 0, d - 6), y0, y0 + tk, C.plinth, o);
      b.box(group, localRect(f, a0, a1, 0, d), y0 + tk, y1, C.front, o);
      return;
    }
    case 'fridge': {
      // Appliance look: steel body and thick rounded doors (no CAD outlines), dark shadow lines between the doors,
      // round bar handles on stand-offs and a dark kick grille.
      const DOOR = Math.min(6, d * 0.1);
      const SPLIT = 0.8;
      const grille = 5;
      const steel = b.finish('steel');
      const chrome = b.finish('chrome');
      b.roundedBox(group, localRect(f, a0, a1, 0, d - DOOR - 0.5), y0, y1, steel, 1.5, o);
      b.box(group, localRect(f, a0 + 0.5, a1 - 0.5, d - DOOR - 0.5, d - DOOR), y0, y1 - 0.5, C.dark, {
        ...o,
        edges: false,
      });
      b.box(group, localRect(f, a0 + 2, a1 - 2, d - DOOR - 0.5, d - 3), y0, y0 + grille - 0.5, C.dark, {
        ...o,
        edges: false,
      });
      const [fa0, fa1, fy0, fy1] = [a0, a1, y0 + grille, y1];
      const at = (from: number, to: number, frac: number) => from + (to - from) * frac;
      for (const door of fridgeDoors(item.fridgeType)) {
        const da0 = at(fa0, fa1, door.fx0) + (door.fx0 > 0 ? SPLIT / 2 : 0);
        const da1 = at(fa0, fa1, door.fx1) - (door.fx1 < 1 ? SPLIT / 2 : 0);
        const dy0 = at(fy0, fy1, door.fy0) + (door.fy0 > 0 ? SPLIT / 2 : 0);
        const dy1 = at(fy0, fy1, door.fy1) - (door.fy1 < 1 ? SPLIT / 2 : 0);
        b.roundedBox(group, localRect(f, da0, da1, d - DOOR, d), dy0, dy1, steel, 1.2, o);

        const dh = dy1 - dy0;
        const len = Math.min(dh * (door.handle === 'middle' ? 0.45 : 0.55), 75);
        const end = Math.min(dh * 0.08, 8);
        const hy0 =
          door.handle === 'top' ? dy1 - end - len : door.handle === 'bottom' ? dy0 + end : dy0 + (dh - len) / 2;
        const hx = door.hinge === 'left' ? da1 - 5 : da0 + 5;
        for (const sy of [hy0 + 2.5, hy0 + len - 2.5]) {
          b.cylinder(group, toPlan(f, hx, d + 1.5), sy, 0.6, 3, chrome, f.n, o);
        }
        b.cylinder(group, toPlan(f, hx, d + 4), hy0 + len / 2, 1.2, len, chrome, null, o);
      }
      if (item.id === b.selectedId) b.outline(group, localRect(f, a0, a1, 0, d + 5.2), y0, y1);
      return;
    }
    case 'washing_machine': {
      b.box(group, localRect(f, a0, a1, 0, d), y0, y1, C.front, o);
      b.box(group, localRect(f, a0 + 2, a1 - 2, d, d + 0.3), y1 - 12, y1 - 3, C.steel, { ...o, edges: false });
      b.disc(
        group,
        f,
        (a0 + a1) / 2,
        d + 0.3,
        y0 + (item.height - 12) / 2 + 2,
        Math.min(item.width, item.height) * 0.3,
        C.dark,
      );
      return;
    }
    case 'sink': {
      const top = y0 + counterThickness;
      const bowls = item.sinkBowls ?? 1;
      const inner = (a1 - a0 - 8 - (bowls - 1) * 3) / bowls;
      for (let i = 0; i < bowls; i++) {
        const s = a0 + 4 + i * (inner + 3);
        b.box(group, localRect(f, s, s + inner, 8, d - 3), top - 0.2, top + 0.15, C.sink, o);
      }
      if (item.hasFaucet) {
        const c = (a0 + a1) / 2;
        b.box(group, localRect(f, c - 1.2, c + 1.2, 3, 5.4), top, top + 28, C.handle, { ...o, edges: false });
        b.box(group, localRect(f, c - 1.2, c + 1.2, 3, 20), top + 26, top + 28.4, C.handle, { ...o, edges: false });
      }
      return;
    }
    case 'stove': {
      const top = y0 + counterThickness;
      b.box(group, localRect(f, a0 + 1, a1 - 1, 3, d - 1), top, top + 1.5, C.hob, o);
      const n = item.burnerCount ?? 4;
      const spots =
        n === 5
          ? [
              [0.2, 0.32],
              [0.8, 0.32],
              [0.2, 0.74],
              [0.8, 0.74],
              [0.5, 0.53],
            ]
          : [
              [0.28, 0.32],
              [0.72, 0.32],
              [0.28, 0.74],
              [0.72, 0.74],
            ];
      for (const [fa, fd] of spots)
        b.disc(group, f, a0 + item.width * fa, d * fd, top + 1.8, Math.min(item.width, d) * 0.11, 0x6b7280, true);
      return;
    }
    case 'water_bar':
    case 'coffee_machine': {
      // A real dispensing alcove (back column, overhanging head, side walls), drip tray, nozzle or spouts,
      // controls on the head, and a glass / cup as the strongest "what is it" cue.
      const coffee = item.category === 'coffee_machine';
      const top = y0 + counterThickness;
      const h = item.height;
      const w = a1 - a0;
      const mid = (a0 + a1) / 2;
      const shell = b.finish(coffee ? 'glossBlack' : 'glossWhite');
      const recess = Math.min(10, d * 0.3);
      const headH = h * (coffee ? 0.32 : 0.36);
      const headY = top + h - headH;
      const side = Math.min(3, w * 0.12);
      const [l0, l1] = [a0 + 0.5, a1 - 0.5];

      b.roundedBox(group, localRect(f, l0, l1, 4, d - recess), top, top + h, shell, 2, o);
      b.roundedBox(
        group,
        localRect(f, l0, l1, d - recess - 1, d),
        headY,
        top + h,
        coffee ? b.finish('steel') : shell,
        2,
        o,
      );
      for (const [s0, s1] of [
        [l0, l0 + side],
        [l1 - side, l1],
      ]) {
        b.roundedBox(group, localRect(f, s0, s1, d - recess - 1, d), top, headY + 1, shell, 1, o);
      }
      b.box(group, localRect(f, l0 + side, l1 - side, d - recess, d - recess + 0.2), top, headY, C.dark, {
        ...o,
        edges: false,
      });

      // Drip tray with slots.
      const trayH = 2;
      b.box(group, localRect(f, l0 + side, l1 - side, d - recess, d + 0.5), top, top + trayH, C.steel, {
        ...o,
        edges: false,
      });
      for (let k = 1; k <= 3; k++) {
        const ax = l0 + side + ((l1 - l0 - 2 * side) * k) / 4;
        b.box(
          group,
          localRect(f, ax - 0.3, ax + 0.3, d - recess + 1, d - 0.5),
          top + trayH,
          top + trayH + 0.05,
          C.dark,
          {
            ...o,
            edges: false,
          },
        );
      }

      // Nozzle (water) or twin spouts (coffee) under the head.
      const spoutDepth = d - recess / 2;
      if (coffee) {
        b.roundedBox(
          group,
          localRect(f, mid - 3, mid + 3, spoutDepth - 2, spoutDepth + 2),
          headY - 3,
          headY,
          b.finish('chrome'),
          0.5,
          o,
        );
        for (const dx of [-1.3, 1.3])
          b.cylinder(group, toPlan(f, mid + dx, spoutDepth), headY - 4, 0.45, 2, b.finish('chrome'), null, o);
      } else {
        b.cylinder(group, toPlan(f, mid, spoutDepth), headY - 1.2, 0.7, 2.4, b.finish('chrome'), null, o);
      }

      // Glass or cup on the tray, sized to fit the alcove.
      const room = headY - (top + trayH);
      const r = Math.min(coffee ? 3.5 : 3, (w - 2 * side) * 0.3, recess * 0.4);
      const ch = Math.min(coffee ? 7 : 10, room * 0.5);
      const cupAt = toPlan(f, mid, spoutDepth);
      b.cylinder(group, cupAt, top + trayH + ch / 2, r, ch, b.finish(coffee ? 'ceramic' : 'waterGlass'), null, o);
      if (coffee) {
        const handleAt = toPlan(f, mid + r + 0.8, spoutDepth);
        b.cylinder(group, handleAt, top + trayH + ch / 2, 0.5, ch * 0.5, b.finish('ceramic'), null, o);
      }

      // Controls on the head front.
      const front = d + 0.15;
      if (coffee) {
        b.box(
          group,
          localRect(f, mid - w * 0.22, mid + w * 0.22, d, front),
          headY + headH * 0.35,
          headY + headH * 0.8,
          C.dark,
          {
            ...o,
            edges: false,
          },
        );
        b.roundedBox(
          group,
          localRect(f, mid - w * 0.2, mid + w * 0.2, d, front + 0.1),
          headY + headH * 0.4,
          headY + headH * 0.75,
          b.finish('screen'),
          0.2,
          o,
        );
        // Bean hopper lid on top, towards the back.
        b.roundedBox(
          group,
          localRect(f, a0 + w * 0.12, a0 + w * 0.55, 6, 6 + Math.min(14, d * 0.35)),
          top + h,
          top + h + 1.2,
          b.finish('glossBlack'),
          0.5,
          o,
        );
      } else {
        b.roundedBox(
          group,
          localRect(f, l0 + side, l1 - side, d, front + 0.1),
          headY + headH * 0.45,
          headY + headH * 0.8,
          b.finish('blackGlass'),
          0.3,
          o,
        );
        for (const fx of [-0.25, 0, 0.25]) {
          const lx = mid + fx * (w - 2 * side);
          b.roundedBox(
            group,
            localRect(f, lx - 0.6, lx + 0.6, front + 0.1, front + 0.3),
            headY + headH * 0.6,
            headY + headH * 0.66,
            b.finish('led'),
            0.1,
            o,
          );
        }
      }
      if (item.id === b.selectedId)
        b.outline(group, localRect(f, a0, a1, 4, d + 0.5), top, top + h + (coffee ? 1.2 : 0));
      return;
    }
  }
}

/** Wall with holes for its windows / doors, plus their glazing and door leaves. */
function addWall(b: Builder, root: THREE.Group, data: ProjectData, run: WallRun) {
  const f = wallFrame(data.room, run);
  const H = data.room.heightCm;
  const present = (side: string) => data.walls.some((w) => w.kind === 'wall' && w.side === side && !w.removed);
  // North/south walls own the corners (as in the plan), extended toward a neighbour that exists.
  const startNeighbour = { north: 'west', south: 'east' }[run.side as 'north' | 'south'];
  const endNeighbour = { north: 'east', south: 'west' }[run.side as 'north' | 'south'];
  const start = startNeighbour && present(startNeighbour) ? -T : 0;
  const end = f.length + (endNeighbour && present(endNeighbour) ? T : 0);

  const group = new THREE.Group();
  const inner = toPlan(f, f.length / 2, 0);
  group.userData.wall = {
    point: new THREE.Vector3(inner.x, 0, inner.y),
    normal: new THREE.Vector3(f.n.x, 0, f.n.y),
  } satisfies WallMeta;

  const piece = (x0: number, x1: number, y0: number, y1: number) =>
    b.box(group, localRect(f, x0, x1, -T, 0), y0, y1, C.wall);
  const openings = run.items.filter((i) => isOpening(i.category)).sort((p, q) => p.x - q.x);
  let cursor = start;
  for (const op of openings) {
    const x0 = Math.max(op.x, cursor);
    const x1 = op.x + op.width;
    if (x0 > cursor) piece(cursor, x0, 0, H);
    if (op.y > 0) piece(x0, x1, 0, op.y);
    if (op.y + op.height < H) piece(x0, x1, op.y + op.height, H);
    const o = { item: op, run };
    if (op.category === 'window') {
      b.box(group, localRect(f, x0, x1, -T / 2 - 0.5, -T / 2 + 0.5), op.y, op.y + op.height, C.glass, {
        ...o,
        opacity: 0.35,
      });
      b.box(group, localRect(f, x0 - 3, x1 + 3, 0, 4), op.y - 2, op.y, C.front, o); // sill
    } else {
      const out = op.doorSwing === 'out';
      const face = out ? -T : 0;
      b.box(
        group,
        localRect(f, x0 + 0.5, x1 - 0.5, out ? face : face - 4, out ? face + 4 : face),
        0,
        op.y + op.height - 0.5,
        C.door,
        o,
      );
      const hx = op.doorHinge === 'right' ? x0 + 7 : x1 - 7;
      const hd = out ? face - 3 : face + 3;
      b.box(group, localRect(f, hx - 6, hx + 6, Math.min(face, hd), Math.max(face, hd)), 103, 105, C.handle, {
        ...o,
        edges: false,
      });
    }
    cursor = Math.max(cursor, x1);
  }
  if (cursor < end) piece(cursor, end, 0, H);

  // Socket plates on the wall's inner face (part of the wall group, so they hide with it).
  for (const s of run.items.filter((i) => isElectrical(i.category))) {
    const o = { item: s, run };
    b.box(group, localRect(f, s.x, s.x + s.width, 0, 0.8), s.y, s.y + s.height, C.front, o);
    const n = s.category === 'power_socket' ? 1 : (s.socketCount ?? 1);
    const cell = s.width / n;
    for (let k = 0; k < n; k++) {
      const c = s.x + cell * (k + 0.5);
      const r = Math.min(cell, s.height) * 0.3;
      b.box(
        group,
        localRect(f, c - r, c + r, 0.8, 1.1),
        s.y + s.height / 2 - r,
        s.y + s.height / 2 + r,
        s.category === 'power_socket' ? 0xb91c1c : C.steel,
        { ...o, edges: false },
      );
    }
  }
  root.add(group);
}

export function buildKitchen(
  data: ProjectData,
  selectedId: string | null,
  envMap: THREE.Texture | null = null,
): THREE.Group {
  const b = new Builder(selectedId, envMap);
  const root = new THREE.Group();
  const { room } = data;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(room.widthCm, room.depthCm), b.mat(C.floor));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(room.widthCm / 2, 0, room.depthCm / 2);
  floor.receiveShadow = true;
  root.add(floor);
  const grid = new THREE.GridHelper(
    Math.max(room.widthCm, room.depthCm),
    Math.round(Math.max(room.widthCm, room.depthCm) / 50),
    0xd6d3d1,
    0xd6d3d1,
  );
  grid.position.set(room.widthCm / 2, 0.05, room.depthCm / 2);
  grid.raycast = () => {};
  root.add(grid);

  for (const run of data.walls) {
    if (run.kind === 'wall' && run.removed) continue;
    if (run.kind === 'wall') addWall(b, root, data, run);
    if (run.kind === 'island' && !run.items.length) {
      const r = islandRect(run);
      b.box(root, r, 0, 0.4, C.open, { opacity: 0.6 });
    }
    const f = wallFrame(room, run);
    const group = new THREE.Group();
    for (const item of run.items) {
      if (isWallMounted(item.category)) continue;
      addItem(b, group, f, run, item, run.countertopThicknessCm);
    }
    const slabs = computeCountertops(run); // same order as countertopRects
    countertopRects(f, run).forEach((r, i) => b.box(group, r, slabs[i].y, slabs[i].y + slabs[i].thickness, C.counter));
    root.add(group);
  }
  return root;
}

/** Free the GPU resources of a tree built by buildKitchen (each build owns its geometries and materials). */
export function disposeTree(obj: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => materials.add(m));
    }
  });
  materials.forEach((m) => m.dispose());
}
