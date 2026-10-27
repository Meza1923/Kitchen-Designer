import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Copy, Lock, Plus, Trash2, Unlock, X } from 'lucide-react';
import type { KitchenItem, TallZoneConfig, TallZoneType, WallRun } from '../types';
import {
  CATEGORY_LABELS,
  DEPTH_PRESETS,
  equalSplit,
  makeZone,
  SIDE_LABELS,
  SOCKET_HEIGHT_PRESETS,
  socketName,
  socketWidth,
  TALL_ZONE_LABELS,
  WIDTH_PRESETS,
} from '../lib/defaults';
import {
  boxHeight,
  fmt,
  hasCabinetFronts,
  hasToeKickOption,
  isCounterBearing,
  isElectrical,
  isWallMounted,
  layerOf,
  round1,
} from '../lib/geometry';

export function NumField({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  suffix = 'cm',
  className = '',
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  suffix?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(round1(value)));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(String(round1(value)));
  }, [value, focused]);

  // While typing, only in-range values are applied; on blur the value is clamped.
  const commit = (s: string, clamp: boolean) => {
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (!clamp && clamped !== n) return;
    if (round1(clamped) !== round1(value)) onChange(round1(clamped));
  };

  return (
    <div className={`relative ${className}`}>
      <input
        type="number"
        className="field pr-8 font-mono disabled:bg-slate-100 disabled:text-slate-400"
        value={draft}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit(draft, true);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          commit(e.target.value, false);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
          {suffix}
        </span>
      )}
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="border-b border-slate-200 px-4 py-3">
    <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-700">{title}</h3>
    <div className="space-y-2.5">{children}</div>
  </section>
);

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <span className="label">{label}</span>
    {children}
  </div>
);

export function Chips<T extends string | number>({
  options,
  value,
  onChange,
  render,
}: {
  options: T[];
  value: T | null;
  onChange: (v: T) => void;
  render?: (v: T) => ReactNode;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button key={String(o)} className={`chip ${o === value ? 'chip-active' : ''}`} onClick={() => onChange(o)}>
          {render ? render(o) : o}
        </button>
      ))}
    </div>
  );
}

const sum = (xs: number[]) => round1(xs.reduce((s, x) => s + x, 0));

const normalizePcts = (pcts: number[]): number[] => {
  const total = pcts.reduce((s, p) => s + p, 0);
  if (total <= 0) return equalSplit(pcts.length);
  const scaled = pcts.map((p) => round1((p / total) * 100));
  scaled[scaled.length - 1] = round1(100 - sum(scaled.slice(0, -1)));
  return scaled;
};

const DRAWER_PRESETS: { label: string; pcts: (n: number) => number[]; count?: number }[] = [
  { label: 'Equal Split', pcts: (n) => equalSplit(n) },
  { label: '1 Thin + 2 Deep (20/40/40)', pcts: () => [20, 40, 40], count: 3 },
  { label: '2 Thin + 1 Deep (25/25/50)', pcts: () => [25, 25, 50], count: 3 },
];

