import type { ReactNode } from 'react';
import type { KitchenItem, TallZoneConfig } from '../types';
import { boxHeight, fmt, layerOf, toScreenY } from '../lib/geometry';

export const INK = '#1e293b';
export const THIN = '#475569';
export const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const OUTLINE = { fill: '#ffffff', stroke: INK, strokeWidth: 1.75 };
const LINE = { stroke: THIN, strokeWidth: 1, fill: 'none' };
const HIDDEN = { stroke: THIN, strokeWidth: 1, fill: 'none', strokeDasharray: '4 3' };
const SWING = { stroke: '#94a3b8', strokeWidth: 0.75, fill: 'none', strokeDasharray: '5 4' };

/** Gap between adjacent fronts, in px. */
const REVEAL = 1.5;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShapeContext {
  wallHeightCm: number;
  scale: number;
  countertopCm: number;
}

/** Bounding box (px) of everything drawn for the item, used for hit-testing and highlight outlines. */
export function itemBounds(item: KitchenItem, ctx: ShapeContext): Box {
  const { wallHeightCm: H, scale: S, countertopCm: t } = ctx;
  const x = item.x * S;
  const w = item.width * S;
  if (item.category === 'sink') {
    const surface = (H - item.y - t) * S;
    const bottom = (H - item.y + item.height) * S;
    const faucetTop = item.hasFaucet ? surface - 32 * S : surface;
    return { x, y: faucetTop, w, h: bottom - faucetTop };
  }
  if (layerOf(item.category) === 'counter') {
    // Cooktop, water bar, coffee machine: stand on the countertop surface.
    const surface = (H - item.y - t) * S;
    return { x, y: surface - item.height * S, w, h: item.height * S };
  }
  return { x, y: toScreenY(H, item.y, item.height, S), w, h: item.height * S };
}

const Txt = ({
  x,
  y,
  size = 9,
  children,
  weight = 400,
  fill = THIN,
}: {
  x: number;
  y: number;
  size?: number;
  children: ReactNode;
  weight?: number;
  fill?: string;
}) => (
  <text
    x={x}
    y={y}
    fontSize={size}
    fontFamily={FONT}
    fontWeight={weight}
    fill={fill}
    stroke="#ffffff"
    strokeWidth={3}
    paintOrder="stroke"
    textAnchor="middle"
    dominantBaseline="middle"
    style={{ pointerEvents: 'none', userSelect: 'none' }}
  >
    {children}
  </text>
);

function Door({ b, hinge, handleAt }: { b: Box; hinge: 'left' | 'right'; handleAt: 'top' | 'bottom' | 'middle' }) {
  const hx = hinge === 'left' ? b.x + b.w - 5 : b.x + 5;
  const hy =
    handleAt === 'top' ? b.y + 6 : handleAt === 'bottom' ? b.y + b.h - 6 - Math.min(16, b.h * 0.25) : b.y + b.h / 2 - 8;
  const len = Math.min(16, b.h * 0.25);
  const apexX = hinge === 'left' ? b.x : b.x + b.w;
  const openX = hinge === 'left' ? b.x + b.w : b.x;
  return (
    <g>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} {...LINE} />
      <polyline points={`${openX},${b.y} ${apexX},${b.y + b.h / 2} ${openX},${b.y + b.h}`} {...SWING} />
      <line x1={hx} y1={hy} x2={hx} y2={hy + len} stroke={INK} strokeWidth={2} />
    </g>
  );
}

