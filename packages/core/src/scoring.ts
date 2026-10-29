import { z } from 'zod';
import { EvidenceKindSchema, IsoDateTimeSchema, UuidSchema } from './primitives.js';
import { SignedEventSchema } from './ledger.js';
import { VerificationLevelSchema, type VerificationLevel } from './levels.js';
import { SCORING_SIGNAL_IDS } from './rubric.js';

/**
 * One verified chain record as scoring input. Mirrors the harness
 * ChainRecord (event + kind + collectedAt) with strict validation.
 */
export const ScoredEventSchema = z.object({
  event: SignedEventSchema,
  kind: EvidenceKindSchema,
  collectedAt: IsoDateTimeSchema,
});
export type ScoredEvent = z.infer<typeof ScoredEventSchema>;

/** Session verification outcome, echoed into every report. */
export const VerificationInfoSchema = z.object({
  level: VerificationLevelSchema,
  reasons: z.array(z.string().min(1)),
});
export type VerificationInfo = z.infer<typeof VerificationInfoSchema>;

/**
 * Confidence caps by verification level (heuristic). Confidence in any
 * score is capped by the LOWEST level of the evidence used — a session
 * report carries one verdict, so the cap is the session level's cap.
 */
export const LEVEL_CONFIDENCE_CAP: Record<VerificationLevel, number> = {
  L0: 0,
  L1: 0.4,
  L2: 0.6,
  L3: 0.8,
  L4: 1,
};

/**
 * One deterministic signal measurement. `value` is the raw measured value
 * (units documented per signal in @vault-verify/scoring); `score` is the
 * 0..1 heuristic mapping, or null when the signal does not apply (e.g.
 * recovery-cost with no failing tests). Citations are `seq:<n>` session
 * event references.
 */
export const SignalScoreSchema = z.object({
  signal: z.enum(SCORING_SIGNAL_IDS),
  value: z.number().nullable(),
  score: z.number().min(0).max(1).nullable(),
  citedEventIds: z.array(z.string().min(1)),
  note: z.string().min(1).max(280).optional(),
});
export type SignalScore = z.infer<typeof SignalScoreSchema>;

/** Judgment aspects the optional LLM judge may assess. */
export const JUDGE_ASPECTS = ['instruction-quality', 'decomposition'] as const;
export const JudgeAspectSchema = z.enum(JUDGE_ASPECTS);
export type JudgeAspect = z.infer<typeof JudgeAspectSchema>;

/**
 * A single LLM judgment. Must cite >=1 derived event id; the scorer
 * discards verdicts with no citations or citations outside the scored
 * session. Judgments NEVER affect the verification level.
 */
export const JudgeVerdictSchema = z.object({
  criterionId: z.string().min(1).max(80),
  aspect: JudgeAspectSchema,
  score: z.number().min(0).max(1),
  citedEventIds: z.array(z.string().min(1)).min(1),
  rationale: z.string().min(1).max(500),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

/**
 * Redacted, derived event for the judge. Counts and timings only — no
 * diffs, transcripts, commands, output tails, or commit hashes.
 */
export const DerivedEventSchema = z.object({
  seq: z.number().int().min(0),
  kind: EvidenceKindSchema,
  at: IsoDateTimeSchema,
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
export type DerivedEvent = z.infer<typeof DerivedEventSchema>;

/** What the judge receives: criterion, aspect, derived events, signal context. */
export const JudgeRequestSchema = z.object({
  criterion: z.object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(80),
    description: z.string().min(1).max(2000),
  }),
  aspect: JudgeAspectSchema,
  events: z.array(DerivedEventSchema),
  signalContext: z.array(SignalScoreSchema),
});
export type JudgeRequest = z.infer<typeof JudgeRequestSchema>;

/** Per-criterion score. Null score = insufficient evidence (excluded from overall). */
export const CriterionScoreSchema = z.object({
  criterionId: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  weight: z.number().min(0).max(1),
  score: z.number().min(0).max(1).nullable(),
  confidence: z.number().min(0).max(1),
  citedEventIds: z.array(z.string().min(1)),
  signals: z.array(SignalScoreSchema),
  judgments: z.array(JudgeVerdictSchema),
  discardedJudgments: z.number().int().min(0),
});
export type CriterionScore = z.infer<typeof CriterionScoreSchema>;

/**
 * Session-level scored screening report. Written by the scorer from one
 * verified session; distinct from the grant-based claims ScreeningReport
 * (claims.js), which the deferred service-role report builder owns and
 * will attach these scores to. HEURISTIC, NOT VALIDATED.
 */
export const FluencyReportSchema = z.object({
  id: UuidSchema,
  candidateId: UuidSchema,
  sessionId: UuidSchema,
  roleId: z.string().min(1).max(80),
  rubricVersion: z.number().int().min(1),
  criteria: z.array(CriterionScoreSchema).min(1),
  overallScore: z.number().min(0).max(1).nullable(),
  verification: VerificationInfoSchema,
  heuristic: z.literal(true),
  generator: z.string().min(1).max(120),
  generatedAt: IsoDateTimeSchema,
});
export type FluencyReport = z.infer<typeof FluencyReportSchema>;

/** Scorer input: verified records + session verdict + optional hidden-test outcome. */
export const SessionScoresInputSchema = z.object({
  sessionId: UuidSchema,
  candidateId: UuidSchema,
  records: z.array(ScoredEventSchema).min(1),
  verification: VerificationInfoSchema,
  hiddenTestOutcome: z.object({ passed: z.boolean() }).optional(),
});
export type SessionScoresInput = z.infer<typeof SessionScoresInputSchema>;

/** Session timeline moment kinds for the report view. */
export const TIMELINE_KINDS = ['edit', 'test-pass', 'test-fail', 'recovery', 'final'] as const;
export const TimelineKindSchema = z.enum(TIMELINE_KINDS);
export type TimelineKind = z.infer<typeof TimelineKindSchema>;

export const TimelineMomentSchema = z.object({
  seq: z.number().int().min(0),
  at: IsoDateTimeSchema,
  kind: TimelineKindSchema,
  label: z.string().min(1).max(280),
});
export type TimelineMoment = z.infer<typeof TimelineMomentSchema>;
