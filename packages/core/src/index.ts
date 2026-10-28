export { VERIFICATION_LEVELS, VerificationLevelSchema } from './levels';
export type { VerificationLevel } from './levels';

export {
  UuidSchema,
  IsoDateTimeSchema,
  Hex64Schema,
  Hex128Schema,
  NonceSchema,
  EVIDENCE_KINDS,
  EvidenceKindSchema,
  CollectionTierSchema,
} from './primitives';
export type {
  Uuid,
  IsoDateTime,
  Hex64,
  Hex128,
  Nonce,
  EvidenceKind,
  CollectionTier,
} from './primitives';

export { GENESIS_PREV_HASH, SignedEventSchema, EvidenceItemSchema, AnchorSchema } from './ledger';
export type { SignedEvent, EvidenceItem, Anchor } from './ledger';

export {
  RubricCriterionSchema,
  RoleRubricSchema,
  ClaimSchema,
  VerificationSummarySchema,
  ScreeningReportSchema,
} from './claims';
export type {
  RubricCriterion,
  RoleRubric,
  Claim,
  VerificationSummary,
  ScreeningReport,
} from './claims';

export {
  GrantEventTypeSchema,
  GrantIssuedEventSchema,
  GrantRevokedEventSchema,
  GrantEventSchema,
  GrantStatusSchema,
  GrantStateSchema,
} from './access';
export type {
  GrantEventType,
  GrantIssuedEvent,
  GrantRevokedEvent,
  GrantEvent,
  GrantStatus,
  GrantState,
} from './access';

export { CollectorSessionSchema, SessionKeypairSchema } from './sessions';
export type { CollectorSession, SessionKeypair } from './sessions';

export { CRYPTO_SPEC_VERSION, DOMAIN_SEPARATION, hashInput } from './crypto-spec';
export type { CryptoDomain } from './crypto-spec';

// NOTE: `./crypto.node` (node:crypto signing/verification) is intentionally
// NOT re-exported here. It is a separate node-only entrypoint:
// `@vault-verify/core/node`. Keeps browser bundles free of node:crypto.

export {
  UnsignedEventSchema,
  AdapterCollectInputSchema,
  AdapterCollectOutputSchema,
} from './adapter';
export type {
  UnsignedEvent,
  AdapterCollectInput,
  AdapterCollectOutput,
  EvidenceAdapter,
} from './adapter';
