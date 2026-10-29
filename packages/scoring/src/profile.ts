import {
  EvidenceProfileSchema,
  loadRoleTemplate,
  scoredEventToAgentEvent,
  type ContradictionFlag,
  type EvidenceProfile,
  type RoleTemplate,
  type ScoredEvent,
  type SignalValue,
  type SkillClaim,
  type VerificationLevel,
} from '@vault-verify/core';
import { computeSignals } from './signals.js';

/** One verified session feeding a profile. Records inherit the session level. */
export interface ProfileSession {
  sessionId: string;
  records: ScoredEvent[];
  level: VerificationLevel;
  hiddenTestOutcome?: { passed: boolean };
  fluency?: { level: VerificationLevel; citedCount: number; score: number | null };
}

export interface SkillEvidenceRef {
  sessionId: string;
  seq: number;
}

export interface BuildProfileArgs {
  candidateId: string;
  template: RoleTemplate;
  sessions: ProfileSession[];
  /** Skill -> evidence refs. Skills without refs get no claim. */
  skillMap: Record<string, SkillEvidenceRef[]>;
  extraFlags?: ContradictionFlag[];
}

const LEVEL_ORDER: VerificationLevel[] = ['L0', 'L1', 'L2', 'L3', 'L4'];

/** Strength weight per level. L0 contributes nothing (weak evidence never lowers). */
export const LEVEL_STRENGTH: Record<VerificationLevel, number> = {
  L0: 0,
  L1: 0.25,
  L2: 0.5,
  L3: 0.75,
  L4: 1,
};

function strongest(levels: VerificationLevel[]): VerificationLevel {
  let best: VerificationLevel = 'L0';
  for (const level of levels) {
    if (LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(best)) best = level;
  }
  return best;
}

/** Session test narrative: final outcome plus fail-to-pass recoveries. */
export interface SessionTestSummary {
  testRuns: number;
  /** Final run outcome; null when the session ran no tests. */
  finalPassed: boolean | null;
  recoveries: number;
}

/** Summarize a session's test runs (seq order) into final + recoveries. */
export function summarizeSessionTests(records: ScoredEvent[]): SessionTestSummary {
  const ordered = [...records].sort((a, b) => a.event.seq - b.event.seq);
  let testRuns = 0;
  let finalPassed: boolean | null = null;
  let recoveries = 0;
  let failing = false;
  for (const record of ordered) {
    const event = scoredEventToAgentEvent(record);
    if (event.type !== 'test_run' || !event.tests) continue;
    testRuns += 1;
    if (event.tests.failed > 0) {
      failing = true;
      finalPassed = false;
    } else {
      if (failing) recoveries += 1;
      failing = false;
      finalPassed = true;
    }
  }
  return { testRuns, finalPassed, recoveries };
}

/**
 * Session test quality in [0, 1] (heuristic): final outcome sets the base
 * (pass 0.8, fail 0.2), a fail-to-pass recovery adds 0.2 up to 1.
 * No test runs stays neutral at 0.5.
 */
export function scoreSessionTestQuality(summary: SessionTestSummary): number {
  if (summary.finalPassed === null) return 0.5;
  let quality = summary.finalPassed ? 0.8 : 0.2;
  if (summary.recoveries > 0) quality = Math.min(1, quality + 0.2);
  return quality;
}

/**
 * Per-item evidence quality in [0, 1]. Test runs share their session's
 * test quality; edits are neutral (Tier 1 cannot assess edit quality);
 * notes are weak corroboration. Used ONLY to pick each claim's best item.
 */
export function scoreEvidenceQuality(record: ScoredEvent, sessionTestQuality = 0.5): number {
  const event = scoredEventToAgentEvent(record);
  if (event.type === 'test_run') return Math.min(1, Math.max(0, sessionTestQuality));
  if (event.type === 'file_edit') return 0.5;
  return 0.25;
}

function refOf(sessionId: string, seq: number): string {
  return `${sessionId}:seq:${seq}`;
}

/**
 * Build a candidate evidence profile from verified sessions. Claims carry
 * raw signal VALUES (facts), never fit scores. Flags are detected
 * (unresolved failures, hidden-test contradictions) plus caller extras;
 * uplift ignores all flags by construction.
 */