function Drawers({ b, pcts, scale }: { b: Box; pcts: number[]; scale: number }) {
  const total = pcts.reduce((s, p) => s + p, 0) || 1;
  let y = b.y;
  return (
    <g>
      {pcts.map((p, i) => {
        const h = (p / total) * b.h;
        const face = { x: b.x, y, w: b.w, h };
        y += h;
        const pullY = face.y + Math.min(face.h / 2, 8);
        const pullW = Math.min(face.w * 0.35, 30);
        return (
          <g key={i}>
            <rect
              x={face.x}
              y={face.y + (i ? REVEAL / 2 : 0)}
              width={face.w}
              height={face.h - (i ? REVEAL / 2 : 0) - (i < pcts.length - 1 ? REVEAL / 2 : 0)}
              {...LINE}
            />
            <line
              x1={face.x + face.w / 2 - pullW / 2}
              y1={pullY}
              x2={face.x + face.w / 2 + pullW / 2}
              y2={pullY}
              stroke={INK}
              strokeWidth={2}
            />
            {face.h > 18 && (
              <Txt x={face.x + face.w / 2} y={face.y + face.h / 2 + (face.h > 26 ? 4 : 2)} size={face.h > 24 ? 9 : 7.5}>
                {fmt(face.h / scale)} cm
              </Txt>
            )}
          </g>
        );
      })}
    </g>
  );
}

function Plinth({ x, w, bottom, h }: { x: number; w: number; bottom: number; h: number }) {
  if (h <= 0) return null;
  return <rect x={x + 3} y={bottom - h} width={w - 6} height={h} fill="#e2e8f0" stroke={THIN} strokeWidth={1} />;
}

function frontsBox(item: KitchenItem, ctx: ShapeContext): { outer: Box; fronts: Box; plinth: number } {
  const S = ctx.scale;
  const outer = itemBounds(item, ctx);
  const plinth = item.hasToeKick ? item.toeKickHeight * S : 0;
  const fronts = {
    x: outer.x + REVEAL,
    y: outer.y + REVEAL,
    w: outer.w - 2 * REVEAL,
    h: boxHeight(item) * S - 2 * REVEAL,
  };
  return { outer, fronts, plinth };
}

function CabinetFronts({ item, b, scale, upper }: { item: KitchenItem; b: Box; scale: number; upper: boolean }) {
  if (item.frontType === 'drawers') {
    const pcts =
      item.drawerSplitPcts.length === item.drawerCount ? item.drawerSplitPcts : Array(item.drawerCount).fill(1);
    return <Drawers b={b} pcts={pcts} scale={scale} />;
  }
  const handleAt = upper ? 'bottom' : 'top';
  if (item.doorCount === 2) {
    const half = (b.w - REVEAL) / 2;
    return (
      <g>
        <Door b={{ ...b, w: half }} hinge="left" handleAt={handleAt} />
        <Door b={{ ...b, x: b.x + half + REVEAL, w: half }} hinge="right" handleAt={handleAt} />
      </g>
    );
  }
  return <Door b={b} hinge="left" handleAt={handleAt} />;
}

/** Front of a coffee machine (freestanding or built-in) inside box `b`. */
function CoffeeFront({ b, framed }: { b: Box; framed: boolean }) {
  const cx = b.x + b.w / 2;
  const panel = Math.min(b.h * 0.24, 22);
  const head = { x: cx - b.w * 0.18, y: b.y + panel + 3, w: b.w * 0.36, h: Math.min(6, b.h * 0.08) };
  const cupW = Math.min(b.w * 0.22, 14);
  const cupH = Math.min(b.h * 0.2, 14);
  const trayY = b.y + b.h - Math.min(6, b.h * 0.08);
  return (
    <g>
      {framed && <rect x={b.x} y={b.y} width={b.w} height={b.h} {...LINE} />}
      <line x1={b.x} y1={b.y + panel} x2={b.x + b.w} y2={b.y + panel} {...LINE} />
      {[0.2, 0.8].map((f) => (
        <circle key={f} cx={b.x + b.w * f} cy={b.y + panel / 2} r={Math.min(2.5, panel / 4)} {...LINE} />
      ))}
      <rect x={head.x} y={head.y} width={head.w} height={head.h} {...LINE} />
      <line x1={cx - 3} y1={head.y + head.h} x2={cx - 3} y2={head.y + head.h + 4} stroke={INK} strokeWidth={1.25} />
      <line x1={cx + 3} y1={head.y + head.h} x2={cx + 3} y2={head.y + head.h + 4} stroke={INK} strokeWidth={1.25} />
      <path
        d={`M ${cx - cupW / 2} ${trayY - cupH} h ${cupW} l -2 ${cupH} h ${-(cupW - 4)} Z`}
        fill="#ffffff"
        stroke={INK}
        strokeWidth={1.25}
      />
      <line x1={b.x + 4} y1={trayY} x2={b.x + b.w - 4} y2={trayY} stroke={INK} strokeWidth={1.5} />
      <Txt x={cx} y={b.y + panel / 2} size={b.w > 70 ? 8 : 6.5} weight={700}>
        COFFEE
      </Txt>
    </g>
  );
}

