import { describe, expect, it } from 'vitest';
import {
  SOFTWARE_ENGINEER_TEMPLATE_V1,
  type EvidenceProfile,
  type RoleTemplate,
} from '@vault-verify/core';
import {
  buildEvidenceProfile,
  computeUplift,
  scoreEvidenceQuality,
  scoreSessionTestQuality,
  summarizeSessionTests,
  type ProfileSession,
  type SkillEvidenceRef,
} from '../src/profile.js';
import { at, mintScoredRecords, snapshotPayload, testPayload, type RecordSpec } from './helpers.js';

const CANDIDATE_ID = '66666666-6666-6666-6666-666666666666';
const SESSION_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SESSION_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function sessionA(): ProfileSession {
  const { records } = mintScoredRecords([
    {
      kind: 'repo_snapshot',
      payload: snapshotPayload({ filesChanged: 1, insertions: 8, deletions: 2 }),
      at: at(0),
    },
    { kind: 'test_run', payload: testPayload({ passed: 5, failed: 0, exitCode: 0 }), at: at(3) },
  ]);
  return { sessionId: SESSION_A, records, level: 'L3' };
}

function sessionB(): ProfileSession {
  const { records } = mintScoredRecords([
    {
      kind: 'repo_snapshot',
      payload: snapshotPayload({ filesChanged: 2, insertions: 20, deletions: 1 }),
      at: at(60),
    },
    { kind: 'test_run', payload: testPayload({ passed: 2, failed: 3, exitCode: 1 }), at: at(63) },
    {
      kind: 'repo_snapshot',
      payload: snapshotPayload({ filesChanged: 1, insertions: 6, deletions: 0 }),
      at: at(66),
    },
    { kind: 'test_run', payload: testPayload({ passed: 5, failed: 0, exitCode: 0 }), at: at(69) },
  ]);
  return { sessionId: SESSION_B, records, level: 'L4' };
}

function singleSkillTemplate(): RoleTemplate {
  return {
    templateId: 'one-skill',
    version: 1,
    title: 'One skill (test)',
    skills: [{ skill: 'testing-debugging', weight: 1, importance: 'must' }],
    heuristic: true,
    publishedAt: '2026-10-29T00:00:00.000Z',
  };
}

describe('buildEvidenceProfile', () => {
  it('builds claims with refs, strongest level, and raw signal values', () => {
    const profile = buildEvidenceProfile({
      candidateId: CANDIDATE_ID,
      template: SOFTWARE_ENGINEER_TEMPLATE_V1,
      sessions: [sessionA(), sessionB()],
      skillMap: {
        'testing-debugging': [
          { sessionId: SESSION_A, seq: 1 },
          { sessionId: SESSION_B, seq: 3 },
        ],
      },
    });
    expect(profile.sessionIds).toEqual([SESSION_A, SESSION_B]);
    expect(profile.claims).toHaveLength(1);
    const [claim] = profile.claims;
    expect(claim.evidenceIds).toEqual([`${SESSION_A}:seq:1`, `${SESSION_B}:seq:3`]);
    expect(claim.level).toBe('L4'); // strongest of L3 + L4
    // Best = argmax quality x level strength: the L4 passing run wins.
    expect(claim.best).toEqual({ evidenceId: `${SESSION_B}:seq:3`, level: 'L4', quality: 1 });
    expect(claim.signals.map((s) => s.signal)).toEqual([
      'edit-test-latency',
      'test-follow-share',
      'recovery-cost',
      'revert-count',
      'hidden-test-outcome',
    ]);
    expect('score' in claim).toBe(false);
  });

  it('aggregates working patterns and level depth', () => {
    const profile = buildEvidenceProfile({
      candidateId: CANDIDATE_ID,
      template: SOFTWARE_ENGINEER_TEMPLATE_V1,
      sessions: [sessionA(), sessionB()],
      skillMap: {},
    });
    expect(profile.workingPatterns).toEqual({
      edits: 3,
      testRuns: 3,
      failures: 1,
      recoveries: 1,
      notes: 0,
    });
    expect(profile.depth).toEqual({ L0: 0, L1: 0, L2: 0, L3: 2, L4: 4 });
  });

  it('flags unresolved failures and hidden-test contradictions', () => {
    const { records } = mintScoredRecords([
      { kind: 'test_run', payload: testPayload({ passed: 1, failed: 4, exitCode: 1 }), at: at(0) },
    ]);
    const profile = buildEvidenceProfile({
      candidateId: CANDIDATE_ID,
      template: SOFTWARE_ENGINEER_TEMPLATE_V1,
      sessions: [{ sessionId: SESSION_A, records, level: 'L3' }],
      skillMap: {},
    });
    expect(profile.flags.map((f) => f.code)).toEqual(['unresolved-failure']);

    const { records: passing } = mintScoredRecords([
      { kind: 'test_run', payload: testPayload({ passed: 5, failed: 0, exitCode: 0 }), at: at(0) },
    ]);
    const conflicted = buildEvidenceProfile({
      candidateId: CANDIDATE_ID,
      template: SOFTWARE_ENGINEER_TEMPLATE_V1,
      sessions: [
        { sessionId: SESSION_A, records: passing, level: 'L3', hiddenTestOutcome: { passed: false } },
      ],
      skillMap: {},
    });
    expect(conflicted.flags.map((f) => f.code)).toEqual(['hidden-test-contradiction']);
  });

  it('keeps the strongest fluency across sessions and rejects bad refs', () => {
    const a = sessionA();
    a.fluency = { level: 'L3', citedCount: 2, score: 0.9 };
    const b = sessionB();
    b.fluency = { level: 'L4', citedCount: 1, score: 0.4 };
    const profile = buildEvidenceProfile({
      candidateId: CANDIDATE_ID,
      template: SOFTWARE_ENGINEER_TEMPLATE_V1,
      sessions: [a, b],
      skillMap: {},
    });
    expect(profile.fluency).toEqual({ level: 'L4', citedCount: 1, score: 0.4 });
    expect(() =>
      buildEvidenceProfile({
        candidateId: CANDIDATE_ID,
        template: SOFTWARE_ENGINEER_TEMPLATE_V1,
        sessions: [a],
        skillMap: { 'testing-debugging': [{ sessionId: SESSION_A, seq: 99 }] },
      }),
    ).toThrow(/unknown evidence/);
  });
});

