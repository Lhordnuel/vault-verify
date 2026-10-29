export {
  asSnapshot,
  asTestRun,
  eventRef,
  isFailingTestRun,
  knownRefs,
  parseDiffstatCounts,
  timeOf,
} from './payloads.js';
export type { SnapshotFacts, TestRunFacts } from './payloads.js';

export {
  computeSignals,
  editTestLatency,
  hiddenTestOutcome,
  recoveryCost,
  revertCount,
  testFollowShare,
} from './signals.js';

export { redactForJudge } from './redact.js';

export { MockJudge } from './judge.js';
export type { FluencyJudge, MockResponder } from './judge.js';

export { buildTimeline } from './timeline.js';

export { JUDGE_ASPECTS_BY_CRITERION, UnverifiableSessionError, scoreSession } from './scorer.js';

export {
  LEVEL_STRENGTH,
  SOURCE_SATURATION_K,
  UPLIFT_CAP_FRACTION_DEFAULT,
  UPLIFT_RANGE_DEFAULT,
  buildEvidenceProfile,
  computeUplift,
  scoreEvidenceQuality,
  scoreSessionTestQuality,
  summarizeSessionTests,
} from './profile.js';
export type {
  BuildProfileArgs,
  ProfileSession,
  SessionTestSummary,
  SkillEvidenceRef,
  UpliftOptions,
} from './profile.js';
