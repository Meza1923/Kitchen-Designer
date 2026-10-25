import type { PointerEvent as ReactPointerEvent } from 'react';
import type { KitchenItem, WallRun } from '../types';
import { computeCountertops, computeGaps, computeOverlaps, computeSocketIssues, computeUnsupported, fmt, itemsInLayer, layerOf, type Gap } from '../lib/geometry';
import { FONT, INK, ItemShape, itemBounds, THIN, type ShapeContext } from './ItemShape';

export const PAD = { left: 80, right: 80, top: 90, bottom: 120 };
export const WARN = '#dc2626';
export const SELECT = '#2563eb';
const MUTED = '#64748b';

export function drawingSize(wall: WallRun, scale: number) {
  return {
    width: wall.widthCm * scale + PAD.left + PAD.right,
    height: wall.heightCm * scale + PAD.top + PAD.bottom,
  };
}

const textWidth = (s: string, size: number) => s.length * size * 0.62;

export function Label({ x, y, text, size = 9, fill = MUTED, weight = 400, anchor = 'middle', rotate }: { x: number; y: number; text: string; size?: number; fill?: string; weight?: number; anchor?: 'start' | 'middle' | 'end'; rotate?: number }) {
  return (
    <text x={x} y={y} fontSize={size} fontFamily={FONT} fill={fill} fontWeight={weight} textAnchor={anchor} dominantBaseline="middle" transform={rotate ? `rotate(${rotate} ${x} ${y})` : undefined} style={{ pointerEvents: 'none', userSelect: 'none' }}>
      {text}
    </text>
  );
}

/** Horizontal architectural dimension line with slash ticks and optional extension lines. */
export function DimH({ x0, x1, y, label, color = MUTED, extFrom }: { x0: number; x1: number; y: number; label: string; color?: string; extFrom?: number }) {
  const narrow = textWidth(label, 9) + 4 > x1 - x0;
  return (
    <g stroke={color} strokeWidth={0.9}>
      {extFrom !== undefined && (
        <>
          <line x1={x0} y1={extFrom} x2={x0} y2={y + (y > extFrom ? 4 : -4)} strokeDasharray="2 2" />
          <line x1={x1} y1={extFrom} x2={x1} y2={y + (y > extFrom ? 4 : -4)} strokeDasharray="2 2" />
        </>
      )}
      <line x1={x0} y1={y} x2={x1} y2={y} />
      <line x1={x0 - 3} y1={y + 3} x2={x0 + 3} y2={y - 3} strokeWidth={1.4} />
      <line x1={x1 - 3} y1={y + 3} x2={x1 + 3} y2={y - 3} strokeWidth={1.4} />
      <Label x={(x0 + x1) / 2} y={narrow ? y + 9 : y - 6} text={label} fill={color} size={narrow ? 8 : 9} />
    </g>
  );
}

export function DimV({ x, y0, y1, label, color = MUTED, extFrom }: { x: number; y0: number; y1: number; label: string; color?: string; extFrom?: number }) {
  return (
    <g stroke={color} strokeWidth={0.9}>
      {extFrom !== undefined && (
        <>
          <line x1={extFrom} y1={y0} x2={x + (x > extFrom ? 4 : -4)} y2={y0} strokeDasharray="2 2" />
          <line x1={extFrom} y1={y1} x2={x + (x > extFrom ? 4 : -4)} y2={y1} strokeDasharray="2 2" />
        </>
      )}
      <line x1={x} y1={y0} x2={x} y2={y1} />
      <line x1={x - 3} y1={y0 + 3} x2={x + 3} y2={y0 - 3} strokeWidth={1.4} />
      <line x1={x - 3} y1={y1 + 3} x2={x + 3} y2={y1 - 3} strokeWidth={1.4} />
      <Label x={x - 7} y={(y0 + y1) / 2} text={label} fill={color} rotate={-90} />
    </g>
  );
}

export function Badge({ x, y, text, color = WARN }: { x: number; y: number; text: string; color?: string }) {
  const w = textWidth(text, 9) + 10;
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={x - w / 2} y={y - 8} width={w} height={16} rx={3} fill={color} />
      <Label x={x} y={y + 0.5} text={text} fill="#ffffff" weight={700} />
    </g>
  );
}

