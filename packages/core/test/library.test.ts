import { describe, expect, it } from 'vitest';
import { EvidenceLibrary } from '../src/library.js';

const CANDIDATE_ID = '55555555-5555-5555-5555-555555555555';
const EVIDENCE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const EVIDENCE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ROLE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SCREENING_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const REPORT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const AT = '2026-10-29T00:00:00.000Z';

function seeded(): EvidenceLibrary {
  const library = new EvidenceLibrary();
  library.addEvidence({ id: EVIDENCE_A, candidateId: CANDIDATE_ID, kind: 'test_run', level: 'L3', addedAt: AT });
  library.addEvidence({ id: EVIDENCE_B, candidateId: CANDIDATE_ID, kind: 'repo_snapshot', level: 'L2', addedAt: AT });
  library.addRole({
    roleId: ROLE_ID,
    title: 'Backend engineer',
    templateId: 'software-engineer-ai',
    evidenceIds: [EVIDENCE_A, EVIDENCE_B],
  });
  library.addScreening({
    screeningId: SCREENING_ID,
    roleId: ROLE_ID,
    candidateId: CANDIDATE_ID,
    evidenceIds: [EVIDENCE_A],
  });
  library.addRoleReport({
    reportId: REPORT_ID,
    roleId: ROLE_ID,
    candidateId: CANDIDATE_ID,
    evidenceIds: [EVIDENCE_A, EVIDENCE_B],
    baseline: 62,
    uplift: 4,
    createdAt: AT,
  });
  return library;
}

describe('EvidenceLibrary no-cascade deletes', () => {
  it('deleting a role removes the role, its screenings and reports — evidence remains', () => {
    const library = seeded();
    const removed = library.deleteRole(ROLE_ID);
    expect(removed).toEqual({ removedScreenings: 1, removedReports: 1 });
    expect(library.getRole(ROLE_ID)).toBeUndefined();
    expect(library.getScreening(SCREENING_ID)).toBeUndefined();
    expect(library.getRoleReport(REPORT_ID)).toBeUndefined();
    expect(library.getEvidence(EVIDENCE_A)?.level).toBe('L3');
    expect(library.getEvidence(EVIDENCE_B)?.kind).toBe('repo_snapshot');
    expect(library.listCandidateEvidence(CANDIDATE_ID)).toHaveLength(2);
  });

  it('deleting a screening leaves evidence untouched', () => {
    const library = seeded();
    library.deleteScreening(SCREENING_ID);
    expect(library.getScreening(SCREENING_ID)).toBeUndefined();
    expect(library.listCandidateEvidence(CANDIDATE_ID)).toHaveLength(2);
  });

  it('throws for unknown roles and screenings', () => {
    const library = seeded();
    expect(() => library.deleteRole('ffffffff-ffff-ffff-ffff-ffffffffffff')).toThrow(/unknown role/);
    expect(() => library.deleteScreening('ffffffff-ffff-ffff-ffff-ffffffffffff')).toThrow(
      /unknown screening/,
    );
  });
});

describe('EvidenceLibrary attempts', () => {
  it('retains every attempt in order (append-only)', () => {
    const library = seeded();
    for (const attemptNumber of [1, 2]) {
      library.addAttempt({
        id: `00000000-0000-0000-0000-00000000000${attemptNumber}`,
        candidateId: CANDIDATE_ID,
        attempt: {
          testId: 'ts-debug-1',
          version: 1,
          seed: 'f'.repeat(64),
          attemptNumber,
          result: { passed: attemptNumber === 2 },
        },
        level: 'L2',
        addedAt: AT,
      });
    }
    const attempts = library.listAttempts(CANDIDATE_ID);
    expect(attempts.map((a) => a.attempt.attemptNumber)).toEqual([1, 2]);
    expect(attempts[0].attempt.result.passed).toBe(false);
    expect(attempts[1].attempt.result.passed).toBe(true);
  });
});
