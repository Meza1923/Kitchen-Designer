import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { KitchenItem, ProjectData, WallRun } from '../types';
import { SIDE_LABELS } from '../lib/defaults';
import { computeGaps, computeOverlaps, computeSocketIssues, computeUnsupported, fmt, isElectrical, isOpening, layerOf } from '../lib/geometry';
import {
  computePlanConflicts,
  countertopRects,
  islandRect,
  itemPlanRect,
  localRect,
  toPlan,
  wallFrame,
  WALL_THICKNESS_CM,
  type Frame,
  type Rect,
} from '../lib/plan';
import { Badge, DimH, DimV, Label, SELECT, WARN } from './Drawing';
import { FONT, INK, THIN } from './ItemShape';

export const PLAN_PAD = 90;
const T = WALL_THICKNESS_CM;

export const planSize = (data: ProjectData, scale: number) => ({
  width: (data.room.widthCm + 2 * T) * scale + 2 * PLAN_PAD,
  height: (data.room.depthCm + 2 * T) * scale + 2 * PLAN_PAD,
});

/** SVG px of the room's inner north-west corner (plan origin). */
export const planOrigin = (scale: number) => PLAN_PAD + T * scale;

const SHORT: Record<KitchenItem['category'], string> = {
  base_cabinet: 'B',
  upper_cabinet: 'U',
  tall_cabinet: 'T',
  corner_blocker: 'CB',
  fridge: 'REF',
  washing_machine: 'WM',
  under_counter_oven: 'OV',
  sink: 'SINK',
  stove: 'HOB',
  water_bar: 'WB',
  coffee_machine: 'CM',
  window: 'WIN',
  door: 'DOOR',
  socket: 'S',
  power_socket: '16A',
};

const LINE = { stroke: THIN, strokeWidth: 1, fill: 'none' };

export interface PlanDrawingProps {
  data: ProjectData;
  scale: number;
  selectedId?: string | null;
  interactive?: boolean;
  onItemPointerDown?: (e: ReactPointerEvent, run: WallRun, item: KitchenItem) => void;
  onRunPointerDown?: (e: ReactPointerEvent, run: WallRun) => void;
}

