import { describe, expect, it } from 'vitest';
import {
  computeSignals,
  editTestLatency,
  hiddenTestOutcome,
  recoveryCost,
  revertCount,
  testFollowShare,
} from '../src/signals.js';
import { at, mintScoredRecords, snapshotPayload, testPayload } from './helpers.js';

describe('edit-test-latency', () => {
  it('takes the median edit-to-test minutes and maps <=0min->1, >=30min->0', () => {
    const { records } = mintScoredRecords([
      { kind: 'repo_snapshot', payload: snapshotPayload({ filesChanged: 1, insertions: 10, deletions: 2 }), at: at(0) },
      { kind: 'test_run', payload: testPayload({ passed: 5, failed: 0, exitCode: 0 }), at: at(5) },
      { kind: 'repo_snapshot', payload: snapshotPayload({ filesChanged: 1, insertions: 3, deletions: 1 }), at: at(10) },
      { kind: 'test_run', payload: testPayload({ passed: 5, failed: 0, exitCode: 0 }), at: at(12) },
    ]);
    const signal = editTestLatency(records);
    expect(signal.value).toBeCloseTo(3.5, 6); // median of 5 and 2
    expect(signal.score).toBeCloseTo(1 - 3.5 / 30, 6);
    expect(signal.citedEventIds).toEqual(['seq:0', 'seq:1', 'seq:2', 'seq:3']);
  });

  it('is null when no edit is followed by a test run', () => {
    const { records } = mintScoredRecords([
      { kind: 'test_run', payload: testPayload({ passed: 5, failed: 0, exitCode: 0 }), at: at(0) },
      { kind: 'repo_snapshot', payload: snapshotPayload({ filesChanged: 1, insertions: 1, deletions: 0 }), at: at(5) },
    ]);
    const signal = editTestLatency(records);
    expect(signal.value).toBeNull();
    expect(signal.score).toBeNull();
    expect(signal.citedEventIds).toEqual([]);
  });
});

describe('test-follow-share', () => {
  it('counts edits followed by a test before the next edit', () => {
    const { records } = mintScoredRecords([
      { kind: 'repo_snapshot', payload: snapshotPayload({ filesChanged: 1, insertions: 1, deletions: 0 }), at: at(0) },
      { kind: 'repo_snapshot', payload: snapshotPayload({ filesChanged: 1, insertions: 1, deletions: 0 }), at: at(1) },
      { kind: 'test_run', payload: testPayload({ passed: 1, failed: 0, exitCode: 0 }), at: at(2) },
    ]);
    const signal = testFollowShare(records);
    expect(signal.value).toBe(0.5);
    expect(signal.score).toBe(0.5);
  });

  it('does NOT count the final-diff checkpoint as a review', () => {
    const { records } = mintScoredRecords([
      { kind: 'repo_snapshot', payload: snapshotPayload({ filesChanged: 1, insertions: 1, deletions: 0 }), at: at(0) },
      {
        kind: 'repo_snapshot',
        payload: snapshotPayload({ filesChanged: 2, insertions: 9, deletions: 1, final: true }),
        at: at(1),
      },
    ]);
    const signal = testFollowShare(records);
    expect(signal.value).toBe(0);
    expect(signal.score).toBe(0);
  });

  it('is null with no edits', () => {
    const { records } = mintScoredRecords([
      { kind: 'test_run', payload: testPayload({ passed: 1, failed: 0, exitCode: 0 }), at: at(0) },
    ]);
    const signal = testFollowShare(records);
    expect(signal.score).toBeNull();
    expect(signal.value).toBeNull();
  });
});