function TallZone({ zone, b, scale }: { zone: TallZoneConfig; b: Box; scale: number }) {
  const cx = b.x + b.w / 2;
  switch (zone.type) {
    case 'door':
      return <Door b={b} hinge="left" handleAt="middle" />;
    case 'drawers':
      return <Drawers b={b} pcts={Array(Math.max(1, zone.drawerCount ?? 3)).fill(1)} scale={scale} />;
    case 'oven': {
      const strip = Math.min(b.h * 0.18, 14);
      const win = { x: b.x + b.w * 0.14, y: b.y + strip + 12, w: b.w * 0.72, h: b.h - strip - 20 };
      return (
        <g>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} {...LINE} />
          <line x1={b.x} y1={b.y + strip} x2={b.x + b.w} y2={b.y + strip} {...LINE} />
          {[0.2, 0.8].map((f) => (
            <circle key={f} cx={b.x + b.w * f} cy={b.y + strip / 2} r={Math.min(3, strip / 3)} {...LINE} />
          ))}
          <line
            x1={b.x + b.w * 0.2}
            y1={b.y + strip + 6}
            x2={b.x + b.w * 0.8}
            y2={b.y + strip + 6}
            stroke={INK}
            strokeWidth={2}
          />
          {win.h > 6 && (
            <rect
              x={win.x}
              y={win.y}
              width={win.w}
              height={win.h}
              rx={3}
              fill="#f1f5f9"
              stroke={THIN}
              strokeWidth={1}
            />
          )}
          <Txt x={cx} y={b.y + strip / 2} size={8} weight={700}>
            OVEN
          </Txt>
        </g>
      );
    }
    case 'microwave': {
      const win = { x: b.x + 5, y: b.y + 5, w: b.w * 0.64, h: b.h - 10 };
      const panelX = win.x + win.w + 5;
      return (
        <g>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} {...LINE} />
          <rect x={win.x} y={win.y} width={win.w} height={win.h} rx={2} fill="#f1f5f9" stroke={THIN} strokeWidth={1} />
          <line x1={panelX - 2} y1={b.y} x2={panelX - 2} y2={b.y + b.h} {...LINE} />
          {[0.3, 0.55].map((f) => (
            <rect
              key={f}
              x={panelX + 2}
              y={b.y + b.h * f - 2}
              width={Math.max(4, b.x + b.w - panelX - 7)}
              height={4}
              {...LINE}
            />
          ))}
          <Txt x={win.x + win.w / 2} y={win.y + win.h / 2} size={8} weight={700}>
            MW
          </Txt>
        </g>
      );
    }
    case 'coffee':
      return <CoffeeFront b={b} framed />;
    case 'open':
      return (
        <g>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="#f8fafc" stroke={THIN} strokeWidth={1} />
          <line x1={b.x} y1={b.y + b.h / 2} x2={b.x + b.w} y2={b.y + b.h / 2} {...HIDDEN} />
          <Txt x={cx} y={b.y + b.h / 4} size={8}>
            OPEN
          </Txt>
        </g>
      );
  }
}

