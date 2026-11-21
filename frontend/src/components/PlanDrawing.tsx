import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { KitchenItem, ProjectData, WallRun } from '../types';
import { directionLabels, roomOutline, segmentIndex, segments, type Pt, type Segment } from '../lib/outline';
import { computeGaps, fmt, isElectrical, isJoint, isOpening, layerOf } from '../lib/geometry';
import {
  countertopRects,
  islandFootprint,
  islandRect,
  endProfiles,
  islandOverhangs,
  isIslandFront,
  islandClearances,
  stoolPoint,
  STOOL_RADIUS_CM,
  itemPlanRect,
  localRect,
  partitionRect,
  planFootprint,
  toPlan,
  wallFrame,
  WALL_THICKNESS_CM,
  type Frame,
  type Rect,
} from '../lib/plan';
import { severityByItem, type Violation } from '../lib/rules';
import { AMBER, Badge, DimH, DimV, Label, SELECT, WARN } from './Drawing';
import { FONT, INK, THIN } from './ItemShape';
import { directionName, runName, t as tr } from '../lib/i18n';

export const PLAN_PAD = 90;
/** Aisle distances (#15): red under 90 cm, amber under 105 cm (R4's working-aisle guideline). */
const AISLE_RED = 90;
const AISLE_AMBER = 105;
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
  shelf: 'SH',
  filler: 'F',
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
  stool: 'ST',
  dishwasher: 'DW',
  trash_cabinet: 'TR',
  hood: 'HOOD',
  end_panel: 'EP',
  column: 'COL',
  partition_joint: '',
};

const LINE = { stroke: THIN, strokeWidth: 1, fill: 'none' };

export interface PlanDrawingProps {
  data: ProjectData;
  scale: number;
  selectedId?: string | null;
  interactive?: boolean;
  onItemPointerDown?: (e: ReactPointerEvent, run: WallRun, item: KitchenItem) => void;
  onRunPointerDown?: (e: ReactPointerEvent, run: WallRun) => void;
  /** The far end of a partition wall grabbed, to change its length. */
  onPartitionTipPointerDown?: (e: ReactPointerEvent, faceA: WallRun) => void;
  /** A room corner grabbed (index of the outline point), to drag both walls meeting there. */
  onCornerPointerDown?: (e: ReactPointerEvent, corner: number) => void;
  /** Rule violations for the project (see lib/rules.ts). */
  violations: Violation[];
}

