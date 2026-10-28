import { z } from 'zod';
import { EvidenceKindSchema, Hex64Schema, IsoDateTimeSchema, UuidSchema } from './primitives';
import { VerificationLevelSchema } from './levels';

export const RubricCriterionSchema = z.object({
  id: z.string().min(1).max(80),
  description: z.string().min(1).max(2000),
  /** Relative weight; normalized at scoring time (scoring deferred). */
  weight: z.number().min(0).max(1),
  /** Evidence kinds that may support this criterion. */
  evidenceKinds: z.array(EvidenceKindSchema).min(1),
  /** True while the criterion is an unvalidated draft heuristic (Q5). */
  heuristic: z.boolean().optional(),
});
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

/**
 * Fixed rubric template per role. Immutable once published:
 * (roleId, version) is the identity; changes ship as a new version.
 */
export const RoleRubricSchema = z.object({
  roleId: z.string().min(1).max(80),
  version: z.number().int().min(1),
  title: z.string().min(1).max(200),
  criteria: z.array(RubricCriterionSchema).min(1),
  publishedAt: IsoDateTimeSchema,
});
export type RoleRubric = z.infer<typeof RoleRubricSchema>;

/**
 * A claim binds one rubric criterion to >=1 evidence items plus a
 * human-readable assertion. Verification level is the weakest link:
 * min(level of cited items), computed at claim build time.
 */
export const ClaimSchema = z.object({
  id: UuidSchema,
  candidateId: UuidSchema,
  roleId: z.string().min(1).max(80),
  rubricVersion: z.number().int().min(1),
  criterionId: z.string().min(1).max(80),
  /** Human-readable assertion, e.g. 'Debugged failing suite using targeted test runs'. */
  statement: z.string().min(1).max(2000),
  evidenceItemIds: z.array(UuidSchema).min(1),
  verificationLevel: VerificationLevelSchema,
  createdAt: IsoDateTimeSchema,
  tombstonedAt: IsoDateTimeSchema.optional(),
});
export type Claim = z.infer<typeof ClaimSchema>;

/** Per-level item counts cited by a report. */
export const VerificationSummarySchema = z.object({
  L0: z.number().int().min(0),
  L1: z.number().int().min(0),
  L2: z.number().int().min(0),
  L3: z.number().int().min(0),
  L4: z.number().int().min(0),
});
export type VerificationSummary = z.infer<typeof VerificationSummarySchema>;

/**
 * Point-in-time screening report. Carries claims + granted evidence refs
 * only — no scores (scoring deferred). Written by the service-role
 * report builder, never directly by candidates or orgs.
 */
export const ScreeningReportSchema = z.object({
  id: UuidSchema,
  candidateId: UuidSchema,
  orgId: UuidSchema,
  roleId: z.string().min(1).max(80),
  rubricVersion: z.number().int().min(1),
  claimIds: z.array(UuidSchema),
  /** Granted evidence items actually cited (subset of active grants). */
  evidenceItemIds: z.array(UuidSchema),
  verificationSummary: VerificationSummarySchema,
  /** Builder identity, e.g. 'report-builder@0.1'. */
  generator: z.string().min(1).max(120),
  /** sha256hex over the canonical report body (all fields except id/reportHash). */
  reportHash: Hex64Schema,
  generatedAt: IsoDateTimeSchema,
});
export type ScreeningReport = z.infer<typeof ScreeningReportSchema>;