export function ItemShape({ item, ctx }: { item: KitchenItem; ctx: ShapeContext }) {
  const S = ctx.scale;
  const ob = itemBounds(item, ctx);
  const cx = ob.x + ob.w / 2;

  switch (item.category) {
    case 'base_cabinet':
    case 'upper_cabinet': {
      const { outer, fronts, plinth } = frontsBox(item, ctx);
      return (
        <g>
          <rect x={outer.x} y={outer.y} width={outer.w} height={outer.h - plinth} {...OUTLINE} />
          <Plinth x={outer.x} w={outer.w} bottom={outer.y + outer.h} h={plinth} />
          <CabinetFronts item={item} b={fronts} scale={S} upper={item.category === 'upper_cabinet'} />
        </g>
      );
    }
    case 'tall_cabinet': {
      const { outer, fronts, plinth } = frontsBox(item, ctx);
      const zones = item.tallZones ?? [];
      const total = zones.reduce((s, z) => s + z.heightPct, 0) || 1;
      let bottom = fronts.y + fronts.h;
      return (
        <g>
          <rect x={outer.x} y={outer.y} width={outer.w} height={outer.h - plinth} {...OUTLINE} />
          <Plinth x={outer.x} w={outer.w} bottom={outer.y + outer.h} h={plinth} />
          {zones.map((z) => {
            const h = (z.heightPct / total) * fronts.h;
            bottom -= h;
            const b = { x: fronts.x, y: bottom + REVEAL / 2, w: fronts.w, h: h - REVEAL };
            return <TallZone key={z.id} zone={z} b={b} scale={S} />;
          })}
        </g>
      );
    }
    case 'corner_blocker': {
      const { outer, plinth } = frontsBox(item, ctx);
      const midY = outer.y + (outer.h - plinth) / 2;
      return (
        <g>
          <rect
            x={outer.x}
            y={outer.y}
            width={outer.w}
            height={outer.h - plinth}
            fill="url(#hatch)"
            stroke={INK}
            strokeWidth={1.75}
          />
          <Plinth x={outer.x} w={outer.w} bottom={outer.y + outer.h} h={plinth} />
          <rect
            x={cx - Math.min(outer.w / 2 - 4, 58)}
            y={midY - 14}
            width={Math.min(outer.w - 8, 116)}
            height={28}
            fill="#ffffff"
            stroke={THIN}
            strokeWidth={0.75}
          />
          <Txt x={cx} y={midY - 6} size={outer.w > 120 ? 9 : 7} weight={700}>
            CORNER
          </Txt>
          <Txt x={cx} y={midY + 6} size={outer.w > 120 ? 9 : 7} weight={700}>
            INTERSECTION
          </Txt>
        </g>
      );
    }
    case 'fridge': {
      const half = (ob.w - 3 * REVEAL) / 2;
      const top = ob.y + REVEAL;
      const h = ob.h - 2 * REVEAL - 6;
      return (
        <g>
          <rect x={ob.x} y={ob.y} width={ob.w} height={ob.h} rx={3} {...OUTLINE} />
          <rect x={ob.x + REVEAL} y={top} width={half} height={h} {...LINE} />
          <rect x={ob.x + 2 * REVEAL + half} y={top} width={half} height={h} {...LINE} />
          <line x1={cx - 5} y1={top + h * 0.3} x2={cx - 5} y2={top + h * 0.6} stroke={INK} strokeWidth={2.5} />
          <line x1={cx + 5} y1={top + h * 0.3} x2={cx + 5} y2={top + h * 0.6} stroke={INK} strokeWidth={2.5} />
          <line x1={ob.x + 4} y1={ob.y + ob.h - 4} x2={ob.x + ob.w - 4} y2={ob.y + ob.h - 4} {...LINE} />
          <Txt x={cx} y={top + 16} size={10} weight={700}>
            FRIDGE
          </Txt>
        </g>
      );
    }
    case 'washing_machine': {
      const panel = Math.min(ob.h * 0.16, 16 * (S / 2));
      const bodyH = ob.h - panel;
      const r = Math.min(ob.w, bodyH) * 0.36;
      const cy = ob.y + panel + bodyH / 2;
      return (
        <g>
          <rect x={ob.x} y={ob.y} width={ob.w} height={ob.h} rx={2} {...OUTLINE} />
          <line x1={ob.x} y1={ob.y + panel} x2={ob.x + ob.w} y2={ob.y + panel} {...LINE} />
          <rect x={ob.x + 6} y={ob.y + panel / 2 - 3} width={ob.w * 0.3} height={6} {...LINE} />
          <circle cx={ob.x + ob.w - 12} cy={ob.y + panel / 2} r={Math.min(5, panel / 2.5)} {...LINE} />
          <circle cx={cx} cy={cy} r={r} fill="#ffffff" stroke={INK} strokeWidth={1.5} />
          <circle cx={cx} cy={cy} r={r * 0.72} fill="#f1f5f9" stroke={THIN} strokeWidth={1} />
          <line x1={cx + r * 0.85} y1={cy - 4} x2={cx + r * 0.85} y2={cy + 4} stroke={INK} strokeWidth={2} />
        </g>
      );
    }
    case 'under_counter_oven': {
      const { outer, fronts, plinth } = frontsBox(item, ctx);
      const strip = Math.min(fronts.h * 0.16, 22);
      const door = { x: fronts.x, y: fronts.y + strip + REVEAL, w: fronts.w, h: fronts.h - strip - REVEAL };
      const win = { x: door.x + door.w * 0.12, y: door.y + 16, w: door.w * 0.76, h: door.h - 26 };
      return (
        <g>
          <rect x={outer.x} y={outer.y} width={outer.w} height={outer.h - plinth} {...OUTLINE} />
          <Plinth x={outer.x} w={outer.w} bottom={outer.y + outer.h} h={plinth} />
          <rect x={fronts.x} y={fronts.y} width={fronts.w} height={strip} {...LINE} />
          {[0.15, 0.3, 0.7, 0.85].map((f) => (
            <circle
              key={f}
              cx={fronts.x + fronts.w * f}
              cy={fronts.y + strip / 2}
              r={Math.min(3.5, strip / 3)}
              {...LINE}
            />
          ))}
          <Txt x={cx} y={fronts.y + strip / 2} size={8} weight={700}>
            OVEN
          </Txt>
          <rect x={door.x} y={door.y} width={door.w} height={door.h} {...LINE} />
          <line
            x1={door.x + door.w * 0.15}
            y1={door.y + 7}
            x2={door.x + door.w * 0.85}
            y2={door.y + 7}
            stroke={INK}
            strokeWidth={2.5}
          />
          {win.h > 6 && (
            <rect
              x={win.x}
              y={win.y}
              width={win.w}
              height={win.h}
              rx={4}
              fill="#f1f5f9"
              stroke={THIN}
              strokeWidth={1}
            />
          )}
        </g>
      );
    }
    case 'sink': {
      const surface = (ctx.wallHeightCm - item.y - ctx.countertopCm) * S;
      const underside = (ctx.wallHeightCm - item.y) * S;
      const depth = item.height * S;
      const inset = Math.min(4 * S, ob.w / 6);
      const bowls = item.sinkBowls ?? 1;
      const divider = bowls === 2 ? 3 * S : 0;
      const bowlW = (ob.w - 2 * inset - divider) / bowls;
      const faucetX = cx - 6 * S;
      return (
        <g>
          <rect x={ob.x} y={ob.y} width={ob.w} height={ob.h} fill="transparent" />
          {Array.from({ length: bowls }, (_, i) => (
            <path
              key={i}
              d={`M ${ob.x + inset + i * (bowlW + divider)} ${underside} v ${depth - 4} q 0 4 4 4 h ${bowlW - 8} q 4 0 4 -4 v ${-(depth - 4)}`}
              {...HIDDEN}
              stroke={INK}
            />
          ))}
          <line x1={ob.x + inset} y1={surface} x2={ob.x + ob.w - inset} y2={surface} stroke={INK} strokeWidth={2.5} />
          <Txt x={cx} y={underside + depth + 8} size={7.5}>
            SINK
          </Txt>
          {item.hasFaucet && (
            <g>
              <rect
                x={faucetX - 2.5 * S}
                y={surface - 2 * S}
                width={5 * S}
                height={2 * S}
                fill="#ffffff"
                stroke={INK}
                strokeWidth={1.25}
              />
              <path
                d={`M ${faucetX} ${surface - 2 * S} V ${surface - 26 * S} A ${6 * S} ${6 * S} 0 0 1 ${faucetX + 12 * S} ${surface - 26 * S} V ${surface - 20 * S}`}
                fill="none"
                stroke={INK}
                strokeWidth={2}
                strokeLinecap="round"
              />
              <line
                x1={faucetX}
                y1={surface - 14 * S}
                x2={faucetX + 3.5 * S}
                y2={surface - 16 * S}
                stroke={INK}
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            </g>
          )}
        </g>
      );
    }
    case 'stove': {
      const n = item.burnerCount ?? 4;
      const r = Math.max(2.5, Math.min(ob.h * 0.36, ob.w / n / 3));
      return (
        <g>
          <rect x={ob.x} y={ob.y} width={ob.w} height={ob.h} fill="#ffffff" stroke={INK} strokeWidth={1.75} />
          {Array.from({ length: n }, (_, i) => {
            const bx = ob.x + ((i + 0.5) / n) * ob.w;
            const by = ob.y + ob.h / 2;
            return (
              <g key={i}>
                <circle cx={bx} cy={by} r={r} {...LINE} />
                <line x1={bx - r - 2} y1={by} x2={bx + r + 2} y2={by} {...LINE} />
                <line x1={bx} y1={by - r - 2} x2={bx} y2={by + r + 2} {...LINE} />
              </g>
            );
          })}
          <Txt x={cx} y={ob.y - 7} size={7.5}>
            COOKTOP
          </Txt>
        </g>
      );
    }
    case 'water_bar': {
      const head = Math.min(ob.h * 0.32, 30);
      const glassW = Math.min(ob.w * 0.36, 12);
      const glassH = Math.min(ob.h * 0.28, 16);
      const trayY = ob.y + ob.h - 5;
      return (
        <g>
          <rect x={ob.x} y={ob.y} width={ob.w} height={ob.h} rx={3} {...OUTLINE} />
          <rect
            x={ob.x + 4}
            y={ob.y + 4}
            width={ob.w - 8}
            height={head - 6}
            rx={2}
            fill="#f1f5f9"
            stroke={THIN}
            strokeWidth={1}
          />
          <line x1={cx} y1={ob.y + head} x2={cx} y2={ob.y + head + 6} stroke={INK} strokeWidth={2.5} />
          <path
            d={`M ${cx - glassW / 2} ${trayY - glassH} h ${glassW} l -1.5 ${glassH} h ${-(glassW - 3)} Z`}
            fill="#e0f2fe"
            stroke={INK}
            strokeWidth={1.25}
          />
          <line x1={ob.x + 3} y1={trayY} x2={ob.x + ob.w - 3} y2={trayY} stroke={INK} strokeWidth={1.5} />
          <Txt x={cx} y={ob.y + head / 2} size={6.5} weight={700}>
            WATER
          </Txt>
        </g>
      );
    }
    case 'coffee_machine':
      return (
        <g>
          <rect x={ob.x} y={ob.y} width={ob.w} height={ob.h} rx={2} {...OUTLINE} />
          <CoffeeFront b={ob} framed={false} />
        </g>
      );
    case 'door': {
      const trim = 2.5 * S;
      const hingeLeft = item.doorHinge !== 'right';
      const leaf = { x: ob.x + REVEAL, y: ob.y + REVEAL, w: ob.w - 2 * REVEAL, h: ob.h - REVEAL };
      const apexX = hingeLeft ? leaf.x : leaf.x + leaf.w;
      const openX = hingeLeft ? leaf.x + leaf.w : leaf.x;
      const handleY = ob.y + ob.h - 105 * S;
      const handleX = hingeLeft ? leaf.x + leaf.w - 6 : leaf.x + 6;
      return (
        <g>
          <path
            d={`M ${ob.x - trim} ${ob.y + ob.h} V ${ob.y - trim} H ${ob.x + ob.w + trim} V ${ob.y + ob.h}`}
            fill="#ffffff"
            stroke={INK}
            strokeWidth={1.5}
          />
          <rect x={ob.x} y={ob.y} width={ob.w} height={ob.h} fill="#ffffff" stroke={INK} strokeWidth={1.75} />
          <rect x={leaf.x} y={leaf.y} width={leaf.w} height={leaf.h} {...LINE} />
          <polyline
            points={`${openX},${leaf.y} ${apexX},${leaf.y + leaf.h / 2} ${openX},${leaf.y + leaf.h}`}
            {...SWING}
          />
          <line
            x1={handleX}
            y1={handleY}
            x2={handleX + (hingeLeft ? -12 : 12)}
            y2={handleY}
            stroke={INK}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <circle cx={handleX} cy={handleY} r={2.5} fill="#ffffff" stroke={INK} strokeWidth={1.25} />
          <Txt x={cx} y={ob.y + 18} size={9} weight={700}>
            DOOR
          </Txt>
          <Txt x={cx} y={ob.y + 30} size={7}>
            {item.doorSwing === 'out' ? 'OPENS OUT' : 'OPENS IN'}
          </Txt>
        </g>
      );
    }
    case 'socket':
    case 'power_socket': {
      const power = item.category === 'power_socket';
      const n = power ? 1 : (item.socketCount ?? 1);
      const cell = ob.w / n;
      const r = Math.min(cell, ob.h) * 0.34;
      return (
        <g>
          <rect x={ob.x} y={ob.y} width={ob.w} height={ob.h} rx={2} fill="#ffffff" stroke={INK} strokeWidth={1.25} />
          {Array.from({ length: n }, (_, i) => {
            const sx = ob.x + cell * (i + 0.5);
            const sy = ob.y + ob.h / 2;
            return (
              <g key={i}>
                <circle
                  cx={sx}
                  cy={sy}
                  r={r}
                  fill={power ? '#fee2e2' : '#f8fafc'}
                  stroke={power ? '#b91c1c' : INK}
                  strokeWidth={power ? 1.5 : 1}
                />
                <circle cx={sx - r * 0.42} cy={sy} r={Math.max(0.8, r * 0.14)} fill={INK} />
                <circle cx={sx + r * 0.42} cy={sy} r={Math.max(0.8, r * 0.14)} fill={INK} />
              </g>
            );
          })}
          {power && (
            <Txt x={cx} y={ob.y - 6} size={6.5} weight={700} fill="#b91c1c">
              16A
            </Txt>
          )}
          <Txt x={cx} y={ob.y + ob.h + 6} size={6}>{`h ${fmt(item.y + item.height / 2)}`}</Txt>
        </g>
      );
    }
    case 'window': {
      const f = Math.min(5 * S, ob.w / 5, ob.h / 5);
      const inner = { x: ob.x + f, y: ob.y + f, w: ob.w - 2 * f, h: ob.h - 2 * f };
      const sill = 2 * S;
      return (
        <g>
          <rect x={ob.x} y={ob.y} width={ob.w} height={ob.h} {...OUTLINE} />
          <rect
            x={inner.x}
            y={inner.y}
            width={inner.w}
            height={inner.h}
            fill="#f1f5f9"
            stroke={INK}
            strokeWidth={1.25}
          />
          <line
            x1={inner.x + inner.w / 2}
            y1={inner.y}
            x2={inner.x + inner.w / 2}
            y2={inner.y + inner.h}
            stroke={INK}
            strokeWidth={1.25}
          />
          <line
            x1={inner.x}
            y1={inner.y + inner.h / 2}
            x2={inner.x + inner.w}
            y2={inner.y + inner.h / 2}
            stroke={INK}
            strokeWidth={1.25}
          />
          {[0, 1].map((col) => (
            <line
              key={col}
              x1={inner.x + (col * inner.w) / 2 + inner.w * 0.08}
              y1={inner.y + inner.h * 0.4}
              x2={inner.x + (col * inner.w) / 2 + inner.w * 0.2}
              y2={inner.y + inner.h * 0.1}
              stroke="#94a3b8"
              strokeWidth={0.75}
            />
          ))}
          <rect
            x={ob.x - 3 * S}
            y={ob.y + ob.h}
            width={ob.w + 6 * S}
            height={sill}
            fill="#ffffff"
            stroke={INK}
            strokeWidth={1.25}
          />
        </g>
      );
    }
  }
}
