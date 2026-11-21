import { renderToStaticMarkup } from 'react-dom/server';
import type { KitchenItem, ProjectData, WallRun } from '../types';
import { CATEGORY_LABELS, FRIDGE_TYPE_LABELS, socketName, TALL_ZONE_LABELS } from './defaults';
import { computeCountertops, computeSocketIssues, fmt, isElectrical, isJoint } from './geometry';
import { Drawing, drawingSize } from '../components/Drawing';
import { PlanDrawing, planSize } from '../components/PlanDrawing';
import { checkProject, runViolations, type Violation } from './rules';
import { wallDirection } from './outline';
import { directionName, getLang, runName, t } from './i18n';
import { SIDE_NAMES } from './island';
import { islandDrawing } from './plan';

const EXPORT_SCALE = 2;

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s: string) =>
  s
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'kitchen';

export function exportJson(name: string, data: ProjectData) {
  const blob = new Blob([JSON.stringify({ name, data }, null, 2)], { type: 'application/json' });
  download(blob, `${slug(name)}.json`);
}

/** Accepts either `{ name, data }` (our export format) or a bare ProjectData object. */
export async function importJson(file: File): Promise<{ name: string; data: ProjectData }> {
  const parsed = JSON.parse(await file.text());
  const data: ProjectData = parsed.data ?? parsed;
  if (!Array.isArray(data?.walls) || !data.walls.length || !data.walls.every((w) => Array.isArray(w.items))) {
    throw new Error(t('File does not contain a valid kitchen project (missing walls).'));
  }
  if (!data.walls.some((w) => w.id === data.activeWallId)) data.activeWallId = data.walls[0].id;
  return { name: parsed.name ?? file.name.replace(/\.json$/i, ''), data };
}

/** One-line configuration summary for the schedule table. */
export function describeItem(item: KitchenItem): string {
  const parts: string[] = [];
  if (item.category === 'base_cabinet' || item.category === 'upper_cabinet') {
    const shelves = item.shelfCount ? t(item.shelfCount > 1 ? '{n} shelves' : '1 shelf', { n: item.shelfCount }) : '';
    parts.push(
      item.frontType === 'drawers'
        ? t('{n} drawers ({split}%)', { n: item.drawerCount, split: item.drawerSplitPcts.map(fmt).join('/') })
        : item.frontType === 'open'
          ? [t('open'), shelves].filter(Boolean).join(', ')
          : [t(item.doorCount > 1 ? '{n} doors' : '1 door', { n: item.doorCount }), shelves].filter(Boolean).join(', '),
    );
  }
  if (item.category === 'tall_cabinet' && item.tallZones) {
    parts.push(
      [...item.tallZones]
        .reverse()
        .map(
          (z) =>
            `${t(TALL_ZONE_LABELS[z.type])}${z.type === 'drawers' ? ` ×${z.drawerCount ?? 3}` : ''} ${fmt(z.heightPct)}%`,
        )
        .join(' / '),
    );
  }
  if (item.category === 'sink')
    parts.push(
      t((item.sinkBowls ?? 1) > 1 ? '{n} bowls' : '1 bowl', { n: item.sinkBowls ?? 1 }) +
        (item.hasFaucet ? t(', faucet') : ''),
    );
  if (item.category === 'stove') parts.push(t('{n} burners', { n: item.burnerCount ?? 4 }));
  if (item.category === 'dishwasher')
    parts.push(t(item.dishwasherFront === 'visible' ? 'visible (stainless)' : 'integrated (cabinet front)'));
  if (item.category === 'fridge') parts.push(t(FRIDGE_TYPE_LABELS[item.fridgeType ?? 'side_by_side']));
  if (isElectrical(item.category))
    parts.push(t('{socket}, centre {cm} cm', { socket: t(socketName(item)), cm: fmt(item.y + item.height / 2) }));
  if (item.category === 'door')
    parts.push(
      t(item.doorSwing === 'out' ? 'hinge {side}, opens out' : 'hinge {side}, opens in', {
        side: t(item.doorHinge ?? 'left'),
      }),
    );
  if (item.hasToeKick) parts.push(t('plinth {cm}', { cm: fmt(item.toeKickHeight) }));
  if (item.noCountertop) parts.push(t('no countertop'));
  return parts.join(' · ');
}

export interface ScheduleRow {
  no: string;
  label: string;
  type: string;
  x: string;
  y: string;
  size: string;
  config: string;
}

