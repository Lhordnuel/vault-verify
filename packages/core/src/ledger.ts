import { z } from 'zod';
import {
  CollectionTierSchema,
  EvidenceKindSchema,
  Hex64Schema,
  Hex128Schema,
  IsoDateTimeSchema,
  NonceSchema,
  UuidSchema,
} from './primitives';
import { VerificationLevelSchema } from './levels';

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
 * Periodic checkpoint over a seq range, bound to a server-issued nonce so a
 * candidate cannot pre-compute or rewrite history without detection.
 */
export const AnchorSchema = z
  .object({
    id: UuidSchema,
    candidateId: UuidSchema,
    fromSeq: z.number().int().min(0),
    toSeq: z.number().int().min(0),
    /** Checkpoint hash committing to events fromSeq..toSeq (exact construction: harness spec, deferred). */
    anchorHash: Hex64Schema,
    nonce: NonceSchema,
    /** Anchor service identity, e.g. 'anchor/vault-verify@0.1'. */
    issuer: z.string().min(1).max(120),
    signature: Hex128Schema,
    anchoredAt: IsoDateTimeSchema,
  })
  .refine((a) => a.toSeq >= a.fromSeq, { message: 'toSeq must be >= fromSeq' });
export type Anchor = z.infer<typeof AnchorSchema>;