describe('recovery-cost', () => {
  it('means edit batches between failure and next pass; score is 1/(1+mean)', () => {
    const { records } = mintScoredRecords([
      { kind: 'test_run', payload: testPayload({ passed: 3, failed: 2, exitCode: 1 }), at: at(0) },
      { kind: 'repo_snapshot', payload: snapshotPayload({ filesChanged: 1, insertions: 4, deletions: 1 }), at: at(1) },
      { kind: 'repo_snapshot', payload: snapshotPayload({ filesChanged: 1, insertions: 2, deletions: 0 }), at: at(2) },
      { kind: 'test_run', payload: testPayload({ passed: 5, failed: 0, exitCode: 0 }), at: at(3) },
    ]);
    const signal = recoveryCost(records);
    expect(signal.value).toBe(2);
    expect(signal.score).toBeCloseTo(1 / 3, 6);
    expect(signal.citedEventIds).toEqual(['seq:0', 'seq:1', 'seq:2', 'seq:3']);
  });

  it('scores 1 for an immediate pass with no edits between', () => {
    const { records } = mintScoredRecords([
      { kind: 'test_run', payload: testPayload({ passed: 3, failed: 1, exitCode: 1 }), at: at(0) },
      { kind: 'test_run', payload: testPayload({ passed: 4, failed: 0, exitCode: 0 }), at: at(1) },
    ]);
    const signal = recoveryCost(records);
    expect(signal.value).toBe(0);
    expect(signal.score).toBe(1);
  });

  it('excludes unresolved failures and notes them', () => {
    const { records } = mintScoredRecords([
      { kind: 'test_run', payload: testPayload({ passed: 3, failed: 1, exitCode: 1 }), at: at(0) },
      { kind: 'test_run', payload: testPayload({ passed: 2, failed: 2, exitCode: 1 }), at: at(1) },
      { kind: 'repo_snapshot', payload: snapshotPayload({ filesChanged: 1, insertions: 1, deletions: 0 }), at: at(2) },
      { kind: 'test_run', payload: testPayload({ passed: 4, failed: 0, exitCode: 0 }), at: at(3) },
    ]);
    // First failure resolves at seq1? No: seq1 also fails. Chain: seq0 fails,
    // next test (seq1) fails -> seq0 unresolved. seq1 fails, next test (seq3)
    // passes with 1 edit between -> cost 1.
    const signal = recoveryCost(records);
    expect(signal.value).toBe(1);
    expect(signal.score).toBe(0.5);
    expect(signal.note).toMatch(/1 failing run\(s\) never resolved/);
  });

  it('is null when nothing ever failed', () => {
    const { records } = mintScoredRecords([
      { kind: 'test_run', payload: testPayload({ passed: 4, failed: 0, exitCode: 0 }), at: at(0) },
    ]);
    const signal = recoveryCost(records);
    expect(signal.score).toBeNull();
    expect(signal.value).toBeNull();
  });
});

describe('revert-count', () => {
  it('is not measured (Tier 1 proxy retired)', () => {
    const { records } = mintScoredRecords([
      { kind: 'repo_snapshot', payload: snapshotPayload({ filesChanged: 1, insertions: 2, deletions: 9 }), at: at(0) },
      { kind: 'repo_snapshot', payload: snapshotPayload({ filesChanged: 1, insertions: 9, deletions: 2 }), at: at(1) },
    ]);
    const signal = revertCount(records);
    expect(signal.value).toBeNull();
    expect(signal.score).toBeNull();
    expect(signal.citedEventIds).toEqual([]);
    expect(signal.note).toMatch(/not Tier-1 measurable/);
  });
});

describe('hidden-test-outcome', () => {
  it('passes through pass/fail and cites nothing (external to the chain)', () => {
    expect(hiddenTestOutcome({ passed: true })).toMatchObject({ value: 1, score: 1, citedEventIds: [] });
    expect(hiddenTestOutcome({ passed: false })).toMatchObject({ value: 0, score: 0, citedEventIds: [] });
  });

  it('is null when not provided', () => {
    const signal = hiddenTestOutcome(undefined);
    expect(signal.value).toBeNull();
    expect(signal.score).toBeNull();
  });
});

describe('computeSignals', () => {
  it('returns all five signals in contract order', () => {
    const { records } = mintScoredRecords([
      { kind: 'test_run', payload: testPayload({ passed: 1, failed: 0, exitCode: 0 }), at: at(0) },
    ]);
    expect(computeSignals(records, { passed: true }).map((s) => s.signal)).toEqual([
      'edit-test-latency',
      'test-follow-share',
      'recovery-cost',
      'revert-count',
      'hidden-test-outcome',
    ]);
  });
});