export function scheduleRows(wall: WallRun): ScheduleRow[] {
  return wall.items
    .filter((i) => !isJoint(i))
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((i, idx) => ({
      no: String(idx + 1),
      label: i.label ? t(i.label) : '',
      type: t(isElectrical(i.category) ? socketName(i) : CATEGORY_LABELS[i.category]),
      x: fmt(i.x),
      y: fmt(i.y),
      size: `${fmt(i.width)} × ${fmt(i.height)}`,
      config: describeItem(i),
    }));
}

function wallSvg(
  wall: WallRun,
  violations: Violation[],
  data: ProjectData,
): { markup: string; width: number; height: number } {
  const { width, height } = drawingSize(wall, EXPORT_SCALE);
  const markup = renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <rect width={width} height={height} fill="#ffffff" />
      <Drawing wall={wall} scale={EXPORT_SCALE} violations={violations} {...islandDrawing(data, wall)} />
    </svg>,
  );
  return { markup, width, height };
}

function planSvg(data: ProjectData, violations: Violation[]): { markup: string; width: number; height: number } {
  const { width, height } = planSize(data, EXPORT_SCALE);
  const markup = renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <rect width={width} height={height} fill="#ffffff" />
      <PlanDrawing data={data} scale={EXPORT_SCALE} violations={violations} />
    </svg>,
  );
  return { markup, width, height };
}

/** One row per run for the plan sheet's summary table. */
function runSummaryRows(data: ProjectData): ScheduleRow[] {
  return data.walls.map((w, i) => ({
    no: String(i + 1),
    label: runName(w.name),
    type:
      w.kind === 'wall'
        ? `${t('Wall')} · ${directionName(wallDirection(data.room, w))}${w.removed ? t(' (open side)') : ''}`
        : w.kind === 'partition'
          ? t('Partition on {wall} at {x}', {
              wall: runName(data.walls.find((h) => h.id === w.hostId)?.name ?? '?'),
              x: fmt(w.hostX ?? 0),
            })
          : w.face && w.face !== 'a'
            ? t('{side} of {island}', {
                side: t(SIDE_NAMES[w.face]),
                island: runName(data.walls.find((h) => h.id === w.hostId)?.name ?? '?'),
              })
            : `${t('Island')} · ${w.rotationDeg ?? 0}°`,
    x: w.kind === 'island' ? fmt(w.planX ?? 0) : '',
    y: w.kind === 'island' ? fmt(w.planY ?? 0) : '',
    size:
      w.kind === 'island'
        ? w.face && w.face !== 'a'
          ? fmt(w.widthCm) // an island side: its length along the countertop edge (review finding R23)
          : `${fmt(w.widthCm)} × ${fmt(w.depthCm ?? 90)}`
        : `${fmt(w.widthCm)} × ${fmt(w.heightCm)}`,
    config: `${t('{n} element(s)', { n: w.items.filter((i) => !isJoint(i)).length })}${
      computeCountertops(w).length
        ? ` · ${t('countertop {cm} cm', {
            cm: computeCountertops(w)
              .map((c) => fmt(c.width))
              .join(' + '),
          })}`
        : ''
    }`,
  }));
}

const COLS: { key: keyof ScheduleRow; title: string; w: number }[] = [
  { key: 'no', title: '#', w: 30 },
  { key: 'label', title: 'Label', w: 70 }, // titles are translated when drawn
  { key: 'type', title: 'Element', w: 150 },
  { key: 'x', title: 'X (cm)', w: 60 },
  { key: 'y', title: 'Y (cm)', w: 60 },
  { key: 'size', title: 'W × H (cm)', w: 100 },
  { key: 'config', title: 'Configuration', w: 0 },
];