function SumBadge({ total, onNormalize }: { total: number; onNormalize: () => void }) {
  const ok = Math.abs(total - 100) < 0.05;
  return (
    <div
      className={`flex items-center justify-between rounded px-2 py-1 text-xs ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}
    >
      <span className="font-mono">
        Σ {fmt(total)}% {ok ? '✓' : '≠ 100%'}
      </span>
      {!ok && (
        <button className="font-semibold underline" onClick={onNormalize}>
          Normalize
        </button>
      )}
    </div>
  );
}

function DrawerConfig({ item, onChange }: { item: KitchenItem; onChange: (p: Partial<KitchenItem>) => void }) {
  const usable = boxHeight(item);
  const pcts = item.drawerSplitPcts.length === item.drawerCount ? item.drawerSplitPcts : equalSplit(item.drawerCount);
  const setPct = (i: number, v: number) => onChange({ drawerSplitPcts: pcts.map((p, j) => (j === i ? v : p)) });
  return (
    <>
      <Field label="Number of drawers">
        <Chips
          options={[1, 2, 3, 4, 5]}
          value={item.drawerCount}
          onChange={(n) => onChange({ drawerCount: n, drawerSplitPcts: equalSplit(n) })}
        />
      </Field>
      <Field label="Height distribution">
        <div className="flex flex-col gap-1">
          {DRAWER_PRESETS.map((p) => (
            <button
              key={p.label}
              className="chip text-left"
              onClick={() => {
                const n = p.count ?? item.drawerCount;
                onChange({ drawerCount: n, drawerSplitPcts: p.pcts(n) });
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label={`Drawer faces, top → bottom (box ${fmt(usable)} cm)`}>
        <div className="space-y-1">
          {pcts.map((p, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-5 font-mono text-xs text-slate-400">#{i + 1}</span>
              <NumField
                className="flex-1"
                value={p}
                suffix="%"
                min={1}
                max={100}
                step={0.5}
                onChange={(v) => setPct(i, v)}
              />
              <NumField
                className="flex-1"
                value={(p / 100) * usable}
                min={1}
                max={usable}
                step={0.5}
                onChange={(v) => setPct(i, round1((v / usable) * 100))}
              />
            </div>
          ))}
          <SumBadge total={sum(pcts)} onNormalize={() => onChange({ drawerSplitPcts: normalizePcts(pcts) })} />
        </div>
      </Field>
    </>
  );
}

function TallZones({ item, onChange }: { item: KitchenItem; onChange: (p: Partial<KitchenItem>) => void }) {
  const zones = item.tallZones ?? [];
  const usable = boxHeight(item);
  const set = (next: TallZoneConfig[]) => onChange({ tallZones: next });
  const patch = (id: string, p: Partial<TallZoneConfig>) => set(zones.map((z) => (z.id === id ? { ...z, ...p } : z)));
  const move = (idx: number, dir: 1 | -1) => {
    const next = [...zones];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    set(next);
  };
  const zoneName = (idx: number) =>
    idx === 0 ? 'Bottom' : idx === zones.length - 1 ? 'Top' : zones.length === 3 ? 'Middle' : `Zone ${idx + 1}`;

  // Listed top to bottom to match the drawing; the array is stored bottom to top.
  const ordered = zones.map((z, idx) => ({ z, idx })).reverse();
  return (
    <>
      {ordered.map(({ z, idx }) => (
        <div key={z.id} className="space-y-1.5 rounded border border-slate-200 bg-slate-50 p-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">{zoneName(idx)} zone</span>
            <div className="flex gap-0.5 text-slate-500">
              <button title="Move up" className="rounded p-0.5 hover:bg-slate-200" onClick={() => move(idx, 1)}>
                <ArrowUp size={13} />
              </button>
              <button title="Move down" className="rounded p-0.5 hover:bg-slate-200" onClick={() => move(idx, -1)}>
                <ArrowDown size={13} />
              </button>
              <button
                title="Remove zone"
                className="rounded p-0.5 hover:bg-red-100 hover:text-red-600 disabled:opacity-30"
                disabled={zones.length <= 1}
                onClick={() => set(zones.filter((x) => x.id !== z.id))}
              >
                <X size={13} />
              </button>
            </div>
          </div>
          <select
            className="field"
            value={z.type}
            onChange={(e) => {
              const type = e.target.value as TallZoneType;
              patch(z.id, { type, drawerCount: type === 'drawers' ? (z.drawerCount ?? 3) : undefined });
            }}
          >
            {(Object.keys(TALL_ZONE_LABELS) as TallZoneType[]).map((t) => (
              <option key={t} value={t}>
                {TALL_ZONE_LABELS[t]}
              </option>
            ))}
          </select>
          <div className="flex gap-1.5">
            <NumField
              className="flex-1"
              value={z.heightPct}
              suffix="%"
              min={1}
              max={100}
              step={0.5}
              onChange={(v) => patch(z.id, { heightPct: v })}
            />
            <NumField
              className="flex-1"
              value={(z.heightPct / 100) * usable}
              min={1}
              max={usable}
              step={0.5}
              onChange={(v) => patch(z.id, { heightPct: round1((v / usable) * 100) })}
            />
          </div>
          {z.type === 'drawers' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Drawers</span>
              <Chips
                options={[1, 2, 3, 4, 5]}
                value={z.drawerCount ?? 3}
                onChange={(n) => patch(z.id, { drawerCount: n })}
              />
            </div>
          )}
        </div>
      ))}
      <button className="btn w-full justify-center" onClick={() => set([...zones, makeZone('door', 20)])}>
        <Plus size={14} /> Add zone on top
      </button>
      <SumBadge
        total={sum(zones.map((z) => z.heightPct))}
        onNormalize={() => {
          const n = normalizePcts(zones.map((z) => z.heightPct));
          set(zones.map((z, i) => ({ ...z, heightPct: n[i] })));
        }}
      />
    </>
  );
}

interface Props {
  wall: WallRun;
  walls: WallRun[];
  item: KitchenItem;
  onChange: (patch: Partial<KitchenItem>) => void;
  onMoveToWall: (wallId: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function Inspector({ wall, walls, item, onChange, onMoveToWall, onDuplicate, onDelete }: Props) {
  const [yUnlocked, setYUnlocked] = useState(false);
  useEffect(() => setYUnlocked(false), [item.id]);
  const layer = layerOf(item.category);
  const fromRight = round1(wall.widthCm - item.x - item.width);
  const maxX = Math.max(0, wall.widthCm - item.width);

  return (
    <div>
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
          {CATEGORY_LABELS[item.category]}
        </div>
        <input
          className="field mt-1.5"
          placeholder="Label (optional, e.g. B1)"
          value={item.label ?? ''}
          onChange={(e) => onChange({ label: e.target.value || undefined })}
        />
      </div>

      <Section title="Position & Size">
        <Field label="Wall / run">
          <select className="field" value={wall.id} onChange={(e) => onMoveToWall(e.target.value)}>
            {walls
              .filter((w) => !w.removed && (!isWallMounted(item.category) || w.kind === 'wall'))
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {w.kind === 'wall' ? SIDE_LABELS[w.side ?? 'north'] : 'Island'}
                </option>
              ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="X from left">
            <NumField value={item.x} min={0} max={maxX} onChange={(x) => onChange({ x })} />
          </Field>
          <Field label="From right wall">
            <NumField
              value={fromRight}
              min={0}
              max={maxX}
              onChange={(v) => onChange({ x: round1(wall.widthCm - item.width - v) })}
            />
          </Field>
        </div>
        {!isElectrical(item.category) && (
          <Field label="Y elevation (from floor)">
            {item.category === 'door' ? (
              <div className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-500">
                0 cm · doors stand on the floor
              </div>
            ) : layer === 'upper' ? (
              <NumField
                value={item.y}
                min={0}
                max={Math.max(0, wall.heightCm - item.height)}
                onChange={(y) => onChange({ y })}
              />
            ) : layer === 'counter' ? (
              <div className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-500">
                {fmt(item.y)} cm · auto-snapped to countertop
              </div>
            ) : (
              <div className="flex gap-1.5">
                <NumField
                  className="flex-1"
                  value={item.y}
                  min={0}
                  max={wall.heightCm - item.height}
                  disabled={!yUnlocked}
                  onChange={(y) => onChange({ y })}
                />
                <button
                  className="btn"
                  title={yUnlocked ? 'Lock to floor (Y = 0)' : 'Unlock elevation'}
                  onClick={() => {
                    if (yUnlocked) onChange({ y: 0 });
                    setYUnlocked(!yUnlocked);
                  }}
                >
                  {yUnlocked ? <Unlock size={14} /> : <Lock size={14} />}
                </button>
              </div>
            )}
          </Field>
        )}
        {!isElectrical(item.category) && (
          <>
            <Field label="Width">
              <Chips
                options={WIDTH_PRESETS}
                value={WIDTH_PRESETS.includes(item.width) ? item.width : null}
                onChange={(width) => onChange({ width })}
              />
              <NumField
                className="mt-1.5"
                value={item.width}
                min={5}
                max={wall.widthCm}
                onChange={(width) => onChange({ width })}
              />
            </Field>
            <Field label={item.category === 'sink' ? 'Basin depth (vertical)' : 'Height'}>
              <NumField value={item.height} min={1} max={wall.heightCm} onChange={(height) => onChange({ height })} />
            </Field>
          </>
        )}
        {!isWallMounted(item.category) && (
          <Field label="Depth from wall (plan)">
            <Chips
              options={DEPTH_PRESETS}
              value={DEPTH_PRESETS.includes(item.depth) ? item.depth : null}
              onChange={(depth) => onChange({ depth })}
            />
            <NumField
              className="mt-1.5"
              value={item.depth}
              min={5}
              max={150}
              onChange={(depth) => onChange({ depth })}
            />
          </Field>
        )}
        {hasToeKickOption(item.category) && (
          <Field label="Toe-kick (plinth)">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={item.hasToeKick}
                  onChange={(e) => onChange({ hasToeKick: e.target.checked })}
                />
                Enabled
              </label>
              <NumField
                className="flex-1"
                value={item.toeKickHeight}
                min={1}
                max={item.height - 5}
                disabled={!item.hasToeKick}
                onChange={(toeKickHeight) => onChange({ toeKickHeight })}
              />
            </div>
          </Field>
        )}
        {isCounterBearing(item.category) && (
          <Field label="Countertop">
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={!item.noCountertop}
                onChange={(e) => onChange({ noCountertop: e.target.checked ? undefined : true })}
              />
              Has countertop
            </label>
          </Field>
        )}
      </Section>

      {hasCabinetFronts(item.category) && (
        <Section title="Cabinet Fronts">
          <Chips
            options={['doors', 'drawers'] as ('doors' | 'drawers')[]}
            value={item.frontType}
            onChange={(frontType) => onChange({ frontType })}
            render={(v) => (v === 'doors' ? 'Doors' : 'Drawers')}
          />
          {item.frontType === 'doors' ? (
            <Field label="Doors">
              <Chips
                options={[1, 2] as (1 | 2)[]}
                value={item.doorCount}
                onChange={(doorCount) => onChange({ doorCount })}
                render={(n) => `${n} Door${n > 1 ? 's' : ''}`}
              />
            </Field>
          ) : (
            <DrawerConfig item={item} onChange={onChange} />
          )}
        </Section>
      )}

      {item.category === 'tall_cabinet' && (
        <Section title={`Tower Zones (box ${fmt(boxHeight(item))} cm)`}>
          <TallZones item={item} onChange={onChange} />
        </Section>
      )}

      {item.category === 'sink' && (
        <Section title="Sink">
          <Field label="Bowls">
            <Chips
              options={[1, 2] as (1 | 2)[]}
              value={item.sinkBowls ?? 1}
              onChange={(sinkBowls) => onChange({ sinkBowls })}
              render={(n) => `${n} Bowl${n > 1 ? 's' : ''}`}
            />
          </Field>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={item.hasFaucet ?? true}
              onChange={(e) => onChange({ hasFaucet: e.target.checked })}
            />
            Show faucet
          </label>
        </Section>
      )}

      {isElectrical(item.category) && (
        <Section title="Electrical">
          {item.category === 'socket' && (
            <Field label="Outlets on the plate">
              <Chips
                options={[1, 2, 3, 4] as (1 | 2 | 3 | 4)[]}
                value={item.socketCount ?? 1}
                onChange={(n) => onChange({ socketCount: n, width: socketWidth(n) })}
                render={(n) => socketName({ category: 'socket', socketCount: n }).replace(' socket', '')}
              />
            </Field>
          )}
          <Field label="Centre height (from floor)">
            <Chips
              options={SOCKET_HEIGHT_PRESETS}
              value={SOCKET_HEIGHT_PRESETS.find((h) => Math.abs(h - (item.y + item.height / 2)) < 0.05) ?? null}
              onChange={(c) => onChange({ y: round1(c - item.height / 2) })}
            />
            <NumField
              className="mt-1.5"
              value={item.y + item.height / 2}
              min={item.height / 2}
              max={wall.heightCm - item.height / 2}
              onChange={(c) => onChange({ y: round1(c - item.height / 2) })}
            />
          </Field>
          <p className="font-mono text-[11px] text-slate-400">
            {socketName(item)} · plate {fmt(item.width)} × {fmt(item.height)} cm
          </p>
        </Section>
      )}

      {item.category === 'door' && (
        <Section title="Door">
          <Field label="Hinge side (seen from inside the room)">
            <Chips
              options={['left', 'right'] as ('left' | 'right')[]}
              value={item.doorHinge ?? 'left'}
              onChange={(doorHinge) => onChange({ doorHinge })}
              render={(v) => (v === 'left' ? 'Left' : 'Right')}
            />
          </Field>
          <Field label="Opens">
            <Chips
              options={['in', 'out'] as ('in' | 'out')[]}
              value={item.doorSwing ?? 'in'}
              onChange={(doorSwing) => onChange({ doorSwing })}
              render={(v) => (v === 'in' ? 'Into the room' : 'Out of the room')}
            />
          </Field>
        </Section>
      )}

      {item.category === 'stove' && (
        <Section title="Cooktop">
          <Field label="Burners">
            <Chips
              options={[4, 5] as (4 | 5)[]}
              value={item.burnerCount ?? 4}
              onChange={(burnerCount) => onChange({ burnerCount })}
            />
          </Field>
        </Section>
      )}

      <Section title="Actions">
        <div className="flex gap-2">
          <button className="btn flex-1 justify-center" onClick={onDuplicate}>
            <Copy size={14} /> Duplicate
          </button>
          <button className="btn flex-1 justify-center border-red-300 text-red-600 hover:bg-red-50" onClick={onDelete}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
        <p className="text-[11px] text-slate-400">Del / Backspace deletes · Arrow keys nudge 1 cm (Shift = 10 cm)</p>
      </Section>
    </div>
  );
}