describe('computeUplift invariants', () => {
  function profileWith(level: 'L0' | 'L4', refs: number, template?: RoleTemplate): EvidenceProfile {
    const session = sessionA();
    session.level = level;
    const skillMap: Record<string, SkillEvidenceRef[]> =
      refs === 0
        ? {}
        : {
            'testing-debugging': Array.from({ length: refs }, (_, i) => ({
              sessionId: SESSION_A,
              seq: i % session.records.length,
            })),
          };
    return buildEvidenceProfile({
      candidateId: CANDIDATE_ID,
      template: template ?? SOFTWARE_ENGINEER_TEMPLATE_V1,
      sessions: refs === 0 ? [] : [session],
      skillMap,
    });
  }

  it('is zero when there is no evidence', () => {
    expect(computeUplift(50, profileWith('L4', 0))).toBe(0);
  });

  it('never lowers when evidence is added', () => {
    const one = computeUplift(50, profileWith('L4', 1));
    const three = computeUplift(50, profileWith('L4', 3));
    expect(one).toBeGreaterThan(0);
    expect(three).toBeGreaterThanOrEqual(one);
    // More sessions can only add.
    const both = buildEvidenceProfile({
      candidateId: CANDIDATE_ID,
      template: SOFTWARE_ENGINEER_TEMPLATE_V1,
      sessions: [sessionA(), sessionB()],
      skillMap: {
        'testing-debugging': [
          { sessionId: SESSION_A, seq: 0 },
          { sessionId: SESSION_B, seq: 0 },
          { sessionId: SESSION_B, seq: 2 },
        ],
      },
    });
    const single = buildEvidenceProfile({
      candidateId: CANDIDATE_ID,
      template: SOFTWARE_ENGINEER_TEMPLATE_V1,
      sessions: [sessionA()],
      skillMap: { 'testing-debugging': [{ sessionId: SESSION_A, seq: 0 }] },
    });
    expect(computeUplift(50, both)).toBeGreaterThanOrEqual(computeUplift(50, single));
  });

  it('never subtracts for contradictions', () => {
    const clean = profileWith('L4', 2);
    const flagged: EvidenceProfile = {
      ...clean,
      flags: [
        ...clean.flags,
        { code: 'hidden-test-contradiction', detail: 'hidden fails', evidenceIds: [] },
      ],
    };
    expect(computeUplift(50, flagged)).toBe(computeUplift(50, clean));
  });

  it('holds the cap (default 15% of range, configurable)', () => {
    const template = singleSkillTemplate();
    const rich = profileWith('L4', 3, template);
    // best 0.8 (clean final pass) x L4 1.0, one source (1/3): default cap 15.
    expect(computeUplift(0, rich, { template })).toBe(15);
    expect(computeUplift(0, rich, { template, cap: 50 })).toBeCloseTo(80 / 3, 6);
    // Bare-number cap form + registry lookup on a registry-template profile.
    expect(computeUplift(0, profileWith('L4', 3), 5)).toBe(5);
    expect(computeUplift(0, profileWith('L4', 3))).toBeCloseTo(16 / 3, 6);
  });

  it('computes exact strength on a single-skill template', () => {
    const template = singleSkillTemplate();
    // Refs cycle [snapshot, passing test]: session quality is a clean final
    // pass (0.8), one source (1/3), uncapped.
    const partial = profileWith('L4', 2, template);
    expect(computeUplift(0, partial, { template, cap: 100 })).toBeCloseTo(80 / 3, 6);
  });

  it('gives different uplift for a bad and a good session at the same level', () => {
    const template = singleSkillTemplate();
    const badSession: ProfileSession = {
      sessionId: SESSION_A,
      records: mintScoredRecords([
        { kind: 'test_run', payload: testPayload({ passed: 1, failed: 4, exitCode: 1 }), at: at(0) },
      ]).records,
      level: 'L4',
    };
    const goodSession: ProfileSession = {
      sessionId: SESSION_A,
      records: mintScoredRecords([
        { kind: 'test_run', payload: testPayload({ passed: 5, failed: 0, exitCode: 0 }), at: at(0) },
      ]).records,
      level: 'L4',
    };
    const bad = buildEvidenceProfile({
      candidateId: CANDIDATE_ID,
      template,
      sessions: [badSession],
      skillMap: { 'testing-debugging': [{ sessionId: SESSION_A, seq: 0 }] },
    });
    const good = buildEvidenceProfile({
      candidateId: CANDIDATE_ID,
      template,
      sessions: [goodSession],
      skillMap: { 'testing-debugging': [{ sessionId: SESSION_A, seq: 0 }] },
    });
    // quality 0.2 (unrecovered fail) vs 0.8 (clean pass) at L4, one source.
    expect(computeUplift(0, bad, { template, cap: 100 })).toBeCloseTo(20 / 3, 6);
    expect(computeUplift(0, good, { template, cap: 100 })).toBeCloseTo(80 / 3, 6);
  });

  it('scores early failures followed by recovery at least as high as no tests', () => {
    const template = singleSkillTemplate();
    const recovered: ProfileSession = {
      sessionId: SESSION_A,
      records: mintScoredRecords([
        { kind: 'test_run', payload: testPayload({ passed: 1, failed: 4, exitCode: 1 }), at: at(0) },
        {
          kind: 'repo_snapshot',
          payload: snapshotPayload({ filesChanged: 1, insertions: 6, deletions: 1 }),
          at: at(2),
        },
        { kind: 'test_run', payload: testPayload({ passed: 5, failed: 0, exitCode: 0 }), at: at(4) },
      ]).records,
      level: 'L4',
    };
    const untested: ProfileSession = {
      sessionId: SESSION_B,
      records: mintScoredRecords([
        {
          kind: 'repo_snapshot',
          payload: snapshotPayload({ filesChanged: 1, insertions: 6, deletions: 1 }),
          at: at(0),
        },
      ]).records,
      level: 'L4',
    };
    const withRecovery = buildEvidenceProfile({
      candidateId: CANDIDATE_ID,
      template,
      sessions: [recovered],
      skillMap: { 'testing-debugging': [{ sessionId: SESSION_A, seq: 2 }] },
    });
    const withoutTests = buildEvidenceProfile({
      candidateId: CANDIDATE_ID,
      template,
      sessions: [untested],
      skillMap: { 'testing-debugging': [{ sessionId: SESSION_B, seq: 0 }] },
    });
    // Recovery: session quality 1.0 (final pass + recovery); no tests: 0.5 neutral.
    expect(computeUplift(0, withRecovery, { template, cap: 100 })).toBeCloseTo(100 / 3, 6);
    expect(computeUplift(0, withoutTests, { template, cap: 100 })).toBeCloseTo(50 / 3, 6);
    expect(computeUplift(0, withRecovery, { template, cap: 100 })).toBeGreaterThanOrEqual(
      computeUplift(0, withoutTests, { template, cap: 100 }),
    );
  });

  it('saturates on distinct sources, not item count', () => {
    const template = singleSkillTemplate();
    const pass = { kind: 'test_run' as const, payload: testPayload({ passed: 5, failed: 0, exitCode: 0 }), at: at(0) };
    const one: ProfileSession = {
      sessionId: SESSION_A,
      records: mintScoredRecords([pass, pass, pass]).records,
      level: 'L4',
    };
    const three: ProfileSession[] = [SESSION_A, SESSION_B, 'cccccccc-cccc-cccc-cccc-cccccccccccc'].map(
      (sessionId) => ({ sessionId, records: mintScoredRecords([pass]).records, level: 'L4' as const }),
    );
    const oneSource = buildEvidenceProfile({
      candidateId: CANDIDATE_ID,
      template,
      sessions: [one],
      skillMap: {
        'testing-debugging': [0, 1, 2].map((seq) => ({ sessionId: SESSION_A, seq })),
      },
    });
    const threeSources = buildEvidenceProfile({
      candidateId: CANDIDATE_ID,
      template,
      sessions: three,
      skillMap: {
        'testing-debugging': three.map((s) => ({ sessionId: s.sessionId, seq: 0 })),
      },
    });
    // Three items in one session: best 0.8 (clean pass), one source -> 80/3.
    expect(computeUplift(0, oneSource, { template, cap: 100 })).toBeCloseTo(80 / 3, 6);
    // One item in each of three sessions: best 0.8, three sources -> 80.
    expect(computeUplift(0, threeSources, { template, cap: 100 })).toBeCloseTo(80, 6);
  });

  it('respects scale headroom and validates inputs', () => {
    const template = singleSkillTemplate();
    const rich = profileWith('L4', 3, template);
    expect(computeUplift(95, rich, { template })).toBe(5);
    expect(computeUplift(100, rich, { template })).toBe(0);
    expect(() => computeUplift(Number.NaN, rich, { template })).toThrow(/baseline/);
    expect(() => computeUplift(0, rich, { template, range: 0 })).toThrow(/range/);
    expect(() => computeUplift(0, rich, -1)).toThrow(/cap/);
  });

  it('ignores non-template skills and L0 evidence', () => {
    const template = singleSkillTemplate();
    const session = sessionA();
    const offTemplate = buildEvidenceProfile({
      candidateId: CANDIDATE_ID,
      template,
      sessions: [session],
      skillMap: { 'unknown-skill': [{ sessionId: SESSION_A, seq: 0 }] },
    });
    expect(computeUplift(0, offTemplate, { template })).toBe(0);
    expect(computeUplift(0, profileWith('L0', 3, template), { template })).toBe(0);
  });

  it('adds fluency by level and cited count, ignoring the heuristic score', () => {
    const base = profileWith('L4', 3, SOFTWARE_ENGINEER_TEMPLATE_V1);
    const without = computeUplift(0, base, { cap: 100 });
    const low: EvidenceProfile = {
      ...base,
      fluency: { level: 'L4', citedCount: 3, score: 0.1 },
    };
    const high: EvidenceProfile = {
      ...base,
      fluency: { level: 'L4', citedCount: 3, score: 0.99 },
    };
    expect(computeUplift(0, low, { cap: 100 })).toBeGreaterThan(without);
    expect(computeUplift(0, high, { cap: 100 })).toBe(computeUplift(0, low, { cap: 100 }));
  });
});

