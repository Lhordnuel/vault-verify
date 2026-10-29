import { describe, expect, it } from 'vitest';
import {
  EvidenceProfileSchema,
  SOFTWARE_ENGINEER_TEMPLATE_V1,
  SkillClaimSchema,
  loadRoleTemplate,
} from '../src/evidence.js';

describe('loadRoleTemplate', () => {
  it('loads the fixed v1 template with weights summing to 1', () => {
    const template = loadRoleTemplate('software-engineer-ai', 1);
    expect(template).toBe(SOFTWARE_ENGINEER_TEMPLATE_V1);
    const sum = template.skills.reduce((a, s) => a + s.weight, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(template.agentFluency).toEqual({
      rubricRoleId: 'software-engineer-ai',
      rubricVersion: 1,
      weight: 0.2,
    });
  });

  it('throws for unknown templates', () => {
    expect(() => loadRoleTemplate('nope', 1)).toThrow(/unknown role template/);
    expect(() => loadRoleTemplate('software-engineer-ai', 99)).toThrow(/unknown role template/);
  });
});

describe('SkillClaim', () => {
  it('requires at least one evidence id and carries no score', () => {
    expect(() =>
      SkillClaimSchema.parse({ skill: 'testing-debugging', evidenceIds: [], level: 'L3', signals: [] }),
    ).toThrow();
    const claim = SkillClaimSchema.parse({
      skill: 'testing-debugging',
      evidenceIds: ['session:seq:1'],
      level: 'L3',
      signals: [{ signal: 'test-follow-share', value: 1 }],
      best: { evidenceId: 'session:seq:1', level: 'L3', quality: 0.5 },
    });
    expect('score' in claim).toBe(false);
    expect('fit' in claim).toBe(false);
  });
});

describe('EvidenceProfile', () => {
  it('parses a minimal profile with no claims', () => {
    const profile = EvidenceProfileSchema.parse({
      candidateId: '11111111-1111-1111-1111-111111111111',
      templateId: 'software-engineer-ai',
      templateVersion: 1,
      sessionIds: [],
      claims: [],
      workingPatterns: { edits: 0, testRuns: 0, failures: 0, recoveries: 0, notes: 0 },
      depth: { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 },
      flags: [],
    });
    expect(profile.claims).toEqual([]);
    expect(profile.fluency).toBeUndefined();
  });
});
