import { describe, expect, it } from 'vitest';
import { redactForJudge } from '../src/redact.js';
import { at, mintScoredRecords, snapshotPayload, testPayload } from './helpers.js';

describe('redactForJudge', () => {
  it('keeps counts and timings, drops diffs/commands/output/commits', () => {
    const { records } = mintScoredRecords([
      {
        kind: 'repo_snapshot',
        payload: snapshotPayload({ filesChanged: 2, insertions: 10, deletions: 3 }),
        at: at(0),
      },
      { kind: 'test_run', payload: testPayload({ passed: 3, failed: 1, exitCode: 1 }), at: at(2) },
    ]);
    const derived = redactForJudge(records);
    expect(derived).toHaveLength(2);
    expect(derived[0]).toMatchObject({
      seq: 0,
      kind: 'repo_snapshot',
      facts: { final: false, filesChanged: 2, insertions: 10, deletions: 3 },
    });
    expect(derived[1]).toMatchObject({
      seq: 1,
      kind: 'test_run',
      facts: { passed: 3, failed: 1, exitCode: 1 },
    });
    const serialized = JSON.stringify(derived);
    expect(serialized).not.toContain('SECRET_DIFF_MARKER');
    expect(serialized).not.toContain('SECRET_COMMAND_MARKER');
    expect(serialized).not.toContain('SECRET_OUTPUT_MARKER');
    expect(serialized).not.toContain('f'.repeat(40));
  });

  it('marks unparseable payloads without leaking them', () => {
    const { records } = mintScoredRecords([
      { kind: 'test_run', payload: { totally: 'SECRET_SHAPE_MARKER', unexpected: 1 }, at: at(0) },
    ]);
    const derived = redactForJudge(records);
    expect(derived[0].facts).toEqual({ unparseable: true });
    expect(JSON.stringify(derived)).not.toContain('SECRET_SHAPE_MARKER');
  });
});
