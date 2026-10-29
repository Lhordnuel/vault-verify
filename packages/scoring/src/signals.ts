import { SignalScoreSchema, type ScoredEvent, type SignalScore } from '@vault-verify/core';
import {
  asSnapshot,
  asTestRun,
  eventRef,
  isFailingTestRun,
  timeOf,
} from './payloads.js';

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function bySeq(records: ScoredEvent[]): ScoredEvent[] {
  return [...records].sort((a, b) => a.event.seq - b.event.seq);
}

/**
 * edit-test-latency: median minutes from an agent edit (non-final snapshot)
 * to the next test run. Heuristic map: <=0 min -> 1, >=30 min -> 0, linear
 * between. Edits with no later test run (or skewed clocks) are skipped.
 */
export function editTestLatency(records: ScoredEvent[]): SignalScore {
  const ordered = bySeq(records);
  const latencies: number[] = [];
  const cited = new Set<string>();
  for (let i = 0; i < ordered.length; i += 1) {
    const edit = ordered[i];
    if (edit.kind !== 'repo_snapshot') continue;
    if (asSnapshot(edit.event.payload)?.final === true) continue;
    const editTime = timeOf(edit);
    if (editTime === null) continue;
    for (let j = i + 1; j < ordered.length; j += 1) {
      const candidate = ordered[j];
      if (candidate.kind !== 'test_run') continue;
      if (asTestRun(candidate.event.payload) === null) continue;
      const testTime = timeOf(candidate);
      if (testTime === null) continue;
      const minutes = (testTime - editTime) / 60000;
      if (minutes < 0) break; // clock skew: stop scanning for this edit
      latencies.push(minutes);
      cited.add(eventRef(edit.event.seq));
      cited.add(eventRef(candidate.event.seq));
      break;
    }
  }
  if (latencies.length === 0) {
    return SignalScoreSchema.parse({
      signal: 'edit-test-latency',
      value: null,
      score: null,
      citedEventIds: [],
      note: 'no edit followed by a test run',
    });
  }
  const med = median(latencies);
  return SignalScoreSchema.parse({
    signal: 'edit-test-latency',
    value: med,
    score: clamp01(1 - med / 30),
    citedEventIds: [...cited].sort(),
  });
}

/**
 * test-follow-share: share of edits (non-final snapshots) followed by a
 * test run before the next edit. Score = the share itself. The final-diff
 * checkpoint no longer counts as a review: diff review is not Tier-1
 * measurable.
 */
export function testFollowShare(records: ScoredEvent[]): SignalScore {
  const ordered = bySeq(records);
  let edits = 0;
  let followed = 0;
  const cited = new Set<string>();
  for (let i = 0; i < ordered.length; i += 1) {
    const edit = ordered[i];
    if (edit.kind !== 'repo_snapshot') continue;
    if (asSnapshot(edit.event.payload)?.final === true) continue;
    edits += 1;
    cited.add(eventRef(edit.event.seq));
    for (let j = i + 1; j < ordered.length; j += 1) {
      const next = ordered[j];
      if (next.kind === 'test_run' && asTestRun(next.event.payload) !== null) {
        followed += 1;
        cited.add(eventRef(next.event.seq));
        break;
      }
      if (next.kind === 'repo_snapshot') {
        break;
      }
    }
  }
  if (edits === 0) {
    return SignalScoreSchema.parse({
      signal: 'test-follow-share',
      value: null,
      score: null,
      citedEventIds: [],
      note: 'no edits in session',
    });
  }
  return SignalScoreSchema.parse({
    signal: 'test-follow-share',
    value: followed / edits,
    score: followed / edits,
    citedEventIds: [...cited].sort(),
  });
}

/**
 * recovery-cost: mean edit batches (snapshots) between a failing test run
 * and the next passing run. Tier 1 proxy for "prompts needed to recover":
 * prompt counts need Tier 2 adapters. Score = 1/(1+mean). Failures with no
 * later pass are unresolved and excluded (noted).
 */
export function recoveryCost(records: ScoredEvent[]): SignalScore {
  const ordered = bySeq(records);
  const costs: number[] = [];
  let unresolved = 0;
  let failures = 0;
  const cited = new Set<string>();
  for (let i = 0; i < ordered.length; i += 1) {
    const run = ordered[i];
    if (run.kind !== 'test_run') continue;
    const facts = asTestRun(run.event.payload);
    if (!facts || !isFailingTestRun(facts)) continue;
    failures += 1;
    let edits = 0;
    let resolved = false;
    const between: string[] = [];
    for (let j = i + 1; j < ordered.length; j += 1) {
      const next = ordered[j];
      if (next.kind === 'repo_snapshot' && asSnapshot(next.event.payload)?.final !== true) {
        edits += 1;
        between.push(eventRef(next.event.seq));
      } else if (next.kind === 'test_run') {
        const later = asTestRun(next.event.payload);
        if (later !== null) {
          if (!isFailingTestRun(later)) {
            resolved = true;
            costs.push(edits);
            cited.add(eventRef(run.event.seq));
            for (const ref of between) cited.add(ref);
            cited.add(eventRef(next.event.seq));
          }
          break;
        }
      }
    }
    if (!resolved) unresolved += 1;
  }
  if (failures === 0) {
    return SignalScoreSchema.parse({
      signal: 'recovery-cost',
      value: null,
      score: null,
      citedEventIds: [],
      note: 'no failing test runs',
    });
  }
  if (costs.length === 0) {
    return SignalScoreSchema.parse({
      signal: 'recovery-cost',
      value: null,
      score: null,
      citedEventIds: [],
      note: `${unresolved} failing run(s), none resolved by a later pass`,
    });
  }
  const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
  return SignalScoreSchema.parse({
    signal: 'recovery-cost',
    value: mean,
    score: 1 / (1 + mean),
    citedEventIds: [...cited].sort(),
    ...(unresolved > 0 ? { note: `${unresolved} failing run(s) never resolved` } : {}),
  });
}

/**
 * revert-count: NOT MEASURED. The old Tier 1 proxy (deletions >
 * insertions) is retired: explicit revert detection needs adapter
 * context. Always returns null.
 */
export function revertCount(_records: ScoredEvent[]): SignalScore {
  return SignalScoreSchema.parse({
    signal: 'revert-count',
    value: null,
    score: null,
    citedEventIds: [],
    note: 'not Tier-1 measurable (needs adapter context)',
  });
}

/**
 * hidden-test-outcome: final held-out test result, supplied by the report
 * caller (hidden tests run outside the session, so this is input, not a
 * chain derivation). Cites nothing: it is external to the chain.
 */
export function hiddenTestOutcome(outcome?: { passed: boolean }): SignalScore {
  if (!outcome) {
    return SignalScoreSchema.parse({
      signal: 'hidden-test-outcome',
      value: null,
      score: null,
      citedEventIds: [],
      note: 'hidden-test outcome not provided',
    });
  }
  return SignalScoreSchema.parse({
    signal: 'hidden-test-outcome',
    value: outcome.passed ? 1 : 0,
    score: outcome.passed ? 1 : 0,
    citedEventIds: [],
  });
}

/** Compute all five deterministic signals for a verified session. */
export function computeSignals(
  records: ScoredEvent[],
  hiddenOutcome?: { passed: boolean },
): SignalScore[] {
  return [
    editTestLatency(records),
    testFollowShare(records),
    recoveryCost(records),
    revertCount(records),
    hiddenTestOutcome(hiddenOutcome),
  ];
}
