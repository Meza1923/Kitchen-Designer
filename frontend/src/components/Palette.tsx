import type { LucideIcon } from 'lucide-react';
import type { KitchenItem } from '../types';
import {
  AppWindow,
  Coffee,
  DoorOpen,
  Droplets,
  Flame,
  GlassWater,
  Microwave,
  PanelTop,
  Plug,
  RectangleVertical,
  Refrigerator,
  Slash,
  Square,
  WashingMachine,
  Zap,
} from 'lucide-react';
import type { ElementCategory } from '../types';
import { CATEGORY_LABELS, socketWidth } from '../lib/defaults';

interface Entry {
  category: ElementCategory;
  icon: LucideIcon;
  dims: string;
  /** Catalog name when it differs from the category's (e.g. "Double socket"). */
  label?: string;
  overrides?: Partial<KitchenItem>;
}

const sockets: Entry[] = (['Single', 'Double', 'Triple', 'Quadruple'] as const).map((name, i) => ({
  category: 'socket',
  icon: Plug,
  label: `${name} socket`,
  dims: `${socketWidth(i + 1)} × 8 · centre 110`,
  overrides: { socketCount: (i + 1) as 1 | 2 | 3 | 4, width: socketWidth(i + 1) },
}));

const GROUPS: { title: string; items: Entry[] }[] = [
  {
    title: 'Cabinets',
    items: [
      { category: 'base_cabinet', icon: Square, dims: '60 × 87' },
      { category: 'upper_cabinet', icon: PanelTop, dims: '60 × 70 @ 145' },
      { category: 'tall_cabinet', icon: RectangleVertical, dims: '60 × 215' },
      { category: 'corner_blocker', icon: Slash, dims: '65 × 87' },
    ],
  },
  {
    title: 'Appliances',
    items: [
      { category: 'fridge', icon: Refrigerator, dims: '90 × 185' },
      { category: 'washing_machine', icon: WashingMachine, dims: '60 × 85' },
      { category: 'under_counter_oven', icon: Microwave, dims: '60 × 87' },
      { category: 'sink', icon: Droplets, dims: '60 · on counter' },
      { category: 'stove', icon: Flame, dims: '60 · on counter' },
      { category: 'water_bar', icon: GlassWater, dims: '30 × 45 · on counter' },
      { category: 'coffee_machine', icon: Coffee, dims: '35 × 40 · on counter' },
    ],
  },
  {
    title: 'Openings',
    items: [
      { category: 'window', icon: AppWindow, dims: '120 × 100 @ 105' },
      { category: 'door', icon: DoorOpen, dims: '90 × 210 · walls only' },
    ],
  },
  {
    title: 'Electrical',
    items: [...sockets, { category: 'power_socket', icon: Zap, dims: '9 × 9 · 16A dedicated' }],
  },
];

export function Palette({ onAdd }: { onAdd: (c: ElementCategory, overrides?: Partial<KitchenItem>) => void }) {
  return (
    <aside className="w-56 shrink-0 overflow-y-auto border-r border-slate-300 bg-white">
      {GROUPS.map((g) => (
        <div key={g.title} className="border-b border-slate-200 px-3 py-3">
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">{g.title}</h3>
          <div className="space-y-1">
            {g.items.map(({ category, icon: Icon, dims, label, overrides }) => (
              <button
                key={label ?? category}
                onClick={() => onAdd(category, overrides)}
                className="flex w-full items-center gap-2.5 rounded border border-transparent px-2 py-1.5 text-left hover:border-slate-300 hover:bg-slate-50"
              >
                <Icon size={16} className="shrink-0 text-slate-600" />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{label ?? CATEGORY_LABELS[category]}</span>
                  <span className="block font-mono text-[10px] text-slate-400">{dims}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="px-3 py-3 text-[11px] leading-relaxed text-slate-400">
        Click to add to the active wall. New elements go into the first free slot on their layer.
      </p>
    </aside>
  );
}
