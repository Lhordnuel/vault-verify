import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from './primitives.js';
import { VerificationLevelSchema } from './levels.js';
import { VerificationSummarySchema } from './claims.js';
import { SCORING_SIGNAL_IDS } from './rubric.js';

/**
 * One required skill in a role template. must/nice is a reporting label:
 * missing skills contribute zero uplift but never subtract (see
 * computeUplift in @vault-verify/scoring).
 */
export const SkillRequirementSchema = z.object({
  skill: z.string().min(1).max(80),
  weight: z.number().min(0).max(1),
  importance: z.enum(['must', 'nice']),
});
export type SkillRequirement = z.infer<typeof SkillRequirementSchema>;

/** Optional agent-fluency module: how a scored rubric feeds the template. */
export const AgentFluencyModuleSchema = z.object({
  rubricRoleId: z.string().min(1).max(80),
  rubricVersion: z.number().int().min(1),
  weight: z.number().min(0).max(1),
});
export type AgentFluencyModule = z.infer<typeof AgentFluencyModuleSchema>;

/**
 * Fixed role template (immutable once published; changes ship as a new
 * version). HEURISTIC, NOT VALIDATED — same status as the v1 rubric.
 */
export const RoleTemplateSchema = z.object({
  templateId: z.string().min(1).max(80),
  version: z.number().int().min(1),
  title: z.string().min(1).max(200),
  skills: z.array(SkillRequirementSchema).min(1),
  agentFluency: AgentFluencyModuleSchema.optional(),
  heuristic: z.literal(true),
  publishedAt: IsoDateTimeSchema,
});
export type RoleTemplate = z.infer<typeof RoleTemplateSchema>;

/**
 * Fixed template: software engineer working with AI agents (v1). Skill
 * weights sum to 1; the fluency module carries its own weight on top.
 * Skill slugs are ours until the Vaultio taxonomy is mapped (see DECISIONS).
 */
export const SOFTWARE_ENGINEER_TEMPLATE_V1: RoleTemplate = RoleTemplateSchema.parse({
  templateId: 'software-engineer-ai',
  version: 1,
  title: 'Software Engineer working with AI agents — heuristic draft',
  skills: [
    { skill: 'typescript-node', weight: 0.3, importance: 'must' },
    { skill: 'api-design', weight: 0.2, importance: 'must' },
    { skill: 'testing-debugging', weight: 0.2, importance: 'must' },
    { skill: 'data-modeling', weight: 0.15, importance: 'nice' },
    { skill: 'code-review', weight: 0.15, importance: 'nice' },
  ],
  agentFluency: { rubricRoleId: 'software-engineer-ai', rubricVersion: 1, weight: 0.2 },
  heuristic: true,
  publishedAt: '2026-10-29T00:00:00.000Z',
});

const TEMPLATE_REGISTRY = new Map<string, RoleTemplate>([
  ['software-engineer-ai@1', SOFTWARE_ENGINEER_TEMPLATE_V1],
]);

/** Load a fixed role template. Throws for unknown template/version. */
export function loadRoleTemplate(templateId: string, version: number = 1): RoleTemplate {
  const found = TEMPLATE_REGISTRY.get(`${templateId}@${version}`);
  if (!found) {
    throw new Error(`[vault-verify] unknown role template: ${templateId}@v${version}`);
  }
  return found;
}

/** Raw measured signal value — a fact, never a fit score. */
export const SignalValueSchema = z.object({
  signal: z.enum(SCORING_SIGNAL_IDS),
  value: z.number().nullable(),
});
export type SignalValue = z.infer<typeof SignalValueSchema>;

/**
 * Evidence for one skill: refs (`<sessionId>:seq:<n>`), the STRONGEST level
 * across them, raw signal values, and the single BEST item (argmax of
 * quality x level strength, picked by the profile builder). Carries NO fit
 * score — scoring reads claims but claims never pre-judge.
 */
export const SkillClaimSchema = z.object({
  skill: z.string().min(1).max(80),
  evidenceIds: z.array(z.string().min(1)).min(1),
  level: VerificationLevelSchema,
  signals: z.array(SignalValueSchema),
  best: z.object({
    evidenceId: z.string().min(1),
    level: VerificationLevelSchema,
    quality: z.number().min(0).max(1),
  }),
});
export type SkillClaim = z.infer<typeof SkillClaimSchema>;

/** Working-pattern counts aggregated over the profile's sessions. */
export const WorkingPatternSummarySchema = z.object({
  edits: z.number().int().min(0),
  testRuns: z.number().int().min(0),
  failures: z.number().int().min(0),
  recoveries: z.number().int().min(0),
  notes: z.number().int().min(0),
});
export type WorkingPatternSummary = z.infer<typeof WorkingPatternSummarySchema>;

/**
 * A flagged contradiction or risk. Flags are surfaced to readers and NEVER
 * subtract from uplift (invariant-tested).
 */
export const ContradictionFlagSchema = z.object({
  code: z.string().min(1).max(80),
  detail: z.string().min(1).max(500),
  evidenceIds: z.array(z.string().min(1)),
});
export type ContradictionFlag = z.infer<typeof ContradictionFlagSchema>;

/**
 * Candidate-owned evidence profile: skill claims, working patterns, level
 * depth, and flags. Built from verified sessions; uplift reads it.
 */
export const EvidenceProfileSchema = z.object({
  candidateId: UuidSchema,
  templateId: z.string().min(1).max(80),
  templateVersion: z.number().int().min(1),
  sessionIds: z.array(UuidSchema),
  claims: z.array(SkillClaimSchema),
  workingPatterns: WorkingPatternSummarySchema,
  depth: VerificationSummarySchema,
  flags: z.array(ContradictionFlagSchema),
  fluency: z
    .object({
      level: VerificationLevelSchema,
      citedCount: z.number().int().min(0),
      /** Heuristic score, recorded for transparency. Uplift ignores it. */
      score: z.number().min(0).max(1).nullable(),
    })
    .optional(),
});
export type EvidenceProfile = z.infer<typeof EvidenceProfileSchema>;
