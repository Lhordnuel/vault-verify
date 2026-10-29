import { z } from 'zod';
import { RoleRubricSchema, RubricCriterionSchema } from './claims.js';

/**
 * Deterministic signal ids the scorer computes from verified session events.
 * A criterion's `signals` list is the wiring between rubric and scorer.
 */
export const SCORING_SIGNAL_IDS = [
  'edit-test-latency',
  'test-follow-share',
  'recovery-cost',
  'revert-count',
  'hidden-test-outcome',
] as const;
export type ScoringSignalId = (typeof SCORING_SIGNAL_IDS)[number];

/**
 * A rubric criterion extended for scoring: a short label plus the signal
 * ids it reads. The base fields (description, weight, evidenceKinds,
 * heuristic) are unchanged from the ledger contract.
 */
export const ScoredCriterionSchema = RubricCriterionSchema.extend({
  label: z.string().min(1).max(80),
  signals: z.array(z.enum(SCORING_SIGNAL_IDS)).min(1),
});
export type ScoredCriterion = z.infer<typeof ScoredCriterionSchema>;

/**
 * A rubric template ready for scoring. The whole template is marked
 * heuristic until the rubric + fairness review says otherwise.
 */
export const ScoredRoleRubricSchema = RoleRubricSchema.extend({
  criteria: z.array(ScoredCriterionSchema).min(1),
  heuristic: z.literal(true),
});
export type ScoredRoleRubric = z.infer<typeof ScoredRoleRubricSchema>;

/**
 * Fixed template: software engineer working with AI agents (v1).
 *
 * The id/description/weight/evidenceKinds of each criterion are copied
 * verbatim from the draft in `supabase/seed.sql` (no owner edits were found
 * in the repo — see docs/DECISIONS.md). Added per criterion: a short label
 * and the deterministic signals it reads. HEURISTIC, NOT VALIDATED.
 */
export const SOFTWARE_ENGINEER_AI_RUBRIC_V1: ScoredRoleRubric = ScoredRoleRubricSchema.parse({
  roleId: 'software-engineer-ai',
  version: 1,
  title: 'Software Engineer working with AI agents (backend/full-stack) — heuristic draft',
  publishedAt: '2026-10-29T00:00:00.000Z',
  heuristic: true,
  criteria: [
    {
      id: 'task-decomposition',
      label: 'Task decomposition',
      description:
        'Breaks work into small verifiable steps instead of mega-prompts. Signal: prompt transcripts show stepwise plans with tool calls scoped to one step at a time.',
      weight: 0.25,
      evidenceKinds: ['prompt_transcript', 'tool_calls'],
      heuristic: true,
      signals: ['recovery-cost', 'revert-count'],
    },
    {
      id: 'test-driven-iteration',
      label: 'Test-driven iteration',
      description:
        'Drives debugging with test runs rather than guessing. Signal: repeated test_run evidence interleaved with edits, showing failing-to-passing transitions.',
      weight: 0.25,
      evidenceKinds: ['test_run', 'tool_calls'],
      heuristic: true,
      signals: ['test-follow-share', 'edit-test-latency'],
    },
    {
      id: 'change-quality',
      label: 'Change quality',
      description:
        'Produces coherent, reviewable agent-assisted diffs. Signal: repo snapshots show focused diffs without unrelated churn.',
      weight: 0.2,
      evidenceKinds: ['repo_snapshot'],
      heuristic: true,
      signals: ['revert-count', 'test-follow-share'],
    },
    {
      id: 'verification-discipline',
      label: 'Verification discipline',
      description:
        'Verifies agent output before claiming done. Signal: test runs and snapshots follow agent edits instead of untested handoffs.',
      weight: 0.15,
      evidenceKinds: ['test_run', 'repo_snapshot'],
      heuristic: true,
      signals: ['test-follow-share', 'edit-test-latency', 'hidden-test-outcome'],
    },
    {
      id: 'oversight-recovery',
      label: 'Oversight and recovery',
      description:
        'Catches and corrects agent mistakes. Signal: transcripts and tool calls show rejection or re-prompting after bad agent output, followed by corrected snapshots.',
      weight: 0.15,
      evidenceKinds: ['prompt_transcript', 'tool_calls', 'repo_snapshot'],
      heuristic: true,
      signals: ['recovery-cost', 'revert-count'],
    },
  ],
});

const RUBRIC_REGISTRY = new Map<string, ScoredRoleRubric>([
  ['software-engineer-ai@1', SOFTWARE_ENGINEER_AI_RUBRIC_V1],
]);

/** Load a fixed rubric template. Throws for unknown role/version. */
export function loadRubric(roleId: string, version: number = 1): ScoredRoleRubric {
  const found = RUBRIC_REGISTRY.get(`${roleId}@${version}`);
  if (!found) {
    throw new Error(`[vault-verify] unknown rubric template: ${roleId}@v${version}`);
  }
  return found;
}