function GapWarning({ gap, H, S }: { gap: Gap; H: number; S: number }) {
  const x = gap.x0 * S;
  const w = Math.max(gap.width * S, 2);
  const yTop = (H - gap.y1) * S;
  const h = (gap.y1 - gap.y0) * S;
  return (
    <g>
      <rect x={x} y={yTop} width={w} height={h} fill="url(#warnHatch)" stroke={WARN} strokeWidth={1.25} />
      <line x1={x + w / 2} y1={yTop} x2={x + w / 2} y2={yTop - 14} stroke={WARN} strokeWidth={1} />
      <Badge x={x + w / 2} y={yTop - 22} text={`! GAP: ${gap.width.toFixed(1)} cm (<10cm)`} />
    </g>
  );
}

export interface DrawingProps {
  wall: WallRun;
  scale: number;
  selectedId?: string | null;
  interactive?: boolean;
  onItemPointerDown?: (e: ReactPointerEvent, item: KitchenItem) => void;
}

/** The full schematic elevation of one wall, in px, with its origin at the top-left of the padded sheet. */
export function Drawing({ wall, scale: S, selectedId, interactive, onItemPointerDown }: DrawingProps) {
  const H = wall.heightCm;
  const W = wall.widthCm * S;
  const Hpx = H * S;
  const ctx: ShapeContext = { wallHeightCm: H, scale: S, countertopCm: wall.countertopThicknessCm };

  const floorGaps = computeGaps(wall, 'floor');
  const upperGaps = computeGaps(wall, 'upper');
  const overlaps = computeOverlaps(wall);
  const unsupported = computeUnsupported(wall);
  const socketIssues = computeSocketIssues(wall);
  const overlapIds = new Set([...overlaps.flatMap((o) => [o.a, o.b]), ...unsupported.map((i) => i.id), ...socketIssues.map((s) => s.item.id)]);
  const countertops = computeCountertops(wall);
  const floor = itemsInLayer(wall, 'floor').sort((a, b) => a.x - b.x);
  const upper = itemsInLayer(wall, 'upper').sort((a, b) => a.x - b.x);
  const counter = itemsInLayer(wall, 'counter');
  const electrical = itemsInLayer(wall, 'electrical');
  const selected = wall.items.find((i) => i.id === selectedId);

  const renderItem = (item: KitchenItem) => (
    <g
      key={item.id}
      data-item-id={item.id}
      style={interactive ? { cursor: ['upper', 'electrical'].includes(layerOf(item.category)) && item.category !== 'door' ? 'move' : 'ew-resize' } : undefined}
      onPointerDown={onItemPointerDown ? (e) => onItemPointerDown(e, item) : undefined}
    >
      <ItemShape item={item} ctx={ctx} />
    </g>
  );

  // Dimension rows (px, relative to the wall's top-left corner).
  const rowFloorLabels = Hpx + 16;
  const rowFloorChain = Hpx + 40;
  const rowCountertop = Hpx + 66;
  const rowUpperLabels = -14;
  const rowUpperChain = -36;
  const rowTotal = -66;
  const counterTopPx = countertops.length ? Math.max(...countertops.map((c) => c.y + c.thickness)) : null;

  return (
    <g>
      <defs>
        <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="#ffffff" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="#64748b" strokeWidth="1.2" />
        </pattern>
        <pattern id="warnHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#fee2e2" />
          <line x1="0" y1="0" x2="0" y2="6" stroke={WARN} strokeWidth="2" />
        </pattern>
        <pattern id="ground" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#94a3b8" strokeWidth="1" />
        </pattern>
      </defs>

      <g transform={`translate(${PAD.left} ${PAD.top})`}>
        {/* Wall, ceiling and floor */}
        <rect x={0} y={0} width={W} height={Hpx} fill="#ffffff" fillOpacity={0.55} stroke="#94a3b8" strokeWidth={1} />
        <line x1={-12} y1={0} x2={W + 12} y2={0} stroke={THIN} strokeWidth={1} strokeDasharray="10 4 2 4" />
        <Label x={W + 14} y={0} text="CEILING" anchor="start" size={8} />
        <rect x={-12} y={Hpx} width={W + 24} height={8} fill="url(#ground)" />
        <line x1={-12} y1={Hpx} x2={W + 12} y2={Hpx} stroke={INK} strokeWidth={2.5} />
        <Label x={W + 14} y={Hpx + 1} text="FFL ±0" anchor="start" size={8} />
        <line x1={0} y1={0} x2={0} y2={Hpx} stroke={INK} strokeWidth={2} />
        <line x1={W} y1={0} x2={W} y2={Hpx} stroke={INK} strokeWidth={2} />

        {/* Elements, back to front */}
        {floor.map(renderItem)}
        {countertops.map((c, i) => (
          <rect key={i} x={c.x * S} y={(H - c.y - c.thickness) * S} width={c.width * S} height={c.thickness * S} fill="#cbd5e1" stroke={INK} strokeWidth={1.75} style={{ pointerEvents: 'none' }} />
        ))}
        {upper.map(renderItem)}
        {counter.map(renderItem)}
        {electrical.map(renderItem)}

        {/* Validation */}
        {[...floorGaps, ...upperGaps].filter((g) => g.warning).map((g, i) => <GapWarning key={i} gap={g} H={H} S={S} />)}
        {wall.items.filter((i) => overlapIds.has(i.id)).map((i) => {
          const b = itemBounds(i, ctx);
          return <rect key={i.id} x={b.x - 2} y={b.y - 2} width={b.w + 4} height={b.h + 4} fill="none" stroke={WARN} strokeWidth={2} strokeDasharray="6 3" style={{ pointerEvents: 'none' }} />;
        })}
        {overlaps.map((o, i) => (
          <Badge key={i} x={((o.x0 + o.x1) / 2) * S} y={(H - (o.y0 + o.y1) / 2) * S} text="OVERLAP" />
        ))}
        {socketIssues.map(({ item: i, reason }) => {
          const b = itemBounds(i, ctx);
          return <Badge key={`sock-${i.id}`} x={b.x + b.w / 2} y={b.y - 16} text={reason === 'opening' ? 'SOCKET IN OPENING' : 'SOCKET HIDDEN'} />;
        })}
        {unsupported.map((i) => {
          const b = itemBounds(i, ctx);
          return <Badge key={i.id} x={b.x + b.w / 2} y={b.y - 12} text="NO COUNTERTOP" />;
        })}

        {/* Upper chain (above the wall) */}
        {upper.map((i) => (
          <Label key={i.id} x={(i.x + i.width / 2) * S} y={rowUpperLabels} text={`${i.label ? i.label + ' ' : ''}${fmt(i.width)}×${fmt(i.height)}`} size={8} />
        ))}
        {upper.map((i) => <DimH key={i.id} x0={i.x * S} x1={(i.x + i.width) * S} y={rowUpperChain} label={fmt(i.width)} />)}
        {upperGaps.map((g, i) => (
          <DimH key={i} x0={g.x0 * S} x1={g.x1 * S} y={rowUpperChain} label={fmt(g.width)} color={g.warning ? WARN : '#94a3b8'} />
        ))}
        <DimH x0={0} x1={W} y={rowTotal} label={`WALL ${fmt(wall.widthCm)} cm`} color={INK} extFrom={-4} />

        {/* Floor chain (below the wall) */}
        {floor.map((i) => (
          <Label key={i.id} x={(i.x + i.width / 2) * S} y={rowFloorLabels} text={`${i.label ? i.label + ' ' : ''}${fmt(i.width)}×${fmt(i.height)}`} size={8} />
        ))}
        {floor.map((i) => <DimH key={i.id} x0={i.x * S} x1={(i.x + i.width) * S} y={rowFloorChain} label={fmt(i.width)} extFrom={Hpx + 26} />)}
        {floorGaps.map((g, i) => (
          <DimH key={i} x0={g.x0 * S} x1={g.x1 * S} y={rowFloorChain} label={fmt(g.width)} color={g.warning ? WARN : '#94a3b8'} />
        ))}
        {countertops.map((c, i) => (
          <DimH key={i} x0={c.x * S} x1={(c.x + c.width) * S} y={rowCountertop} label={`COUNTERTOP ${fmt(c.width)}`} color={THIN} />
        ))}

        {/* Vertical dimensions */}
        <DimV x={-36} y0={0} y1={Hpx} label={`H ${fmt(H)} cm`} color={INK} extFrom={-4} />
        {counterTopPx !== null && (
          <DimV x={W + 62} y0={(H - counterTopPx) * S} y1={Hpx} label={`CT ${fmt(counterTopPx)}`} extFrom={W + 4} />
        )}

        {/* Selection */}
        {selected && interactive && (() => {
          const b = itemBounds(selected, ctx);
          return <rect x={b.x - 3} y={b.y - 3} width={b.w + 6} height={b.h + 6} fill="none" stroke={SELECT} strokeWidth={2} style={{ pointerEvents: 'none' }} />;
        })()}
      </g>
    </g>
  );
}