export function PlanDrawing({ data, scale: S, selectedId, interactive, onItemPointerDown, onRunPointerDown }: PlanDrawingProps) {
  const { room } = data;
  const W = room.widthCm * S;
  const D = room.depthCm * S;
  const t = T * S;
  const px = (r: Rect) => ({ x: r.x * S, y: r.y * S, width: r.w * S, height: r.h * S });
  const runs = data.walls.map((run) => ({ run, f: wallFrame(room, run) }));
  const conflicts = computePlanConflicts(data);
  const flagged = new Set<string>([
    ...conflicts.flatMap((c) => [c.a, c.b ?? '']),
    ...data.walls.flatMap((w) => computeOverlaps(w).flatMap((o) => [o.a, o.b])),
    ...data.walls.flatMap((w) => computeUnsupported(w).map((i) => i.id)),
    ...data.walls.flatMap((w) => computeSocketIssues(w).map((s) => s.item.id)),
  ]);
  const active = data.activeWallId;
  const present = (side: string) => data.walls.some((w) => w.kind === 'wall' && w.side === side && !w.removed);
  const [hasN, hasE, hasS, hasW] = ['north', 'east', 'south', 'west'].map(present);
  // North/south bands own the corners; east/west extend into a corner only when its neighbour is open.
  const wallBands = [
    hasN && { x: hasW ? -t : 0, y: -t, width: W + (hasW ? t : 0) + (hasE ? t : 0), height: t },
    hasS && { x: hasW ? -t : 0, y: D, width: W + (hasW ? t : 0) + (hasE ? t : 0), height: t },
    hasE && { x: W, y: hasN ? 0 : -t, width: t, height: D + (hasN ? 0 : t) + (hasS ? 0 : t) },
    hasW && { x: -t, y: hasN ? 0 : -t, width: t, height: D + (hasN ? 0 : t) + (hasS ? 0 : t) },
  ].filter(Boolean) as { x: number; y: number; width: number; height: number }[];
  const openingRect = (f: Frame, item: KitchenItem) => localRect(f, item.x, item.x + item.width, -T, 0);
  /** Footprint used for highlighting: openings sit in the wall, sockets on its face, everything else in the room. */
  const footprint = (f: Frame, item: KitchenItem) =>
    isOpening(item.category) ? openingRect(f, item) : isElectrical(item.category) ? localRect(f, item.x, item.x + item.width, 0, 4) : itemPlanRect(f, item);

  const itemProps = (run: WallRun, item: KitchenItem) => ({
    'data-item-id': item.id,
    style: interactive ? { cursor: 'grab' } : undefined,
    onPointerDown: onItemPointerDown ? (e: ReactPointerEvent) => onItemPointerDown(e, run, item) : undefined,
  });

  const text = (r: Rect, label: string, size = 9, weight = 600) => {
    const vertical = r.h > r.w * 1.2;
    return (
      <Label x={(r.x + r.w / 2) * S} y={(r.y + r.h / 2) * S} text={label} size={size} fill={INK} weight={weight} rotate={vertical ? -90 : undefined} />
    );
  };

  const floorSymbol = (f: Frame, item: KitchenItem, r: Rect): ReactNode => {
    const p = px(r);
    switch (item.category) {
      case 'tall_cabinet':
        return (
          <g>
            <line x1={p.x} y1={p.y} x2={p.x + p.width} y2={p.y + p.height} {...LINE} />
            <line x1={p.x + p.width} y1={p.y} x2={p.x} y2={p.y + p.height} {...LINE} />
          </g>
        );
      case 'washing_machine': {
        const c = toPlan(f, item.x + item.width / 2, item.depth / 2);
        return <circle cx={c.x * S} cy={c.y * S} r={Math.min(item.width, item.depth) * 0.32 * S} {...LINE} />;
      }
      case 'under_counter_oven':
        return <rect {...px(localRect(f, item.x + 5, item.x + item.width - 5, item.depth - 8, item.depth - 3))} {...LINE} />;
      case 'fridge':
        return <rect {...px(localRect(f, item.x + 3, item.x + item.width - 3, item.depth - 6, item.depth - 2))} {...LINE} />;
      default:
        return null;
    }
  };

  const counterSymbol = (f: Frame, item: KitchenItem): ReactNode => {
    if (item.category === 'sink') {
      const bowls = item.sinkBowls ?? 1;
      const inset = 4;
      const divider = bowls === 2 ? 3 : 0;
      const bw = (item.width - 2 * inset - divider) / bowls;
      const faucet = toPlan(f, item.x + item.width / 2, 4);
      return (
        <g>
          {Array.from({ length: bowls }, (_, i) => {
            const x0 = item.x + inset + i * (bw + divider);
            return <rect key={i} {...px(localRect(f, x0, x0 + bw, 9, Math.max(12, item.depth - 3)))} rx={4} fill="#f1f5f9" stroke={INK} strokeWidth={1.25} />;
          })}
          {item.hasFaucet && <circle cx={faucet.x * S} cy={faucet.y * S} r={2 * S} fill="#ffffff" stroke={INK} strokeWidth={1.25} />}
        </g>
      );
    }
    if (item.category === 'water_bar' || item.category === 'coffee_machine') {
      const body = localRect(f, item.x + 1, item.x + item.width - 1, 2, item.depth);
      const c = toPlan(f, item.x + item.width / 2, item.depth * (item.category === 'water_bar' ? 0.72 : 0.68));
      return (
        <g>
          <rect {...px(body)} rx={3} fill="#ffffff" stroke={INK} strokeWidth={1.25} />
          <circle cx={c.x * S} cy={c.y * S} r={Math.min(item.width, item.depth) * 0.16 * S} fill={item.category === 'water_bar' ? '#e0f2fe' : '#ffffff'} stroke={INK} strokeWidth={1} />
          {text(body, SHORT[item.category], 7)}
        </g>
      );
    }
    if (item.category === 'stove') {
      const n = item.burnerCount ?? 4;
      const d = item.depth;
      const spots =
        n === 5
          ? [[0.2, 0.32], [0.8, 0.32], [0.2, 0.74], [0.8, 0.74], [0.5, 0.53]]
          : [[0.28, 0.32], [0.72, 0.32], [0.28, 0.74], [0.72, 0.74]];
      const r = Math.min(item.width, d) * (n === 5 ? 0.11 : 0.14) * S;
      return (
        <g>
          <rect {...px(localRect(f, item.x + 2, item.x + item.width - 2, 4, d - 2))} fill="#ffffff" stroke={INK} strokeWidth={1.5} />
          {spots.map(([a, b], i) => {
            const c = toPlan(f, item.x + item.width * a, d * b);
            return (
              <g key={i}>
                <circle cx={c.x * S} cy={c.y * S} r={r} {...LINE} />
                <line x1={c.x * S - r - 2} y1={c.y * S} x2={c.x * S + r + 2} y2={c.y * S} {...LINE} />
                <line x1={c.x * S} y1={c.y * S - r - 2} x2={c.x * S} y2={c.y * S + r + 2} {...LINE} />
              </g>
            );
          })}
        </g>
      );
    }
    return null;
  };

  return (
    <g>
      <defs>
        <pattern id="planWallHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#cbd5e1" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#64748b" strokeWidth="1" />
        </pattern>
        <pattern id="planHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="#ffffff" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="#64748b" strokeWidth="1.2" />
        </pattern>
        <pattern id="planWarnHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#fee2e2" />
          <line x1="0" y1="0" x2="0" y2="6" stroke={WARN} strokeWidth="2" />
        </pattern>
      </defs>

      <g transform={`translate(${planOrigin(S)} ${planOrigin(S)})`}>
        {/* Walls and floor */}
        {wallBands.map((b, i) => <rect key={i} {...b} fill="url(#planWallHatch)" stroke={INK} strokeWidth={1.75} />)}

        {/* Island footprints */}
        {runs.filter(({ run }) => run.kind === 'island').map(({ run }) => {
          const r = islandRect(run);
          const isActive = run.id === active;
          return (
            <g key={run.id} data-run-id={run.id} style={interactive ? { cursor: 'move' } : undefined} onPointerDown={onRunPointerDown ? (e) => onRunPointerDown(e, run) : undefined}>
              <rect {...px(r)} fill="#f8fafc" stroke={isActive ? SELECT : THIN} strokeWidth={isActive ? 2 : 1} strokeDasharray="6 4" />
              <Label x={(r.x + r.w / 2) * S} y={(r.y + r.h) * S + 10} text={`${run.name.toUpperCase()} ${fmt(run.widthCm)}×${fmt(run.depthCm ?? 90)}`} size={8} fill={isActive ? SELECT : THIN} weight={600} />
            </g>
          );
        })}

        {/* Floor-standing units */}
        {runs.flatMap(({ run, f }) =>
          run.items.filter((i) => layerOf(i.category) === 'floor').map((item) => {
            const r = itemPlanRect(f, item);
            return (
              <g key={item.id} {...itemProps(run, item)}>
                <rect {...px(r)} fill={item.category === 'corner_blocker' ? 'url(#planHatch)' : '#ffffff'} stroke={INK} strokeWidth={1.5} />
                {floorSymbol(f, item, r)}
                {text(r, `${SHORT[item.category]} ${fmt(item.width)}`, 8.5)}
              </g>
            );
          }),
        )}

        {/* Countertops */}
        {runs.flatMap(({ run, f }) =>
          countertopRects(f, run).map((r, i) => (
            <rect key={`${run.id}-ct-${i}`} {...px(r)} fill="#94a3b8" fillOpacity={0.18} stroke={INK} strokeWidth={1} style={{ pointerEvents: 'none' }} />
          )),
        )}

        {/* Sink / cooktop on the counter */}
        {runs.flatMap(({ run, f }) =>
          run.items.filter((i) => layerOf(i.category) === 'counter').map((item) => (
            <g key={item.id} {...itemProps(run, item)}>
              <rect {...px(itemPlanRect(f, item))} fill="transparent" />
              {counterSymbol(f, item)}
            </g>
          )),
        )}

        {/* Upper cabinets: dashed (above the cut plane) */}
        {runs.flatMap(({ run, f }) =>
          run.items.filter((i) => i.category === 'upper_cabinet').map((item) => {
            const r = itemPlanRect(f, item);
            return (
              <g key={item.id} {...itemProps(run, item)}>
                <rect {...px(r)} fill="#eff6ff" fillOpacity={0.35} stroke={INK} strokeWidth={1.25} strokeDasharray="7 4" />
                <line {...{ x1: r.x * S, y1: r.y * S, x2: (r.x + r.w) * S, y2: (r.y + r.h) * S }} stroke={THIN} strokeWidth={0.75} strokeDasharray="4 4" />
              </g>
            );
          }),
        )}

        {/* Wall hit areas, labels and windows */}
        {runs.filter(({ run }) => run.kind === 'wall' && run.removed).map(({ run, f }) => {
          const a = toPlan(f, 0, 0);
          const b = toPlan(f, f.length, 0);
          const lp = toPlan(f, f.length / 2, -T - 7);
          const vertical = run.side === 'east' || run.side === 'west';
          return (
            <g key={run.id} style={{ pointerEvents: 'none' }}>
              <line x1={a.x * S} y1={a.y * S} x2={b.x * S} y2={b.y * S} stroke={THIN} strokeWidth={1} strokeDasharray="10 4 2 4" />
              <Label x={lp.x * S} y={lp.y * S} text={`OPEN · ${run.name.toUpperCase()}`} size={8.5} fill="#94a3b8" weight={700} rotate={vertical ? (run.side === 'east' ? 90 : -90) : undefined} />
            </g>
          );
        })}
        {runs.filter(({ run }) => run.kind === 'wall' && !run.removed).map(({ run, f }) => {
          const band = localRect(f, 0, f.length, -T, 0);
          const isActive = run.id === active;
          const inner = [toPlan(f, 0, 0), toPlan(f, f.length, 0)];
          const lp = toPlan(f, f.length / 2, -T - 7);
          const vertical = run.side === 'east' || run.side === 'west';
          return (
            <g key={run.id} data-run-id={run.id} onPointerDown={onRunPointerDown ? (e) => onRunPointerDown(e, run) : undefined} style={interactive ? { cursor: 'pointer' } : undefined}>
              <rect {...px(band)} fill="transparent" />
              {isActive && <line x1={inner[0].x * S} y1={inner[0].y * S} x2={inner[1].x * S} y2={inner[1].y * S} stroke={SELECT} strokeWidth={4} strokeOpacity={0.6} />}
              <Label
                x={lp.x * S}
                y={lp.y * S}
                text={`${run.name.toUpperCase()} · ${SIDE_LABELS[run.side ?? 'north'].toUpperCase()}`}
                size={9}
                weight={700}
                fill={isActive ? SELECT : THIN}
                rotate={vertical ? (run.side === 'east' ? 90 : -90) : undefined}
              />
              {run.items.filter((i) => isElectrical(i.category)).map((item) => {
                const power = item.category === 'power_socket';
                const lbl = toPlan(f, item.x + item.width / 2, 9);
                return (
                  <g key={item.id} {...itemProps(run, item)}>
                    <rect {...px(localRect(f, item.x, item.x + item.width, 0, 4))} fill={power ? '#b91c1c' : '#ffffff'} stroke={INK} strokeWidth={1.25} />
                    <Label x={lbl.x * S} y={lbl.y * S} text={power ? '16A' : `S${item.socketCount ?? 1}`} size={7} fill={power ? '#b91c1c' : INK} weight={700} />
                  </g>
                );
              })}
              {run.items.filter((i) => i.category === 'door').map((item) => {
                const hingeX = item.doorHinge === 'right' ? item.x + item.width : item.x;
                const freeX = item.doorHinge === 'right' ? item.x : item.x + item.width;
                const out = item.doorSwing === 'out';
                const base = out ? -T : 0; // the leaf hangs on the face it opens towards
                const dir = out ? -1 : 1;
                const hinge = toPlan(f, hingeX, base);
                const leafEnd = toPlan(f, hingeX, base + dir * item.width);
                const arc = Array.from({ length: 17 }, (_, k) => {
                  const a = (k / 16) * (Math.PI / 2);
                  const p = toPlan(f, hingeX + (freeX - hingeX) * Math.sin(a), base + dir * item.width * Math.cos(a));
                  return `${p.x * S},${p.y * S}`;
                }).join(' ');
                return (
                  <g key={item.id} {...itemProps(run, item)}>
                    <rect {...px(openingRect(f, item))} fill="#ffffff" stroke={INK} strokeWidth={1.25} />
                    <polyline points={arc} fill="none" stroke={THIN} strokeWidth={0.9} strokeDasharray="4 3" />
                    <line x1={hinge.x * S} y1={hinge.y * S} x2={leafEnd.x * S} y2={leafEnd.y * S} stroke={INK} strokeWidth={2.5} />
                  </g>
                );
              })}
              {run.items.filter((i) => i.category === 'window').map((item) => {
                const r = localRect(f, item.x, item.x + item.width, -T, 0);
                const g1 = [toPlan(f, item.x, -T / 3), toPlan(f, item.x + item.width, -T / 3)];
                const g2 = [toPlan(f, item.x, (-2 * T) / 3), toPlan(f, item.x + item.width, (-2 * T) / 3)];
                return (
                  <g key={item.id} {...itemProps(run, item)}>
                    <rect {...px(r)} fill="#ffffff" stroke={INK} strokeWidth={1.25} />
                    {[g1, g2].map((g, i) => <line key={i} x1={g[0].x * S} y1={g[0].y * S} x2={g[1].x * S} y2={g[1].y * S} stroke={INK} strokeWidth={0.9} />)}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Validation: <10cm gaps, same-run overlaps and cross-run clashes */}
        {runs.flatMap(({ run, f }) =>
          (['floor', 'upper'] as const).flatMap((layer) =>
            computeGaps(run, layer)
              .filter((g) => g.warning)
              .map((g, i) => {
                const r = localRect(f, g.x0, g.x1, 0, layer === 'floor' ? 60 : 35);
                const c = toPlan(f, (g.x0 + g.x1) / 2, (layer === 'floor' ? 60 : 35) + 8);
                return (
                  <g key={`${run.id}-${layer}-gap-${i}`} style={{ pointerEvents: 'none' }}>
                    <rect {...px(r)} fill="url(#planWarnHatch)" stroke={WARN} strokeWidth={1} />
                    <Badge x={c.x * S} y={c.y * S} text={`! GAP ${g.width.toFixed(1)} cm`} />
                  </g>
                );
              }),
          ),
        )}
        {runs.flatMap(({ f, run }) =>
          run.items.filter((i) => flagged.has(i.id)).map((item) => {
            const r = footprint(f, item);
            return <rect key={`flag-${item.id}`} x={r.x * S - 2} y={r.y * S - 2} width={r.w * S + 4} height={r.h * S + 4} fill="none" stroke={WARN} strokeWidth={2} strokeDasharray="6 3" style={{ pointerEvents: 'none' }} />;
          }),
        )}
        {conflicts.map((c, i) => (
          <g key={`conf-${i}`} style={{ pointerEvents: 'none' }}>
            {c.kind === 'outside' && <rect {...px(c.rect)} fill="none" stroke={WARN} strokeWidth={2} strokeDasharray="6 3" />}
            {c.kind === 'clash' && <rect {...px(c.rect)} fill="url(#planWarnHatch)" fillOpacity={0.8} />}
            {c.kind === 'swing' && <rect {...px(c.rect)} fill="url(#planWarnHatch)" fillOpacity={0.6} />}
            <Badge x={(c.rect.x + c.rect.w / 2) * S} y={(c.rect.y + c.rect.h / 2) * S} text={{ clash: 'CLASH', outside: 'OUTSIDE ROOM', swing: 'DOOR SWING' }[c.kind]} />
          </g>
        ))}

        {/* Selection */}
        {interactive && selectedId && runs.map(({ run, f }) => {
          const item = run.items.find((i) => i.id === selectedId);
          if (!item) return null;
          const r = footprint(f, item);
          return <rect key="sel" x={r.x * S - 3} y={r.y * S - 3} width={r.w * S + 6} height={r.h * S + 6} fill="none" stroke={SELECT} strokeWidth={2} style={{ pointerEvents: 'none' }} />;
        })}

        {/* Room dimensions */}
        <DimH x0={0} x1={W} y={-t - 44} label={`ROOM ${fmt(room.widthCm)} cm`} color={INK} extFrom={-t - 4} />
        <DimV x={-t - 44} y0={0} y1={D} label={`${fmt(room.depthCm)} cm`} color={INK} extFrom={-t - 4} />
        <text x={W + t + 12} y={D + t} fontSize={8} fontFamily={FONT} fill={THIN} style={{ pointerEvents: 'none' }}>
          CEILING {fmt(room.heightCm)}
        </text>
      </g>
    </g>
  );
}
