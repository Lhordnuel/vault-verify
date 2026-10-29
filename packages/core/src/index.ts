export { VERIFICATION_LEVELS, VerificationLevelSchema } from './levels.js';
export type { VerificationLevel } from './levels.js';

export {
  UuidSchema,
  IsoDateTimeSchema,
  Hex64Schema,
  Hex128Schema,
  NonceSchema,
  EVIDENCE_KINDS,
  EvidenceKindSchema,
  CollectionTierSchema,
} from './primitives.js';
export type {
  Uuid,
  IsoDateTime,
  Hex64,
  Hex128,
  Nonce,
  EvidenceKind,
  CollectionTier,
} from './primitives.js';

export {
  GENESIS_PREV_HASH,
  SignedEventSchema,
  EvidenceItemSchema,
  AnchorSchema,
  AnchorRequestSchema,
  AnchorReceiptSchema,
} from './ledger.js';
export type {
  SignedEvent,
  EvidenceItem,
  Anchor,
  AnchorRequest,
  AnchorReceipt,
} from './ledger.js';

export {
  RubricCriterionSchema,
  RoleRubricSchema,
  ClaimSchema,
  VerificationSummarySchema,
  ScreeningReportSchema,
} from './claims.js';
export type {
  RubricCriterion,
  RoleRubric,
  Claim,
  VerificationSummary,
  ScreeningReport,
} from './claims.js';

export {
  GrantEventTypeSchema,
  GrantIssuedEventSchema,
  GrantRevokedEventSchema,
  GrantEventSchema,
  GrantStatusSchema,
  GrantStateSchema,
} from './access.js';
export type {
  GrantEventType,
  GrantIssuedEvent,
  GrantRevokedEvent,
  GrantEvent,
  GrantStatus,
  GrantState,
} from './access.js';

export {
  CollectorSessionSchema,
  SessionKeypairSchema,
  SessionStartRequestSchema,
  SessionStartResponseSchema,
  HarnessObservationSchema,
  HarnessFactsSchema,
  SessionLogSchema,
  parseSessionLogText,
} from './sessions.js';
export type {
  CollectorSession,
  SessionKeypair,
  SessionStartRequest,
  SessionStartResponse,
  HarnessObservation,
  HarnessFacts,
  SessionLog,
  SessionLogParse,
} from './sessions.js';

export {
  SCORING_SIGNAL_IDS,
  ScoredCriterionSchema,
  ScoredRoleRubricSchema,
  SOFTWARE_ENGINEER_AI_RUBRIC_V1,
  loadRubric,
} from './rubric.js';
export type { ScoringSignalId, ScoredCriterion, ScoredRoleRubric } from './rubric.js';

export {
  ScoredEventSchema,
  VerificationInfoSchema,
  LEVEL_CONFIDENCE_CAP,
  SignalScoreSchema,
  JUDGE_ASPECTS,
  JudgeAspectSchema,
  JudgeVerdictSchema,
  DerivedEventSchema,
  JudgeRequestSchema,
  CriterionScoreSchema,
  FluencyReportSchema,
  SessionScoresInputSchema,
  TIMELINE_KINDS,
  TimelineKindSchema,
  TimelineMomentSchema,
} from './scoring.js';
export type {
  ScoredEvent,
  VerificationInfo,
  SignalScore,
  JudgeAspect,
  JudgeVerdict,
  DerivedEvent,
  JudgeRequest,
  CriterionScore,
  FluencyReport,
  SessionScoresInput,
  TimelineKind,
  TimelineMoment,
} from './scoring.js';

export { CRYPTO_SPEC_VERSION, DOMAIN_SEPARATION, hashInput } from './crypto-spec.js';
export type { CryptoDomain } from './crypto-spec.js';

// NOTE: `./node` (node:crypto signing/verification) is intentionally NOT
// re-exported here. It is a separate node-only entrypoint:
// `@vault-verify/core/node`. Keeps browser bundles free of node:crypto.

export {
  UnsignedEventSchema,
  AdapterCollectInputSchema,
  AdapterCollectOutputSchema,
} from './adapter.js';
export type {
  UnsignedEvent,
  AdapterCollectInput,
  AdapterCollectOutput,
  EvidenceAdapter,
} from './adapter.js';

export { TalentContextSchema } from './vaultio.js';
export type { TalentContext } from './vaultio.js';

export { REDACTED, containsSecretShape, redactText, redactValue } from './redact.js';

export {
  AGENT_EVENT_TYPES,
  AgentEventSchema,
  AgentEventTypeSchema,
  classifyAgentEvent,
  parseDiffstatCounts,
  scoredEventToAgentEvent,
} from './agent-events.js';
export type { AgentEvent, AgentEventType } from './agent-events.js';

export {
  AgentFluencyModuleSchema,
  ContradictionFlagSchema,
  EvidenceProfileSchema,
  RoleTemplateSchema,
  SOFTWARE_ENGINEER_TEMPLATE_V1,
  SignalValueSchema,
  SkillClaimSchema,
  SkillRequirementSchema,
  WorkingPatternSummarySchema,
  loadRoleTemplate,
} from './evidence.js';
export type {
  AgentFluencyModule,
  ContradictionFlag,
  EvidenceProfile,
  RoleTemplate,
  SignalValue,
  SkillClaim,
  SkillRequirement,
  WorkingPatternSummary,
} from './evidence.js';

export {
  AttemptPayloadSchema,
  AttemptResultSchema,
  TestDefinitionSchema,
  deriveAttemptParams,
} from './attempts.js';
export type { AttemptPayload, AttemptResult, TestDefinition } from './attempts.js';

export {
  ShareLinkSchema,
  ShareViewEntrySchema,
  generateShareToken,
  hashShareToken,
  isShareLinkActive,
  recordShareView,
} from './share-links.js';
export type { ShareLink, ShareViewEntry } from './share-links.js';

export {
  AttemptRecordSchema,
  EvidenceLibrary,
  EvidenceRecordSchema,
  RoleRecordSchema,
  RoleReportSchema,
  ScreeningRecordSchema,
} from './library.js';
export type {
  AttemptRecord,
  EvidenceRecord,
  RoleRecord,
  RoleReport,
  ScreeningRecord,
} from './library.js';
