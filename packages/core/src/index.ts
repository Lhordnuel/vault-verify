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
} from './sessions.js';
export type {
  CollectorSession,
  SessionKeypair,
  SessionStartRequest,
  SessionStartResponse,
  HarnessObservation,
  HarnessFacts,
} from './sessions.js';

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
