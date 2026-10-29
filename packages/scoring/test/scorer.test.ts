import { describe, expect, it } from 'vitest';
import {
  SOFTWARE_ENGINEER_AI_RUBRIC_V1,
  type JudgeVerdict,
  type SessionScoresInput,
  type VerificationInfo,
} from '@vault-verify/core';
import { scoreSession, UnverifiableSessionError } from '../src/scorer.js';
import { MockJudge } from '../src/judge.js';
import { at, mintScoredRecords, snapshotPayload, testPayload } from './helpers.js';

const SESSION_ID = '44444444-4444-4444-4444-444444444444';
const CANDIDATE_ID = '55555555-5555-5555-5555-555555555555';

function sessionRecords() {
  return mintScoredRecords([
    {
      kind: 'repo_snapshot',
      payload: snapshotPayload({ filesChanged: 2, insertions: 10, deletions: 2 }),
      at: at(0),
    },
    { kind: 'test_run', payload: testPayload({ passed: 3, failed: 2, exitCode: 1 }), at: at(2) },
    {
      kind: 'repo_snapshot',
      payload: snapshotPayload({ filesChanged: 1, insertions: 5, deletions: 1 }),
      at: at(4),
    },
    { kind: 'test_run', payload: testPayload({ passed: 5, failed: 0, exitCode: 0 }), at: at(6) },
    {
      kind: 'repo_snapshot',
      payload: snapshotPayload({ filesChanged: 3, insertions: 15, deletions: 3, final: true }),
      at: at(8),
    },
  ]);
}

function inputFor(verification: VerificationInfo): SessionScoresInput {
  const { records } = sessionRecords();
  return {
    sessionId: SESSION_ID,
    candidateId: CANDIDATE_ID,
    records,
    verification,
    hiddenTestOutcome: { passed: true },
  };
}

const L4: VerificationInfo = { level: 'L4', reasons: ['chain_valid:5_events', 'anchors_match:1'] };

