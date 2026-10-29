import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../src/timeline.js';
import { at, mintScoredRecords, snapshotPayload, testPayload } from './helpers.js';

describe('buildTimeline', () => {
  it('emits edits, failures, recoveries, and the final diff in seq order', () => {
    const { records } = mintScoredRecords([
      {
        kind: 'repo_snapshot',
        payload: snapshotPayload({ filesChanged: 1, insertions: 8, deletions: 2 }),
        at: at(0),
      },
      { kind: 'test_run', payload: testPayload({ passed: 2, failed: 3, exitCode: 1 }), at: at(2) },
      {
        kind: 'repo_snapshot',
        payload: snapshotPayload({ filesChanged: 1, insertions: 4, deletions: 1 }),
        at: at(4),
      },
      { kind: 'test_run', payload: testPayload({ passed: 5, failed: 0, exitCode: 0 }), at: at(6) },
      {
        kind: 'repo_snapshot',
        payload: snapshotPayload({ filesChanged: 2, insertions: 12, deletions: 3, final: true }),
        at: at(8),
      },
    ]);
    const timeline = buildTimeline(records);
    expect(timeline.map((m) => m.kind)).toEqual(['edit', 'test-fail', 'edit', 'recovery', 'final']);
    expect(timeline.map((m) => m.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(timeline[3].label).toMatch(/Recovered/);
    expect(timeline[4].label).toMatch(/Final diff/);
  });

  it('labels a clean pass without a preceding failure as test-pass', () => {
    const { records } = mintScoredRecords([
      { kind: 'test_run', payload: testPayload({ passed: 5, failed: 0, exitCode: 0 }), at: at(0) },
    ]);
    expect(buildTimeline(records)).toHaveLength(1);
    expect(buildTimeline(records)[0].kind).toBe('test-pass');
  });
});