describe('scoreSessionTestQuality', () => {
  function qualityOf(specs: RecordSpec[]): number {
    const { records } = mintScoredRecords(specs);
    return scoreSessionTestQuality(summarizeSessionTests(records));
  }

  it('maps final outcome plus recovery; neutral without runs', () => {
    const pass = { kind: 'test_run' as const, payload: testPayload({ passed: 5, failed: 0, exitCode: 0 }), at: at(0) };
    const fail = { kind: 'test_run' as const, payload: testPayload({ passed: 1, failed: 4, exitCode: 1 }), at: at(0) };
    const edit = {
      kind: 'repo_snapshot' as const,
      payload: snapshotPayload({ filesChanged: 1, insertions: 4, deletions: 1 }),
      at: at(0),
    };
    expect(qualityOf([pass])).toBe(0.8);
    expect(qualityOf([fail, pass])).toBe(1);
    expect(qualityOf([fail])).toBe(0.2);
    expect(qualityOf([fail, pass, fail])).toBe(0.4);
    expect(qualityOf([edit])).toBe(0.5);
    expect(qualityOf([])).toBe(0.5);
  });

  it('summarizes runs, final outcome, and recovery count', () => {
    const { records } = mintScoredRecords([
      { kind: 'test_run', payload: testPayload({ passed: 0, failed: 2, exitCode: 1 }), at: at(0) },
      { kind: 'test_run', payload: testPayload({ passed: 2, failed: 0, exitCode: 0 }), at: at(1) },
    ]);
    expect(summarizeSessionTests(records)).toEqual({ testRuns: 2, finalPassed: true, recoveries: 1 });
  });
});

describe('scoreEvidenceQuality', () => {
  it('shares session test quality across runs; neutral edits; weak notes', () => {
    const { records } = mintScoredRecords([
      { kind: 'test_run', payload: testPayload({ passed: 3, failed: 1, exitCode: 1 }), at: at(0) },
      {
        kind: 'repo_snapshot',
        payload: snapshotPayload({ filesChanged: 1, insertions: 4, deletions: 1 }),
        at: at(1),
      },
      { kind: 'self_report', payload: { text: 'I did work' }, at: at(2) },
    ]);
    expect(scoreEvidenceQuality(records[0], 0.8)).toBe(0.8);
    expect(scoreEvidenceQuality(records[0])).toBe(0.5);
    expect(scoreEvidenceQuality(records[1], 0.9)).toBe(0.5);
    expect(scoreEvidenceQuality(records[2], 0.9)).toBe(0.25);
  });
});