/** Electrician's list: every socket with its wall, position and height, plus totals per type. */
function electricalSection(data: ProjectData): string {
  const rows = data.walls.flatMap((w) =>
    w.items
      .filter((i) => isElectrical(i.category))
      .sort((a, b) => a.x - b.x)
      .map((i) => {
        const issue = computeSocketIssues(w).find((s) => s.item.id === i.id);
        return {
          wall: runName(w.name),
          type: t(socketName(i)),
          outlets: i.category === 'power_socket' ? 1 : (i.socketCount ?? 1),
          x: i.x + i.width / 2,
          h: i.y + i.height / 2,
          label: i.label ? t(i.label) : '',
          issue,
        };
      }),
  );
  if (!rows.length) return '';
  const totals = new Map<string, number>();
  rows.forEach((r) => totals.set(r.type, (totals.get(r.type) ?? 0) + 1));
  const outlets = rows.filter((r) => r.type !== t('Power socket 16A')).reduce((s, r) => s + r.outlets, 0);
  return `<section>
    <h1>${t('Electrical Schedule')}</h1>
    <p class="meta">${t("Positions are to the centre of each plate: X from the wall's left end (seen from inside the room), height from the finished floor.")}</p>
    <table><thead><tr><th>#</th><th>${t('Wall')}</th><th>${t('Label')}</th><th>${t('Type')}</th><th>${t('X centre (cm)')}</th><th>${t('Height centre (cm)')}</th><th>${t('Note')}</th></tr></thead>
    <tbody>${rows
      .map(
        (r, i) =>
          `<tr><td>${i + 1}</td><td>${esc(r.wall)}</td><td>${esc(r.label)}</td><td>${r.type}</td><td>${fmt(r.x)}</td><td>${fmt(r.h)}</td><td>${r.issue ? (r.issue.reason === 'opening' ? t('⚠ in window/door') : t('⚠ hidden by cabinet')) : ''}</td></tr>`,
      )
      .join('')}</tbody></table>
    <p class="meta" style="margin-top:12px"><b>${t('Totals:')}</b> ${[...totals].map(([type, n]) => `${n} × ${type}`).join(' · ')} · ${t('{n} regular outlets', { n: outlets })}</p>
  </section>`;
}