describe('scoreSession', () => {
  it('scores the worked example: 0.5/0.9667/1/0.9778/0.5 -> overall ~0.7883', () => {
    return scoreSession({
      input: inputFor(L4),
      rubric: SOFTWARE_ENGINEER_AI_RUBRIC_V1,
      generatedAt: '2026-10-29T00:00:00.000Z',
    }).then((report) => {
      expect(report.heuristic).toBe(true);
      expect(report.roleId).toBe('software-engineer-ai');
      expect(report.rubricVersion).toBe(1);
      const byId = new Map(report.criteria.map((c) => [c.criterionId, c]));
      // latency median 2min -> 1-2/30; share 1; recovery mean 1 -> 0.5; reverts null; hidden 1.
      expect(byId.get('task-decomposition')?.score).toBeCloseTo(0.5, 6);
      expect(byId.get('test-driven-iteration')?.score).toBeCloseTo((1 + (1 - 2 / 30)) / 2, 6);
      expect(byId.get('change-quality')?.score).toBe(1);
      expect(byId.get('verification-discipline')?.score).toBeCloseTo((1 + (1 - 2 / 30) + 1) / 3, 6);
      expect(byId.get('oversight-recovery')?.score).toBeCloseTo(0.5, 6);
      expect(report.overallScore).toBeCloseTo(0.7883, 3);
      for (const c of report.criteria) {
        expect(c.confidence).toBe(1);
      }
    });
  });

  it('refuses L0 input: signals are computed only from verified events', async () => {
    await expect(
      scoreSession({
        input: inputFor({ level: 'L0', reasons: ['chain_break:hash_mismatch@seq:2'] }),
        rubric: SOFTWARE_ENGINEER_AI_RUBRIC_V1,
      }),
    ).rejects.toBeInstanceOf(UnverifiableSessionError);
  });

  it('caps confidence by verification level (L2 -> 0.6, L3 -> 0.8)', async () => {
    const l2 = await scoreSession({
      input: inputFor({ level: 'L2', reasons: ['platform-observed'] }),
      rubric: SOFTWARE_ENGINEER_AI_RUBRIC_V1,
    });
    const l3 = await scoreSession({
      input: inputFor({ level: 'L3', reasons: ['chain_valid:5_events'] }),
      rubric: SOFTWARE_ENGINEER_AI_RUBRIC_V1,
    });
    for (const c of l2.criteria) {
      if (c.score !== null) expect(c.confidence).toBe(0.6);
    }
    for (const c of l3.criteria) {
      if (c.score !== null) expect(c.confidence).toBe(0.8);
    }
  });

  it('blends cited judge verdicts into task-decomposition only', async () => {
    const judge = new MockJudge((request) => ({
      criterionId: 'task-decomposition',
      aspect: request.aspect,
      score: request.aspect === 'decomposition' ? 0.8 : 0.6,
      citedEventIds: ['seq:0', 'seq:2'],
      rationale: 'stepwise edits with scoped changes',
    }));
    const report = await scoreSession({
      input: inputFor(L4),
      rubric: SOFTWARE_ENGINEER_AI_RUBRIC_V1,
      judge,
    });
    const decomp = report.criteria.find((c) => c.criterionId === 'task-decomposition');
    expect(decomp?.judgments).toHaveLength(2);
    expect(decomp?.discardedJudgments).toBe(0);
    expect(decomp?.score).toBeCloseTo((0.5 + 0.8 + 0.6) / 3, 6);
    for (const c of report.criteria) {
      if (c.criterionId !== 'task-decomposition') {
        expect(c.judgments).toEqual([]);
        expect(c.discardedJudgments).toBe(0);
      }
    }
  });

  it.each([
    ['empty citations', { citedEventIds: [], score: 0.9 }],
    ['unknown seq citation', { citedEventIds: ['seq:99'], score: 0.9 }],
    ['wrong criterion', { citedEventIds: ['seq:0'], score: 0.9, criterionId: 'change-quality' }],
    ['out-of-range score', { citedEventIds: ['seq:0'], score: 7 }],
  ])('discards a verdict with %s', async (_label, override) => {
    const judge = new MockJudge(
      () =>
        ({
          criterionId: 'task-decomposition',
          aspect: 'decomposition',
          score: 0.8,
          citedEventIds: ['seq:0'],
          rationale: 'ok',
          ...(override as Record<string, unknown>),
        }) as JudgeVerdict,
    );
    const report = await scoreSession({
      input: inputFor(L4),
      rubric: SOFTWARE_ENGINEER_AI_RUBRIC_V1,
      judge,
    });
    const decomp = report.criteria.find((c) => c.criterionId === 'task-decomposition');
    // Both aspects use the same bad responder, so both are discarded.
    expect(decomp?.judgments).toEqual([]);
    expect(decomp?.discardedJudgments).toBe(2);
    // Score falls back to deterministic signals only.
    expect(decomp?.score).toBeCloseTo(0.5, 6);
  });

  it('discards verdicts from a throwing judge instead of failing scoring', async () => {
    const judge = new MockJudge(() => {
      throw new Error('judge exploded');
    });
    const report = await scoreSession({
      input: inputFor(L4),
      rubric: SOFTWARE_ENGINEER_AI_RUBRIC_V1,
      judge,
    });
    const decomp = report.criteria.find((c) => c.criterionId === 'task-decomposition');
    expect(decomp?.discardedJudgments).toBe(2);
    expect(decomp?.score).toBeCloseTo(0.5, 6);
  });

  it('echoes the verification verdict untouched: the judge never affects the level', async () => {
    const judge = new MockJudge((request) => ({
      criterionId: 'task-decomposition',
      aspect: request.aspect,
      score: 1,
      citedEventIds: ['seq:0'],
      rationale: 'perfect, allegedly',
    }));
    const [withoutJudge, withJudge] = await Promise.all([
      scoreSession({ input: inputFor(L4), rubric: SOFTWARE_ENGINEER_AI_RUBRIC_V1 }),
      scoreSession({ input: inputFor(L4), rubric: SOFTWARE_ENGINEER_AI_RUBRIC_V1, judge }),
    ]);
    expect(withJudge.verification).toEqual(L4);
    expect(withoutJudge.verification).toEqual(L4);
  });

  it('marks criteria with no applicable signals unscored and excludes them from overall', async () => {
    // No snapshots: only recovery-cost applies (fail -> pass, zero edits).
    const { records } = mintScoredRecords([
      { kind: 'test_run', payload: testPayload({ passed: 3, failed: 1, exitCode: 1 }), at: at(0) },
      { kind: 'test_run', payload: testPayload({ passed: 4, failed: 0, exitCode: 0 }), at: at(2) },
    ]);
    const report = await scoreSession({
      input: {
        sessionId: SESSION_ID,
        candidateId: CANDIDATE_ID,
        records,
        verification: L4,
      },
      rubric: SOFTWARE_ENGINEER_AI_RUBRIC_V1,
    });
    const byId = new Map(report.criteria.map((c) => [c.criterionId, c]));
    expect(byId.get('task-decomposition')?.score).toBe(1);
    expect(byId.get('oversight-recovery')?.score).toBe(1);
    for (const id of ['test-driven-iteration', 'change-quality', 'verification-discipline']) {
      expect(byId.get(id)?.score).toBeNull();
      expect(byId.get(id)?.confidence).toBe(0);
    }
    // (0.25 * 1 + 0.15 * 1) / (0.25 + 0.15) = 1.
    expect(report.overallScore).toBe(1);
  });
});