export function buildEvidenceProfile(args: BuildProfileArgs): EvidenceProfile {
  const bySession = new Map<string, ProfileSession>();
  const testQuality = new Map<string, number>();
  for (const session of args.sessions) {
    bySession.set(session.sessionId, session);
    testQuality.set(session.sessionId, scoreSessionTestQuality(summarizeSessionTests(session.records)));
  }

  const claims: SkillClaim[] = [];
  for (const [skill, refs] of Object.entries(args.skillMap)) {
    const records: ScoredEvent[] = [];
    const levels: VerificationLevel[] = [];
    const evidenceIds: string[] = [];
    let best: SkillClaim['best'] | undefined;
    let bestProduct = -1;
    for (const ref of refs) {
      const session = bySession.get(ref.sessionId);
      const record = session?.records.find((r) => r.event.seq === ref.seq);
      if (!session || !record) {
        throw new Error(`[vault-verify] skill "${skill}" cites unknown evidence ${ref.sessionId}:seq:${ref.seq}`);
      }
      const evidenceId = refOf(ref.sessionId, ref.seq);
      records.push(record);
      levels.push(session.level);
      evidenceIds.push(evidenceId);
      const quality = scoreEvidenceQuality(record, testQuality.get(ref.sessionId) ?? 0.5);
      const product = quality * LEVEL_STRENGTH[session.level];
      if (product > bestProduct) {
        bestProduct = product;
        best = { evidenceId, level: session.level, quality };
      }
    }
    if (records.length === 0 || best === undefined) continue;
    const signals: SignalValue[] = computeSignals(records, undefined).map((s) => ({
      signal: s.signal,
      value: s.value,
    }));
    claims.push({ skill, evidenceIds, level: strongest(levels), signals, best });
  }

  let edits = 0;
  let testRuns = 0;
  let failures = 0;
  let recoveries = 0;
  let notes = 0;
  const depth = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 };
  const flags: ContradictionFlag[] = [...(args.extraFlags ?? [])];
  let bestFluency: ProfileSession['fluency'] | undefined;
  for (const session of args.sessions) {
    let failing = false;
    let lastTestPassed: boolean | null = null;
    let lastFailRef: string | null = null;
    const ordered = [...session.records].sort((a, b) => a.event.seq - b.event.seq);
    for (const record of ordered) {
      depth[session.level] += 1;
      const event = scoredEventToAgentEvent(record);
      if (event.type === 'file_edit') {
        edits += 1;
      } else if (event.type === 'test_run' && event.tests) {
        testRuns += 1;
        if (event.tests.failed > 0) {
          failures += 1;
          failing = true;
          lastTestPassed = false;
          lastFailRef = refOf(session.sessionId, record.event.seq);
        } else {
          if (failing) recoveries += 1;
          failing = false;
          lastTestPassed = true;
        }
      } else {
        notes += 1;
      }
    }
    if (lastTestPassed === false && lastFailRef !== null) {
      flags.push({
        code: 'unresolved-failure',
        detail: `session ${session.sessionId}: last test run fails with no later pass`,
        evidenceIds: [lastFailRef],
      });
    }
    if (session.hiddenTestOutcome?.passed === false && lastTestPassed === true) {
      flags.push({
        code: 'hidden-test-contradiction',
        detail: `session ${session.sessionId}: session tests pass but the hidden test fails`,
        evidenceIds: [],
      });
    }
    const fluency = session.fluency;
    if (fluency !== undefined) {
      const rank = (f: NonNullable<ProfileSession['fluency']>): number =>
        LEVEL_ORDER.indexOf(f.level) * 1000 + Math.min(f.citedCount, 999);
      if (bestFluency === undefined || rank(fluency) > rank(bestFluency)) bestFluency = fluency;
    }
  }

  return EvidenceProfileSchema.parse({
    candidateId: args.candidateId,
    templateId: args.template.templateId,
    templateVersion: args.template.version,
    sessionIds: args.sessions.map((s) => s.sessionId),
    claims,
    workingPatterns: { edits, testRuns, failures, recoveries, notes },
    depth,
    flags,
    ...(bestFluency === undefined ? {} : { fluency: bestFluency }),
  });
}

export const UPLIFT_RANGE_DEFAULT = 100;
export const UPLIFT_CAP_FRACTION_DEFAULT = 0.15;
/** Distinct-source saturation: presence = min(1, distinctSessions / K). */
export const SOURCE_SATURATION_K = 3;

export interface UpliftOptions {
  /** Absolute cap on the uplift. Default: 15% of range. */
  cap?: number;
  /** Score scale width; baseline lives in [0, range]. Default: 100. */
  range?: number;
  /** Fixed template. Default: registry lookup by profile template id/version. */
  template?: RoleTemplate;
}

/**
 * Uplift over the Vaultio baseline from an evidence profile. Per skill only
 * the BEST verified item counts (quality x level strength), corroborated
 * by distinct sources (sessions). Invariants (all tested): result >= 0;
 * capped; zero with no evidence; monotone in added evidence (best-product
 * and source-count only grow — heuristic scores and flags are ignored);
 * never exceeds scale headroom.
 */
export function computeUplift(
  baseline: number,
  profile: EvidenceProfile,
  capOrOpts?: number | UpliftOptions,
): number {
  if (!Number.isFinite(baseline)) {
    throw new Error('[vault-verify] baseline must be a finite number');
  }
  const opts: UpliftOptions = typeof capOrOpts === 'number' ? { cap: capOrOpts } : (capOrOpts ?? {});
  const range = opts.range ?? UPLIFT_RANGE_DEFAULT;
  if (!Number.isFinite(range) || range <= 0) {
    throw new Error('[vault-verify] uplift range must be a positive finite number');
  }
  const cap = opts.cap ?? UPLIFT_CAP_FRACTION_DEFAULT * range;
  if (!Number.isFinite(cap) || cap < 0) {
    throw new Error('[vault-verify] uplift cap must be a non-negative finite number');
  }
  const template = opts.template ?? loadRoleTemplate(profile.templateId, profile.templateVersion);

  const skillWeight = new Map(template.skills.map((s) => [s.skill, s.weight]));
  let earned = 0;
  for (const claim of profile.claims) {
    const weight = skillWeight.get(claim.skill);
    if (weight === undefined) continue; // non-template skills retained, unscored
    const sources = new Set(claim.evidenceIds.map((id) => id.split(':seq:')[0]));
    earned +=
      weight *
      claim.best.quality *
      LEVEL_STRENGTH[claim.best.level] *
      Math.min(1, sources.size / SOURCE_SATURATION_K);
  }
  let total = template.skills.reduce((a, s) => a + s.weight, 0);
  if (template.agentFluency !== undefined && profile.fluency !== undefined) {
    // Fluency cites live in one session; cite-count saturation retained.
    earned +=
      template.agentFluency.weight *
      LEVEL_STRENGTH[profile.fluency.level] *
      Math.min(1, profile.fluency.citedCount / SOURCE_SATURATION_K);
    total += template.agentFluency.weight;
  }
  const strength = total > 0 ? earned / total : 0;
  const headroom = Math.max(0, range - baseline);
  return Math.max(0, Math.min(cap, strength * range, headroom));
}