/** PNG of the active elevation (with its schedule) or, when `wall` is null, of the floor plan. */
export async function exportPng(projectName: string, data: ProjectData, wall: WallRun | null) {
  const violations = checkProject(data);
  const { markup, width, height } = wall ? wallSvg(wall, violations, data) : planSvg(data, violations);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(t('Could not render the schematic')));
    img.src = url;
  });

  const rows = wall ? scheduleRows(wall) : runSummaryRows(data);
  const counters = wall ? computeCountertops(wall) : [];
  const sheetW = Math.max(width, 900);
  const rowH = 22;
  const headerH = 60;
  const tableH = (rows.length + 1) * rowH + (counters.length ? 28 : 0) + 40;
  const ratio = 2;
  const canvas = document.createElement('canvas');
  canvas.width = sheetW * ratio;
  canvas.height = (headerH + height + tableH) * ratio;
  const c = canvas.getContext('2d')!;
  c.scale(ratio, ratio);
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, sheetW, headerH + height + tableH);

  c.fillStyle = '#0f172a';
  c.font = 'bold 18px ui-monospace, Menlo, monospace';
  c.fillText(`${projectName} — ${wall ? wall.name : 'Floor Plan'}`, 24, 30);
  c.font = '12px ui-monospace, Menlo, monospace';
  c.fillStyle = '#475569';
  c.fillText(
    wall
      ? `Elevation · ${fmt(wall.widthCm)} × ${fmt(wall.heightCm)} cm · countertop ${fmt(wall.countertopThicknessCm)} cm · ${new Date().toLocaleDateString()}`
      : `Plan · room ${fmt(data.room.widthCm)} × ${fmt(data.room.depthCm)} cm · ceiling ${fmt(data.room.heightCm)} cm · ${new Date().toLocaleDateString()}`,
    24,
    48,
  );
  c.drawImage(img, (sheetW - width) / 2, headerH, width, height);
  URL.revokeObjectURL(url);

  let y = headerH + height + 10;
  const x0 = 24;
  const tableW = sheetW - 48;
  const colX: number[] = [];
  let cx = x0;
  for (const col of COLS) {
    colX.push(cx);
    cx += col.w;
  }
  c.fillStyle = '#f1f5f9';
  c.fillRect(x0, y, tableW, rowH);
  c.strokeStyle = '#94a3b8';
  c.lineWidth = 1;
  c.font = 'bold 11px ui-monospace, Menlo, monospace';
  c.fillStyle = '#0f172a';
  COLS.forEach((col, i) => c.fillText(t(col.title), colX[i] + 6, y + 15));
  c.strokeRect(x0, y, tableW, rowH);
  c.font = '11px ui-monospace, Menlo, monospace';
  for (const r of rows) {
    y += rowH;
    c.fillStyle = '#1e293b';
    COLS.forEach((col, i) => {
      const maxW = (col.w || x0 + tableW - colX[i]) - 10;
      let text = r[col.key];
      while (text && c.measureText(text).width > maxW) text = text.slice(0, -2) + '…';
      c.fillText(text, colX[i] + 6, y + 15);
    });
    c.strokeRect(x0, y, tableW, rowH);
  }
  if (counters.length) {
    y += rowH + 20;
    c.fillStyle = '#475569';
    c.fillText(
      `${t('Countertop runs:')} ${counters.map((ct) => `${fmt(ct.width)} ${t('cm')} @ X ${fmt(ct.x)}`).join(', ')}`,
      x0,
      y,
    );
  }

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (blob) download(blob, `${slug(projectName)}-${slug(wall ? wall.name : 'plan')}.png`);
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/** Opens a print-ready sheet (one page per wall) and triggers the browser's print / Save as PDF dialog. */
export function printPdf(projectName: string, data: ProjectData) {
  const win = window.open('', '_blank');
  if (!win) throw new Error(t('Pop-up blocked: allow pop-ups to print.'));
  const violations = checkProject(data);
  const plan = planSvg(data, violations);
  const planProblems = violations.filter((v) => v.planArea);
  const problemList = (vs: Violation[]) =>
    vs.length
      ? `<ul class="warn">${vs.map((v) => `<li>${v.severity === 'error' ? '⛔' : v.severity === 'warning' ? '⚠' : 'ℹ'} ${esc(v.message)}</li>`).join('')}</ul>`
      : '';
  const planSection = `<section>
      <h1>${esc(projectName)} — ${t('Floor Plan')}</h1>
      <p class="meta">${t('Room {w} × {d} cm · ceiling {h} cm', { w: fmt(data.room.widthCm), d: fmt(data.room.depthCm), h: fmt(data.room.heightCm) })}</p>
      <div class="drawing">${plan.markup}</div>
      <table><thead><tr>${COLS.map((c) => `<th>${t(c.title)}</th>`).join('')}</tr></thead>
      <tbody>${runSummaryRows(data)
        .map((r) => `<tr>${COLS.map((c) => `<td>${esc(r[c.key])}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>
      ${problemList(planProblems)}
    </section>`;
  const sections =
    planSection +
    electricalSection(data) +
    data.walls
      .filter((wall) => wall.items.some((i) => !isJoint(i)))
      .map((wall) => {
        const { markup } = wallSvg(wall, violations, data);
        const rows = scheduleRows(wall);
        const counters = computeCountertops(wall);
        return `<section>
        <h1>${esc(projectName)} — ${esc(runName(wall.name))}</h1>
        <p class="meta">${t('Elevation · {w} × {h} cm · countertop {ct} cm', { w: fmt(wall.widthCm), h: fmt(wall.heightCm), ct: fmt(wall.countertopThicknessCm) })}</p>
        <div class="drawing">${markup}</div>
        <table><thead><tr>${COLS.map((c) => `<th>${t(c.title)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${COLS.map((c) => `<td>${esc(r[c.key])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="7">${t('No elements')}</td></tr>`}</tbody></table>
        ${counters.length ? `<p class="meta">${t('Countertop runs:')} ${counters.map((ct) => `${fmt(ct.width)} ${t('cm')} @ X ${fmt(ct.x)}`).join(', ')}</p>` : ''}
        ${problemList(runViolations(violations, wall.id).filter((v) => !v.planArea))}
      </section>`;
      })
      .join('');
  win.document
    .write(`<!doctype html><html lang="${getLang()}" dir="${getLang() === 'he' ? 'rtl' : 'ltr'}"><head><title>${esc(projectName)}</title><style>
    body { font-family: ui-monospace, Menlo, monospace; color: #0f172a; margin: 24px; }
    section { page-break-after: always; }
    section:last-child { page-break-after: auto; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .meta { color: #475569; font-size: 12px; margin: 0 0 12px; }
    .drawing { direction: ltr; }
    .drawing svg { width: 100%; height: auto; max-height: 62vh; }
    table { border-collapse: collapse; width: 100%; font-size: 11px; margin-top: 12px; }
    th, td { border: 1px solid #94a3b8; padding: 4px 6px; text-align: left; }
    th { background: #f1f5f9; }
    .warn { color: #dc2626; font-size: 12px; }
    @page { size: A4 landscape; margin: 12mm; }
  </style></head><body>${sections}<script>window.onload = () => window.print();</script></body></html>`);
  win.document.close();
}
