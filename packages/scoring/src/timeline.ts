import { TimelineMomentSchema, type ScoredEvent, type TimelineMoment } from '@vault-verify/core';
import { asSnapshot, asTestRun, isFailingTestRun } from './payloads.js';

/**
 * Key session moments for the report timeline: edits, test runs, failures,
 * recoveries (first pass after a failure), and the final diff.
 */
export function buildTimeline(records: ScoredEvent[]): TimelineMoment[] {
  const ordered = [...records].sort((a, b) => a.event.seq - b.event.seq);
  const moments: TimelineMoment[] = [];
  let failing = false;
  for (const record of ordered) {
    if (record.kind === 'test_run') {
      const facts = asTestRun(record.event.payload);
      if (!facts) continue;
      if (isFailingTestRun(facts)) {
        failing = true;
        moments.push(
          TimelineMomentSchema.parse({
            seq: record.event.seq,
            at: record.collectedAt,
            kind: 'test-fail',
            label: `Tests failed (${facts.failed} failing, ${facts.passed} passing)`,
          }),
        );
      } else if (failing) {
        failing = false;
        moments.push(
          TimelineMomentSchema.parse({
            seq: record.event.seq,
            at: record.collectedAt,
            kind: 'recovery',
            label: `Recovered: tests pass (${facts.passed} passing)`,
          }),
        );
      } else {
        moments.push(
          TimelineMomentSchema.parse({
            seq: record.event.seq,
            at: record.collectedAt,
            kind: 'test-pass',
            label: `Tests pass (${facts.passed} passing)`,
          }),
        );
      }
    } else if (record.kind === 'repo_snapshot') {
      const snapshot = asSnapshot(record.event.payload);
      if (!snapshot) continue;
      if (snapshot.final) {
        moments.push(
          TimelineMomentSchema.parse({
            seq: record.event.seq,
            at: record.collectedAt,
            kind: 'final',
            label: `Final diff (${snapshot.insertions} additions, ${snapshot.deletions} deletions)`,
          }),
        );
      } else {
        moments.push(
          TimelineMomentSchema.parse({
            seq: record.event.seq,
            at: record.collectedAt,
            kind: 'edit',
            label: `Edit (+${snapshot.insertions}/-${snapshot.deletions})`,
          }),
        );
      }
    }
  }
  return moments;
}
