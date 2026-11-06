/**
 * Design rules: one list of violations for the whole project, drawn by the elevation, the plan, the problems list
 * and the export. Rule catalogue and severity decisions: FEATURES.md #5.
 */
import type { ProjectData } from '../../types';
import { BASE_RULES } from './base';
import type { Rule, RuleContext, Severity, Violation } from './core';
import { DESIGN_RULES } from './design';

export type { Fix, Rule, Severity, Violation } from './core';
export { itemName } from './core';

export const RULES: Rule[] = [...BASE_RULES, ...DESIGN_RULES];

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** All violations in the project, most severe first. */
export function checkProject(data: ProjectData): Violation[] {
  const ctx: RuleContext = { data };
  return RULES.flatMap((r) => r.check(ctx)).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

/** Violations that touch a run: one of its items, or an area in its elevation. */
export const runViolations = (violations: Violation[], runId: string) =>
  violations.filter((v) => v.wallArea?.runId === runId || v.items.some((i) => i.runId === runId));

/** Worst severity per item id, for framing. */
export function severityByItem(violations: Violation[]): Map<string, Severity> {
  const out = new Map<string, Severity>();
  for (const v of violations) {
    for (const { itemId } of v.items) {
      const cur = out.get(itemId);
      if (!cur || RANK[v.severity] < RANK[cur]) out.set(itemId, v.severity);
    }
  }
  return out;
}

/**
 * Apply every available fix, re-checking after each one (fixes shift units, so later problems may change or vanish).
 * Each problem is fixed at most once; `failed` explains the ones that couldn't be.
 */
export function applyAllFixes(data: ProjectData): { data: ProjectData; applied: number; failed: string[] } {
  const tried = new Set<string>();
  const failed: string[] = [];
  let applied = 0;
  for (let guard = 0; guard < 100; guard++) {
    const key = (v: Violation) => `${v.rule}:${v.items.map((i) => i.itemId).join(',')}`;
    const next = checkProject(data).find((v) => v.fix && !tried.has(key(v)));
    if (!next) break;
    tried.add(key(next));
    const result = next.fix!.apply(data);
    if (typeof result === 'string') failed.push(`${next.message} (${result})`);
    else {
      data = result;
      applied++;
    }
  }
  return { data, applied, failed };
}
