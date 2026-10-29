import { z } from 'zod';
import {
  CollectionTierSchema,
  EvidenceKindSchema,
  Hex64Schema,
  Hex128Schema,
  IsoDateTimeSchema,
  NonceSchema,
  UuidSchema,
} from './primitives.js';
import { VerificationLevelSchema } from './levels.js';

/**
 * One link in a candidate's hash chain.
 *
 * Crypto (Q2, spec vv-crypto-1; executable form in `./crypto.node`):
 * - hash = sha256hex(`vv-crypto-1:event` + LF + JCS({ seq, prevHash, payload }))
 * - sig = lowercase-hex ed25519 signature over the hash bytes, made by the
 *   session key in `EvidenceItem.sessionId`
 * - genesis link uses prevHash = GENESIS_PREV_HASH
 *
 * Payload MUST be JSON-serializable. Large blobs live behind
 * { uri, sha256 } pointers (Supabase Storage integration is deferred).
 */
export const SignedEventSchema = z.object({
  seq: z.number().int().min(0),
  prevHash: Hex64Schema,
  payload: z.unknown(),
  hash: Hex64Schema,
  sig: Hex128Schema,
});
export type SignedEvent = z.infer<typeof SignedEventSchema>;

/** prevHash of the genesis link: 64 zeros. */
export const GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * A chained evidence item: chain link plus ledger metadata.
 * Stored flattened in the evidence_items table (see supabase/migrations).
 */
export const EvidenceItemSchema = z.object({
  id: UuidSchema,
  candidateId: UuidSchema,
  kind: EvidenceKindSchema,
  tier: CollectionTierSchema,
  verificationLevel: VerificationLevelSchema,
  /** Collector identity, e.g. 'harness/git-capture@0.1' or 'adapter/claude-code@0.1'. */
  collectorId: z.string().min(1).max(120),
  /**
   * Session whose key signed this item (see CollectorSession). Absent for
   * L0/L1 items that predate sessions or are unsigned.
   */
  sessionId: UuidSchema.optional(),
  event: SignedEventSchema,
  collectedAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
  /** Set when the candidate withdraws the item; tombstoned items are invisible to orgs. */
  tombstonedAt: IsoDateTimeSchema.optional(),
  /** Optional one-line human summary for reports. */
  summary: z.string().min(1).max(280).optional(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

/**
 * Stored anchor: the server countersigns a session chain head. fromSeq is the
 * previously anchored head + 1 (0 for the first anchor of a session).
 */
export const AnchorSchema = z
  .object({
    id: UuidSchema,
    candidateId: UuidSchema,
    sessionId: UuidSchema,
    fromSeq: z.number().int().min(0),
    toSeq: z.number().int().min(0),
    /** Chain head hash at toSeq. */
    anchorHash: Hex64Schema,
    /** Session nonce (denormalized from the session for audit). */
    nonce: NonceSchema,
    /** Anchor service identity, e.g. 'anchor/session@1'. */
    issuer: z.string().min(1).max(120),
    /** Server countersignature over canonical {sessionId, seq, headHash, serverTime}. */
    signature: Hex128Schema,
    anchoredAt: IsoDateTimeSchema,
  })
  .refine((a) => a.toSeq >= a.fromSeq, { message: 'toSeq must be >= fromSeq' });
export type Anchor = z.infer<typeof AnchorSchema>;

/** Collector -> anchor service: checkpoint this session head. */
export const AnchorRequestSchema = z.object({
  sessionId: UuidSchema,
  seq: z.number().int().min(0),
  headHash: Hex64Schema,
});
export type AnchorRequest = z.infer<typeof AnchorRequestSchema>;

/**
 * Anchor service -> collector: countersigned checkpoint. Canonical form for
 * the signature is JCS over keys in order headHash, seq, serverTime,
 * sessionId, hashed under vv-crypto-1:anchor (see verifyAnchorReceipt; the
 * edge handler constructs the identical byte order by hand).
 */
export const AnchorReceiptSchema = z.object({
  sessionId: UuidSchema,
  seq: z.number().int().min(0),
  headHash: Hex64Schema,
  serverTime: IsoDateTimeSchema,
  signature: Hex128Schema,
});
export type AnchorReceipt = z.infer<typeof AnchorReceiptSchema>;
