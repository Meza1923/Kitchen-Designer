import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { KitchenItem } from '../types';
import {
  AppWindow,
  ChevronRight,
  Coffee,
  DoorOpen,
  Droplets,
  Flame,
  GlassWater,
  GripVertical,
  Microwave,
  PanelTop,
  RectangleHorizontal,
  Plug,
  RectangleVertical,
  Refrigerator,
  Slash,
  Columns2,
  PanelLeft,
  Trash2,
  Utensils,
  Wind,
  Square,
  WashingMachine,
  Zap,
} from 'lucide-react';
import type { ElementCategory } from '../types';
import { CATEGORY_LABELS, socketWidth } from '../lib/defaults';
import { t } from '../lib/i18n';

export interface Entry {
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
  label: `${name} socket`, // translated when shown
  dims: `${socketWidth(i + 1)} × 8 · centre 110`,
  overrides: { socketCount: (i + 1) as 1 | 2 | 3 | 4, width: socketWidth(i + 1) },
}));

export interface Group {
  title: string;
  items: Entry[];
}

const GROUPS: Group[] = [
  {
    title: 'Cabinets',
    items: [
      { category: 'base_cabinet', icon: Square, dims: '60 × 87' },
      { category: 'upper_cabinet', icon: PanelTop, dims: '60 × 70 @ 145' },
      { category: 'shelf', icon: RectangleHorizontal, dims: '80 × 4 @ 150 · open' },
      { category: 'tall_cabinet', icon: RectangleVertical, dims: '60 × 215' },
      { category: 'corner_blocker', icon: Slash, dims: '65 × 87' },
      { category: 'filler', icon: GripVertical, dims: '5 × 87 · closes gaps' },
      { category: 'trash_cabinet', icon: Trash2, dims: '45 × 87 · pull-out' },
      { category: 'end_panel', icon: PanelLeft, dims: '2 × 87 · closes a run end' },
    ],
  },
  {
    title: 'Appliances',
    items: [
      { category: 'fridge', icon: Refrigerator, dims: '90 × 185' },
      { category: 'washing_machine', icon: WashingMachine, dims: '60 × 85' },
      { category: 'under_counter_oven', icon: Microwave, dims: '60 × 87' },
      { category: 'dishwasher', icon: Utensils, dims: '60 × 87' },
      { category: 'hood', icon: Wind, dims: '60 × 50 @ 155' },
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
    title: 'Room',
    items: [
      { category: 'column', icon: Columns2, dims: '30 × 30 · full height · walls only' },
      {
        category: 'column',
        icon: Columns2,
        label: 'Pipe box',
        dims: '20 × 20 · full height · walls only',
        overrides: { width: 20, depth: 20, label: 'Pipe box' },
      },
    ],
  },
  {
    title: 'Electrical',
    items: [...sockets, { category: 'power_socket', icon: Zap, dims: '9 × 9 · 16A dedicated' }],
  },
];

const OPEN_KEY = 'kitchen-designer:catalog-open';

function loadOpen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/**
 * The element catalog (#13): groups start closed and open on click; the open ones are remembered per browser.
 * `only` limits what is offered (the island designer leaves out wall-only elements) and `extra` adds groups.
 */
export function Palette({
  onAdd,
  only,
  extra = [],
  hint = 'Click to add to the active wall. New elements go into the first free slot on their layer.',
}: {
  onAdd: (c: ElementCategory, overrides?: Partial<KitchenItem>) => void;
  only?: (c: ElementCategory) => boolean;
  extra?: Group[];
  hint?: string;
}) {
  const [open, setOpen] = useState<string[]>(loadOpen);
  const toggle = (title: string) => {
    const next = open.includes(title) ? open.filter((o) => o !== title) : [...open, title];
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      // Not remembered when storage is blocked.
    }
  };
  // `only` limits the standard groups; extra groups are offered as given.
  const groups = [
    ...extra,
    ...GROUPS.map((g) => ({ ...g, items: only ? g.items.filter((i) => only(i.category)) : g.items })),
  ].filter((g) => g.items.length);
  return (
    <aside className="w-56 shrink-0 overflow-y-auto border-r border-slate-300 bg-white">
      {groups.map((g) => {
        const isOpen = open.includes(g.title);
        return (
          <div key={g.title} className="border-b border-slate-200">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => toggle(g.title)}
              className="flex w-full items-center gap-1.5 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:bg-slate-50"
            >
              <ChevronRight
                size={13}
                className={`shrink-0 transition-transform rtl:-scale-x-100 ${isOpen ? 'rotate-90 rtl:-rotate-90' : ''}`}
              />
              <span className="flex-1 text-start">{t(g.title)}</span>
              <span className="font-mono font-normal text-slate-400">{g.items.length}</span>
            </button>
            {isOpen && (
              <div className="space-y-1 px-3 pb-3">
                {g.items.map(({ category, icon: Icon, dims, label, overrides }) => (
                  <button
                    key={label ?? category}
                    onClick={() => onAdd(category, overrides)}
                    className="flex w-full items-center gap-2.5 rounded border border-transparent px-2 py-1.5 text-start hover:border-slate-300 hover:bg-slate-50"
                  >
                    <Icon size={16} className="shrink-0 text-slate-600" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{t(label ?? CATEGORY_LABELS[category])}</span>
                      <span className="block font-mono text-[10px] text-slate-400" dir="ltr">
                        {dims.replace(/ · ([a-z][^·]*)/g, (_, w: string) => ` · ${t(w.trim())}`)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <p className="px-3 py-3 text-[11px] leading-relaxed text-slate-400">{t(hint)}</p>
    </aside>
  );
}
