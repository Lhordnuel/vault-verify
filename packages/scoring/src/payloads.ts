import { parseDiffstatCounts as parseDiffstatCountsCore, type ScoredEvent } from '@vault-verify/core';

/** Re-exported canonical diffstat parser (see core agent-events). */
export const parseDiffstatCounts = parseDiffstatCountsCore;

/** Session-scoped citation reference for an event seq. */
export function eventRef(seq: number): string {
  return `seq:${seq}`;
}

/** All citable refs in a scored session (for judge-citation validation). */
export function knownRefs(records: ScoredEvent[]): Set<string> {
  return new Set(records.map((r) => eventRef(r.event.seq)));
}

export interface TestRunFacts {
  passed: number;
  failed: number;
  exitCode: number;
}

/** Parse a Tier 1 test_run payload; null when the shape is unusable. */
export function asTestRun(payload: unknown): TestRunFacts | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.passed !== 'number' || typeof p.failed !== 'number' || typeof p.exitCode !== 'number') {
    return null;
  }
  if (!Number.isFinite(p.passed) || !Number.isFinite(p.failed) || !Number.isFinite(p.exitCode)) {
    return null;
  }
  return { passed: p.passed, failed: p.failed, exitCode: p.exitCode };
}

export function isFailingTestRun(t: TestRunFacts): boolean {
  return t.failed > 0 || t.exitCode !== 0;
}

export interface SnapshotFacts {
  final: boolean;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

/** Parse a Tier 1 repo_snapshot payload; null when the shape is unusable. */
export function asSnapshot(payload: unknown): SnapshotFacts | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const diffstat = typeof p.diffstat === 'string' ? p.diffstat : '';
  return { final: p.final === true, ...parseDiffstatCounts(diffstat) };
}

/** collectedAt as epoch ms; null when unparseable (record is skipped by time signals). */
export function timeOf(record: ScoredEvent): number | null {
  const t = Date.parse(record.collectedAt);
  return Number.isFinite(t) ? t : null;
}