export function PlanDrawing({
  data,
  scale: S,
  selectedId,
  interactive,
  onItemPointerDown,
  onRunPointerDown,
  onCornerPointerDown,
  onPartitionTipPointerDown,
  violations,
}: PlanDrawingProps) {
  const { room } = data;
  const W = room.widthCm * S;
  const D = room.depthCm * S;
  const t = T * S;
  const px = (r: Rect) => ({ x: r.x * S, y: r.y * S, width: r.w * S, height: r.h * S });
  const runs = data.walls.map((run) => ({ run, f: wallFrame(room, run) }));
  // Gap warnings have their own marker below; everything else is framed / hatched generically.
  const shown = violations.filter((v) => v.severity !== 'info' && v.rule !== 'narrow_gap');
  const flagged = severityByItem(shown);
  const active = data.activeWallId;
  // Room outline: one hatched band per wall, outside the room, mitred into its neighbours at both inside and
  // outside corners (square ends next to a removed wall).
  const outline = roomOutline(room);
  const segs = segments(outline);
  const directions = directionLabels(outline);
  const wallOnSegment = new Map(
    data.walls.filter((w) => w.kind === 'wall' && !w.removed).map((w) => [segmentIndex(w), w]),
  );
  const wallBands = segs
    .filter((g) => wallOnSegment.has(g.index))
    .map((g) => {
      const prev = segs[(g.index + segs.length - 1) % segs.length];
      const next = segs[(g.index + 1) % segs.length];
      const out = (p: Pt, other: Segment | null) => ({
        x: p.x - T * g.n.x - (other ? T * other.n.x : 0),
        y: p.y - T * g.n.y - (other ? T * other.n.y : 0),
      });
      const pts = [
        g.p,
        g.q,
        out(g.q, wallOnSegment.has(next.index) ? next : null),
        out(g.p, wallOnSegment.has(prev.index) ? prev : null),
      ];
      return pts.map((q) => `${q.x * S},${q.y * S}`).join(' ');
    });
  const outsideArea = `M0 0H${W}V${D}H0Z M${outline.map((q) => `${q.x * S} ${q.y * S}`).join(' L')}Z`;
  const openingRect = (f: Frame, item: KitchenItem) => localRect(f, item.x, item.x + item.width, -T, 0);
  /** Footprint used for highlighting: openings sit in the wall, sockets on its face, everything else in the room. */
  const footprint = (f: Frame, item: KitchenItem, run: WallRun) =>
    isOpening(item.category)
      ? openingRect(f, item)
      : isElectrical(item.category)
        ? localRect(f, item.x, item.x + item.width, 0, 4)
        : planFootprint(data, run, item); // chairs round their seat (review finding R19)

  const itemProps = (run: WallRun, item: KitchenItem) => ({
    'data-item-id': item.id,
    style: interactive ? { cursor: 'grab' } : undefined,
    onPointerDown: onItemPointerDown ? (e: ReactPointerEvent) => onItemPointerDown(e, run, item) : undefined,
  });

  const text = (r: Rect, label: string, size = 9, weight = 600) => {
    const vertical = r.h > r.w * 1.2;
    return (
      <Label
        x={(r.x + r.w / 2) * S}
        y={(r.y + r.h / 2) * S}
        text={label}
        size={size}
        fill={INK}
        weight={weight}
        rotate={vertical ? -90 : undefined}
      />
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
        return (
          <rect {...px(localRect(f, item.x + 5, item.x + item.width - 5, item.depth - 8, item.depth - 3))} {...LINE} />
        );
      case 'fridge':
        return (
          <rect {...px(localRect(f, item.x + 3, item.x + item.width - 3, item.depth - 6, item.depth - 2))} {...LINE} />
        );
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
            return (
              <rect
                key={i}
                {...px(localRect(f, x0, x0 + bw, 9, Math.max(12, item.depth - 3)))}
                rx={4}
                fill="#f1f5f9"
                stroke={INK}
                strokeWidth={1.25}
              />
            );
          })}
          {item.hasFaucet && (
            <circle cx={faucet.x * S} cy={faucet.y * S} r={2 * S} fill="#ffffff" stroke={INK} strokeWidth={1.25} />
          )}
        </g>
      );
    }
    if (item.category === 'water_bar' || item.category === 'coffee_machine') {
      const body = localRect(f, item.x + 1, item.x + item.width - 1, 2, item.depth);
      const c = toPlan(f, item.x + item.width / 2, item.depth * (item.category === 'water_bar' ? 0.72 : 0.68));
      return (
        <g>
          <rect {...px(body)} rx={3} fill="#ffffff" stroke={INK} strokeWidth={1.25} />
          <circle
            cx={c.x * S}
            cy={c.y * S}
            r={Math.min(item.width, item.depth) * 0.16 * S}
            fill={item.category === 'water_bar' ? '#e0f2fe' : '#ffffff'}
            stroke={INK}
            strokeWidth={1}
          />
          {text(body, SHORT[item.category], 7)}
        </g>
      );
    }
    if (item.category === 'stove') {
      const n = item.burnerCount ?? 4;
      const d = item.depth;
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
      const r = Math.min(item.width, d) * (n === 5 ? 0.11 : 0.14) * S;
      return (
        <g>
          <rect
            {...px(localRect(f, item.x + 2, item.x + item.width - 2, 4, d - 2))}
            fill="#ffffff"
            stroke={INK}
            strokeWidth={1.5}
          />
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
        <marker id="aisleTick" viewBox="-4 -4 8 8" markerWidth={8} markerHeight={8} orient="auto">
          <line x1={0} y1={-3.5} x2={0} y2={3.5} stroke="#64748b" strokeWidth={1.5} />
        </marker>
        <pattern id="planWarnHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#fee2e2" />
          <line x1="0" y1="0" x2="0" y2="6" stroke={WARN} strokeWidth="2" />
        </pattern>
        <pattern id="planAmberHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#fee2e2" />
          <line x1="0" y1="0" x2="0" y2="6" stroke={AMBER} strokeWidth="2" />
        </pattern>
      </defs>

      <g transform={`translate(${planOrigin(S)} ${planOrigin(S)})`}>
        {/* Walls and floor */}
        {outline.length > 4 && <path d={outsideArea} fill="#e2e8f0" fillOpacity={0.5} fillRule="evenodd" />}
        {wallBands.map((points, i) => (
          <polygon
            key={i}
            points={points}
            fill="url(#planWallHatch)"
            stroke={INK}
            strokeWidth={1.75}
            strokeLinejoin="round"
          />
        ))}

        {/* Islands (#15): the countertop is the island (click to select, drag to move), its end profiles and a front
            arrow; its cabinets are drawn like any others, the countertop over them further down. */}
        {runs
          .filter(({ run }) => isIslandFront(run))
          .map(({ run }) => {
            const r = islandRect(run);
            const isActive = run.id === active || data.walls.some((w) => w.id === active && w.hostId === run.id);
            const color = isActive ? SELECT : THIN;
            // Arrow just outside the front edge, past any chairs standing there.
            const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
            const front = wallFrame(room, run).n;
            const half = (Math.abs(front.x) > 0.5 ? r.w : r.h) / 2;
            const reach = half + (run.items.some((i) => i.category === 'stool') ? 2 * STOOL_RADIUS_CM + 14 : 4);
            const tip = { x: c.x + front.x * (reach + 9), y: c.y + front.y * (reach + 9) };
            const side = { x: -front.y * 6, y: front.x * 6 };
            const base = { x: c.x + front.x * reach, y: c.y + front.y * reach };
            const all = islandFootprint(data, run);
            return (
              <g
                key={run.id}
                data-run-id={run.id}
                data-island={run.id}
                style={interactive ? { cursor: 'move' } : undefined}
                onPointerDown={onRunPointerDown ? (e) => onRunPointerDown(e, run) : undefined}
              >
                <rect {...px(r)} fill="#f8fafc" stroke={color} strokeWidth={isActive ? 2.5 : 1.5} />
                {endProfiles(run).map((pr) => (
                  <rect
                    key={pr.side}
                    data-profile={pr.kind}
                    {...px(pr.rect)}
                    fill={pr.kind === 'waterfall' ? '#94a3b8' : '#ffffff'}
                    stroke={INK}
                    strokeWidth={1.25}
                    style={{ pointerEvents: 'none' }}
                  />
                ))}
                <polygon
                  data-front-arrow
                  points={[tip, { x: base.x + side.x, y: base.y + side.y }, { x: base.x - side.x, y: base.y - side.y }]
                    .map((q) => `${q.x * S},${q.y * S}`)
                    .join(' ')}
                  fill={color}
                  style={{ pointerEvents: 'none' }}
                />
                <Label
                  x={(all.x + all.w) * S + 6}
                  y={(all.y + all.h / 2) * S}
                  anchor="start"
                  text={`${runName(run.name).toUpperCase()} ${fmt(run.widthCm)}×${fmt(run.depthCm ?? 90)}`}
                  size={8}
                  fill={color}
                  weight={600}
                />
              </g>
            );
          })}
        {/* Chairs (#14), on every island side */}
        {runs.flatMap(({ run }) =>
          run.items
            .filter((i) => i.category === 'stool')
            .map((st) => {
              const c = stoolPoint(data, run, st);
              const rr = Math.min(st.width, st.depth) / 2;
              return (
                <g key={st.id} {...itemProps(run, st)}>
                  <circle cx={c.x * S} cy={c.y * S} r={rr * S} fill="#ffffff" stroke={INK} strokeWidth={1.25} />
                  <circle cx={c.x * S} cy={c.y * S} r={rr * 0.45 * S} fill="none" stroke={THIN} strokeWidth={0.75} />
                  {selectedId === st.id && (
                    <circle cx={c.x * S} cy={c.y * S} r={rr * S + 3} fill="none" stroke={SELECT} strokeWidth={2} />
                  )}
                </g>
              );
            }),
        )}

        {/* Partition walls (#10): a hatched body; each half selects the face on that side, the tip sets the length */}
        {runs
          .filter(({ run }) => run.kind === 'partition' && run.face !== 'b')
          .map(({ run: a, f: fa }) => {
            const b = runs.find(
              ({ run }) => run.kind === 'partition' && run.partitionId === a.partitionId && run !== a,
            );
            const body = partitionRect(room, a);
            const L = a.widthCm;
            const activeFace = [a, b?.run].find((r) => r?.id === active);
            const af = activeFace === a ? fa : b?.f;
            const tip = toPlan(fa, L, -T / 2);
            const vertical = Math.abs(fa.u.y) > 0.5;
            const lp = toPlan(fa, L + 34, -T / 2);
            const half = (run: WallRun, f: Frame) => (
              <rect
                key={run.id}
                data-run-id={run.id}
                {...px(localRect(f, 0, L, -T / 2, 0))}
                fill="transparent"
                style={interactive ? { cursor: vertical ? 'ew-resize' : 'ns-resize' } : undefined}
                onPointerDown={onRunPointerDown ? (e) => onRunPointerDown(e, run) : undefined}
              />
            );
            return (
              <g key={`partition-${a.partitionId}`} data-partition={a.partitionId}>
                <rect {...px(body)} fill="url(#planWallHatch)" stroke={INK} strokeWidth={1.75} />
                {af && activeFace && (
                  <line
                    x1={toPlan(af, 0, 0).x * S}
                    y1={toPlan(af, 0, 0).y * S}
                    x2={toPlan(af, L, 0).x * S}
                    y2={toPlan(af, L, 0).y * S}
                    stroke={SELECT}
                    strokeWidth={4}
                    strokeOpacity={0.6}
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                {half(a, fa)}
                {b && half(b.run, b.f)}
                <Label
                  x={lp.x * S}
                  y={lp.y * S}
                  text={`${runName(a.name.match(/^Partition \d+/)?.[0] ?? a.name).toUpperCase()} · ${fmt(L)}`}
                  size={8}
                  weight={700}
                  fill={activeFace ? SELECT : THIN}
                  rotate={vertical ? -90 : undefined}
                />
                {interactive && onPartitionTipPointerDown && (
                  <g
                    data-partition-tip={a.partitionId}
                    style={{ cursor: vertical ? 'ns-resize' : 'ew-resize' }}
                    onPointerDown={(e) => onPartitionTipPointerDown(e, a)}
                  >
                    <title>Drag to change the partition's length</title>
                    <rect x={tip.x * S - 7} y={tip.y * S - 7} width={14} height={14} fill="transparent" />
                    <rect
                      x={tip.x * S - 4}
                      y={tip.y * S - 4}
                      width={8}
                      height={8}
                      fill="#fff"
                      stroke={SELECT}
                      strokeWidth={1.5}
                    />
                  </g>
                )}
              </g>
            );
          })}

        {/* Floor-standing units */}
        {runs.flatMap(({ run, f }) =>
          run.items
            .filter((i) => layerOf(i.category) === 'floor' && !isJoint(i))
            .map((item) => {
              const r = itemPlanRect(f, item);
              return (
                <g key={item.id} {...itemProps(run, item)}>
                  <rect
                    {...px(r)}
                    fill={item.category === 'corner_blocker' ? 'url(#planHatch)' : '#ffffff'}
                    stroke={INK}
                    strokeWidth={1.5}
                  />
                  {floorSymbol(f, item, r)}
                  {text(r, `${tr(SHORT[item.category])} ${fmt(item.width)}`, 8.5)}
                </g>
              );
            }),
        )}

        {/* Columns and pipe boxes (#6 phase 2): solid building elements against the wall */}
        {runs.flatMap(({ run, f }) =>
          run.items
            .filter((i) => i.category === 'column')
            .map((item) => {
              const r = itemPlanRect(f, item);
              return (
                <g key={item.id} {...itemProps(run, item)}>
                  <rect {...px(r)} fill="url(#planWallHatch)" stroke={INK} strokeWidth={1.75} />
                  {text(r, `${tr(SHORT[item.category])} ${fmt(item.width)}`, 8)}
                </g>
              );
            }),
        )}

        {/* Countertops: one piece over each island (#15), the parts that overhang shaded; along walls, per run */}
        {runs
          .filter(({ run }) => isIslandFront(run))
          .map(({ run }) => (
            <g key={`top-${run.id}`} style={{ pointerEvents: 'none' }}>
              <rect {...px(islandRect(run))} fill="#94a3b8" fillOpacity={0.18} stroke={INK} strokeWidth={1.25} />
              {islandOverhangs(data, run).map((o) => (
                <g key={o.face} data-overhang={o.face}>
                  <rect {...px(o.rect)} fill="url(#planHatch)" fillOpacity={0.35} />
                  <Label
                    x={(o.rect.x + o.rect.w / 2) * S}
                    y={(o.rect.y + o.rect.h / 2) * S}
                    text={tr('overhang {cm}', { cm: fmt(o.cantilever) })}
                    size={7.5}
                    fill={THIN}
                  />
                </g>
              ))}
            </g>
          ))}
        {runs
          .filter(({ run }) => run.kind !== 'island')
          .flatMap(({ run, f }) =>
            countertopRects(f, run).map((r, i) => (
              <rect
                key={`${run.id}-ct-${i}`}
                {...px(r)}
                fill="#94a3b8"
                fillOpacity={0.18}
                stroke={INK}
                strokeWidth={1}
                style={{ pointerEvents: 'none' }}
              />
            )),
          )}

        {/* Sink / cooktop on the counter */}
        {runs.flatMap(({ run, f }) =>
          run.items
            .filter((i) => layerOf(i.category) === 'counter')
            .map((item) => (
              <g key={item.id} {...itemProps(run, item)}>
                <rect {...px(itemPlanRect(f, item))} fill="transparent" />
                {counterSymbol(f, item)}
              </g>
            )),
        )}

        {/* Upper cabinets: dashed (above the cut plane) */}
        {runs.flatMap(({ run, f }) =>
          run.items
            .filter((i) => i.category === 'upper_cabinet' || i.category === 'shelf' || i.category === 'hood')
            .map((item) => {
              const r = itemPlanRect(f, item);
              return (
                <g key={item.id} {...itemProps(run, item)}>
                  <rect
                    {...px(r)}
                    fill="#eff6ff"
                    fillOpacity={0.35}
                    stroke={INK}
                    strokeWidth={1.25}
                    strokeDasharray="7 4"
                  />
                  <line
                    {...{ x1: r.x * S, y1: r.y * S, x2: (r.x + r.w) * S, y2: (r.y + r.h) * S }}
                    stroke={THIN}
                    strokeWidth={0.75}
                    strokeDasharray="4 4"
                  />
                </g>
              );
            }),
        )}

        {/* Wall hit areas, labels and windows */}
        {runs
          .filter(({ run }) => run.kind === 'wall' && run.removed)
          .map(({ run, f }) => {
            const a = toPlan(f, 0, 0);
            const b = toPlan(f, f.length, 0);
            const lp = toPlan(f, f.length / 2, -T - 7);
            const vertical = run.side === 'east' || run.side === 'west';
            return (
              <g key={run.id} style={{ pointerEvents: 'none' }}>
                <line
                  x1={a.x * S}
                  y1={a.y * S}
                  x2={b.x * S}
                  y2={b.y * S}
                  stroke={THIN}
                  strokeWidth={1}
                  strokeDasharray="10 4 2 4"
                />
                <Label
                  x={lp.x * S}
                  y={lp.y * S}
                  text={`${tr('OPEN')} · ${runName(run.name).toUpperCase()}`}
                  size={8.5}
                  fill="#94a3b8"
                  weight={700}
                  rotate={vertical ? (run.side === 'east' ? 90 : -90) : undefined}
                />
              </g>
            );
          })}
        {runs
          .filter(({ run }) => run.kind === 'wall' && !run.removed)
          .map(({ run, f }) => {
            const band = localRect(f, 0, f.length, -T, 0);
            const isActive = run.id === active;
            const inner = [toPlan(f, 0, 0), toPlan(f, f.length, 0)];
            const lp = toPlan(f, f.length / 2, -T - 7);
            const vertical = run.side === 'east' || run.side === 'west';
            return (
              <g
                key={run.id}
                data-run-id={run.id}
                onPointerDown={onRunPointerDown ? (e) => onRunPointerDown(e, run) : undefined}
                style={interactive ? { cursor: vertical ? 'ew-resize' : 'ns-resize' } : undefined}
              >
                <rect {...px(band)} fill="transparent" />
                {isActive && (
                  <line
                    x1={inner[0].x * S}
                    y1={inner[0].y * S}
                    x2={inner[1].x * S}
                    y2={inner[1].y * S}
                    stroke={SELECT}
                    strokeWidth={4}
                    strokeOpacity={0.6}
                  />
                )}
                <Label
                  x={lp.x * S}
                  y={lp.y * S}
                  text={`${runName(run.name).toUpperCase()} · ${directionName(directions[segmentIndex(run)] ?? '').toUpperCase()}${outline.length > 4 ? ` · ${fmt(f.length)}` : ''}`}
                  size={9}
                  weight={700}
                  fill={isActive ? SELECT : THIN}
                  rotate={vertical ? (run.side === 'east' ? 90 : -90) : undefined}
                />
                {run.items
                  .filter((i) => isElectrical(i.category))
                  .map((item) => {
                    const power = item.category === 'power_socket';
                    const lbl = toPlan(f, item.x + item.width / 2, 9);
                    return (
                      <g key={item.id} {...itemProps(run, item)}>
                        <rect
                          {...px(localRect(f, item.x, item.x + item.width, 0, 4))}
                          fill={power ? '#b91c1c' : '#ffffff'}
                          stroke={INK}
                          strokeWidth={1.25}
                        />
                        <Label
                          x={lbl.x * S}
                          y={lbl.y * S}
                          text={power ? '16A' : `S${item.socketCount ?? 1}`}
                          size={7}
                          fill={power ? '#b91c1c' : INK}
                          weight={700}
                        />
                      </g>
                    );
                  })}
                {run.items
                  .filter((i) => i.category === 'door')
                  .map((item) => {
                    const hingeX = item.doorHinge === 'right' ? item.x + item.width : item.x;
                    const freeX = item.doorHinge === 'right' ? item.x : item.x + item.width;
                    const out = item.doorSwing === 'out';
                    const base = out ? -T : 0; // the leaf hangs on the face it opens towards
                    const dir = out ? -1 : 1;
                    const hinge = toPlan(f, hingeX, base);
                    const leafEnd = toPlan(f, hingeX, base + dir * item.width);
                    const arc = Array.from({ length: 17 }, (_, k) => {
                      const a = (k / 16) * (Math.PI / 2);
                      const p = toPlan(
                        f,
                        hingeX + (freeX - hingeX) * Math.sin(a),
                        base + dir * item.width * Math.cos(a),
                      );
                      return `${p.x * S},${p.y * S}`;
                    }).join(' ');
                    return (
                      <g key={item.id} {...itemProps(run, item)}>
                        <rect {...px(openingRect(f, item))} fill="#ffffff" stroke={INK} strokeWidth={1.25} />
                        <polyline points={arc} fill="none" stroke={THIN} strokeWidth={0.9} strokeDasharray="4 3" />
                        <line
                          x1={hinge.x * S}
                          y1={hinge.y * S}
                          x2={leafEnd.x * S}
                          y2={leafEnd.y * S}
                          stroke={INK}
                          strokeWidth={2.5}
                        />
                      </g>
                    );
                  })}
                {run.items
                  .filter((i) => i.category === 'window')
                  .map((item) => {
                    const r = localRect(f, item.x, item.x + item.width, -T, 0);
                    const g1 = [toPlan(f, item.x, -T / 3), toPlan(f, item.x + item.width, -T / 3)];
                    const g2 = [toPlan(f, item.x, (-2 * T) / 3), toPlan(f, item.x + item.width, (-2 * T) / 3)];
                    return (
                      <g key={item.id} {...itemProps(run, item)}>
                        <rect {...px(r)} fill="#ffffff" stroke={INK} strokeWidth={1.25} />
                        {[g1, g2].map((g, i) => (
                          <line
                            key={i}
                            x1={g[0].x * S}
                            y1={g[0].y * S}
                            x2={g[1].x * S}
                            y2={g[1].y * S}
                            stroke={INK}
                            strokeWidth={0.9}
                          />
                        ))}
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
                    <rect {...px(r)} fill="url(#planAmberHatch)" stroke={AMBER} strokeWidth={1} />
                    <Badge x={c.x * S} y={c.y * S} text={tr('! GAP {w} cm', { w: g.width.toFixed(1) })} color={AMBER} />
                  </g>
                );
              }),
          ),
        )}
        {runs.flatMap(({ f, run }) =>
          run.items
            .filter((i) => flagged.has(i.id) && !isJoint(i))
            .map((item) => {
              const r = footprint(f, item, run);
              return (
                <rect
                  key={`flag-${item.id}`}
                  x={r.x * S - 2}
                  y={r.y * S - 2}
                  width={r.w * S + 4}
                  height={r.h * S + 4}
                  fill="none"
                  stroke={flagged.get(item.id) === 'error' ? WARN : AMBER}
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  style={{ pointerEvents: 'none' }}
                />
              );
            }),
        )}
        {shown
          .filter((v) => v.planArea)
          .map((v, i) => {
            const r = v.planArea!;
            const color = v.severity === 'error' ? WARN : AMBER;
            return (
              <g key={`viol-${i}`} style={{ pointerEvents: 'none' }}>
                {v.rule === 'outside_room' ? (
                  <rect {...px(r)} fill="none" stroke={color} strokeWidth={2} strokeDasharray="6 3" />
                ) : (
                  <rect
                    {...px(r)}
                    fill={`url(#${v.severity === 'error' ? 'planWarnHatch' : 'planAmberHatch'})`}
                    fillOpacity={0.7}
                  />
                )}
                <Badge x={(r.x + r.w / 2) * S} y={(r.y + r.h / 2) * S} text={v.badge} color={color} />
              </g>
            );
          })}

        {/* Aisles (#15): the distance from each side of an island to what faces it */}
        {runs
          .filter(({ run }) => isIslandFront(run))
          .flatMap(({ run }) =>
            islandClearances(data, run).map((c) => {
              const color = c.distance < AISLE_RED ? WARN : c.distance < AISLE_AMBER ? AMBER : THIN;
              const mid = { x: (c.from.x + c.to.x) / 2, y: (c.from.y + c.to.y) / 2 };
              const vertical = Math.abs(c.to.x - c.from.x) < 0.5;
              return (
                <g key={`aisle-${run.id}-${c.face}`} data-aisle={c.face} style={{ pointerEvents: 'none' }}>
                  <line
                    x1={c.from.x * S}
                    y1={c.from.y * S}
                    x2={c.to.x * S}
                    y2={c.to.y * S}
                    stroke={color}
                    strokeWidth={1.25}
                    strokeDasharray="5 3"
                    markerStart="url(#aisleTick)"
                    markerEnd="url(#aisleTick)"
                  />
                  {c.distance > 0 && (
                    <Label
                      x={mid.x * S + (vertical ? 4 : 0)}
                      y={mid.y * S + (vertical ? 0 : -6)}
                      anchor={vertical ? 'start' : 'middle'}
                      text={`${fmt(c.distance)}`}
                      size={9}
                      weight={700}
                      fill={color}
                    />
                  )}
                </g>
              );
            }),
          )}

        {/* Selection */}
        {interactive &&
          selectedId &&
          runs.map(({ run, f }) => {
            const item = run.items.find((i) => i.id === selectedId);
            if (!item || item.category === 'stool') return null; // chairs show their own selection ring
            const r = footprint(f, item, run);
            return (
              <rect
                key="sel"
                x={r.x * S - 3}
                y={r.y * S - 3}
                width={r.w * S + 6}
                height={r.h * S + 6}
                fill="none"
                stroke={SELECT}
                strokeWidth={2}
                style={{ pointerEvents: 'none' }}
              />
            );
          })}

        {/* Corner handles: the T × T square outside each corner, where the two wall bands meet */}
        {interactive &&
          onCornerPointerDown &&
          outline.map((c, k) => {
            const a = segs[(k + segs.length - 1) % segs.length].n;
            const b = segs[k].n;
            const o = { x: c.x - T * (a.x + b.x), y: c.y - T * (a.y + b.y) };
            const x = Math.min(c.x, o.x) * S;
            const y = Math.min(c.y, o.y) * S;
            return (
              <g
                key={`corner-${k}`}
                data-corner={k}
                onPointerDown={(e) => onCornerPointerDown(e, k)}
                style={{ cursor: 'move' }}
              >
                <title>Drag to move this corner</title>
                <rect x={x} y={y} width={t} height={t} fill="transparent" />
                <rect
                  x={x + t / 2 - 4}
                  y={y + t / 2 - 4}
                  width={8}
                  height={8}
                  fill="#fff"
                  stroke={SELECT}
                  strokeWidth={1.5}
                />
              </g>
            );
          })}

        {/* Room dimensions */}
        <DimH
          x0={0}
          x1={W}
          y={-t - 44}
          label={tr('ROOM {cm} cm', { cm: fmt(room.widthCm) })}
          color={INK}
          extFrom={-t - 4}
        />
        <DimV x={-t - 44} y0={0} y1={D} label={`${fmt(room.depthCm)} cm`} color={INK} extFrom={-t - 4} />
        <text x={W + t + 12} y={D + t} fontSize={8} fontFamily={FONT} fill={THIN} style={{ pointerEvents: 'none' }}>
          {tr('CEILING')} {fmt(room.heightCm)}
        </text>
      </g>
    </g>
  );
}
