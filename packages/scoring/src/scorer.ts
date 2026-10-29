import { randomUUID } from 'node:crypto';
import {
  FluencyReportSchema,
  JudgeVerdictSchema,
  LEVEL_CONFIDENCE_CAP,
  type CriterionScore,
  type FluencyReport,
  type JudgeAspect,
  type JudgeRequest,
  type JudgeVerdict,
  type ScoredRoleRubric,
  type SessionScoresInput,
  type SignalScore,
} from '@vault-verify/core';
import { computeSignals } from './signals.js';
import { knownRefs } from './payloads.js';
import { redactForJudge } from './redact.js';
import type { FluencyJudge } from './judge.js';

export class UnverifiableSessionError extends Error {
  constructor(detail: string) {
    super(`[vault-verify] refusing to score an unverified session: ${detail}`);
    this.name = 'UnverifiableSessionError';
  }
}

/**
 * Which criteria receive LLM judgments. Prompting behavior is assessed
 * under task-decomposition (stepwise plans vs mega-prompts); every other
 * criterion in v1 is deterministic-only.
 */
export const JUDGE_ASPECTS_BY_CRITERION: Record<string, JudgeAspect[]> = {
  'task-decomposition': ['decomposition', 'instruction-quality'],
};

/**
 * Score one verified session against a rubric. Signals are computed only
 * from verified events: L0 input is refused. Uncited, miscited, or
 * malformed judge verdicts are discarded (counted, never fatal). The input
 * verification verdict is echoed untouched — the judge never affects it.
 */
export async function scoreSession(args: {
  input: SessionScoresInput;
  rubric: ScoredRoleRubric;
  judge?: FluencyJudge;
  generator?: string;
  generatedAt?: string;
}): Promise<FluencyReport> {
  const { input, rubric } = args;
  if (input.verification.level === 'L0') {
    throw new UnverifiableSessionError(input.verification.reasons.join('; ') || 'no reasons');
  }
  const signals = computeSignals(input.records, input.hiddenTestOutcome);
  const byId = new Map(signals.map((s) => [s.signal, s]));
  const derived = redactForJudge(input.records);
  const known = knownRefs(input.records);
  const cap = LEVEL_CONFIDENCE_CAP[input.verification.level];

  const criteria: CriterionScore[] = [];
  for (const criterion of rubric.criteria) {
    const wanted = criterion.signals
      .map((id) => byId.get(id))
      .filter((s): s is SignalScore => s !== undefined);
    const parts: number[] = [];
    for (const s of wanted) {
      if (s.score !== null) parts.push(s.score);
    }
    const cited = new Set<string>();
    for (const s of wanted) {
      for (const id of s.citedEventIds) cited.add(id);
    }
    const judgments: JudgeVerdict[] = [];
    let discardedJudgments = 0;
    if (args.judge) {
      for (const aspect of JUDGE_ASPECTS_BY_CRITERION[criterion.id] ?? []) {
        const request: JudgeRequest = {
          criterion: { id: criterion.id, label: criterion.label, description: criterion.description },
          aspect,
          events: derived,
          signalContext: wanted,
        };
        let verdict: JudgeVerdict | null = null;
        try {
          const parsed = JudgeVerdictSchema.safeParse(await args.judge.judge(request));
          if (parsed.success) verdict = parsed.data;
        } catch {
          verdict = null;
        }
        const citable =
          verdict !== null &&
          verdict.criterionId === criterion.id &&
          verdict.citedEventIds.length > 0 &&
          verdict.citedEventIds.every((id) => known.has(id));
        if (!citable || verdict === null) {
          discardedJudgments += 1;
          continue;
        }
        judgments.push(verdict);
        parts.push(verdict.score);
        for (const id of verdict.citedEventIds) cited.add(id);
      }
    }
    const score = parts.length > 0 ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
    criteria.push({
      criterionId: criterion.id,
      label: criterion.label,
      weight: criterion.weight,
      score,
      confidence: score === null ? 0 : cap,
      citedEventIds: [...cited].sort(),
      signals: wanted,
      judgments,
      discardedJudgments,
    });
  }

  const scored = criteria.filter((c): c is CriterionScore & { score: number } => c.score !== null);
  const weightSum = scored.reduce((a, c) => a + c.weight, 0);
  const overallScore =
    scored.length === 0 ? null : scored.reduce((a, c) => a + c.score * c.weight, 0) / weightSum;

  return FluencyReportSchema.parse({
    id: randomUUID(),
    candidateId: input.candidateId,
    sessionId: input.sessionId,
    roleId: rubric.roleId,
    rubricVersion: rubric.version,
    criteria,
    overallScore,
    verification: input.verification,
    heuristic: true,
    generator: args.generator ?? 'scorer@0.1',
    generatedAt: args.generatedAt ?? new Date().toISOString(),
  });
}
