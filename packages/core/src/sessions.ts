import { z } from 'zod';
import { AnchorReceiptSchema, SignedEventSchema } from './ledger.js';
import { Hex64Schema, IsoDateTimeSchema, NonceSchema, UuidSchema } from './primitives.js';

/**
 * Q6: per-session collector keys. The keypair is generated locally on the
 * candidate machine; the private key never leaves it. The public key is
 * registered here at session start so signatures stay verifiable.
 */
export const CollectorSessionSchema = z.object({
  id: UuidSchema,
  candidateId: UuidSchema,
  /** Lowercase-hex ed25519 public key (32 bytes). */
  publicKey: Hex64Schema,
  /** Server-issued session nonce; the chain genesis prevHash derives from it. */
  nonce: NonceSchema,
  registeredAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema.optional(),
  revokedAt: IsoDateTimeSchema.optional(),
});
export type CollectorSession = z.infer<typeof CollectorSessionSchema>;

/**
 * Local-only session keypair. The private key (ed25519 seed, 32 bytes hex)
 * MUST never leave the candidate machine or enter the database.
 */
export const SessionKeypairSchema = z.object({
  publicKey: Hex64Schema,
  privateKey: Hex64Schema,
});
export type SessionKeypair = z.infer<typeof SessionKeypairSchema>;

/** Harness -> anchor service: open a session for this key. */
export const SessionStartRequestSchema = z.object({
  publicKey: Hex64Schema,
});
export type SessionStartRequest = z.infer<typeof SessionStartRequestSchema>;

/** Anchor service -> harness: session identity plus its nonce. */
export const SessionStartResponseSchema = z.object({
  sessionId: UuidSchema,
  nonce: NonceSchema,
  candidateId: UuidSchema,
});
export type SessionStartResponse = z.infer<typeof SessionStartResponseSchema>;

/** One independently observed fact: canonical payload digest at a seq. */
export const HarnessObservationSchema = z.object({
  seq: z.number().int().min(0),
  /** sha256hex over the canonical JSON payload, as observed by the harness. */
  payloadHash: Hex64Schema,
});
export type HarnessObservation = z.infer<typeof HarnessObservationSchema>;

/**
 * Trusted verification inputs. The caller MUST source sessionId/nonce/
 * sessionPublicKey from the server session record and anchorPublicKey from
 * deployment config — never from the party being verified.
 */
export const HarnessFactsSchema = z.object({
  sessionId: UuidSchema,
  nonce: NonceSchema,
  sessionPublicKey: Hex64Schema,
  anchorPublicKey: Hex64Schema,
  observations: z.array(HarnessObservationSchema),
  /**
   * Collection provenance. Absent = live (back-compat). Retroactive
   * sessions (sealed at import from a past log) verify at most L2.
   */
  provenance: z.enum(['live', 'retroactive']).optional(),
});
export type HarnessFacts = z.infer<typeof HarnessFactsSchema>;

/**
 * Portable session log: everything `verifySession` needs (facts, events,
 * anchors) in one JSON document. The report "Verify this log" panel and
 * any offline audit consume this shape. Carries public keys only.
 */
export const SessionLogSchema = z.object({
  version: z.literal('vv-session-log/1'),
  facts: HarnessFactsSchema,
  events: z.array(SignedEventSchema),
  anchors: z.array(AnchorReceiptSchema),
});
export type SessionLog = z.infer<typeof SessionLogSchema>;

export type SessionLogParse =
  | { ok: true; data: SessionLog }
  | { ok: false; issues: string[] };

/** Parse pasted/uploaded JSON into a SessionLog (never throws). */
export function parseSessionLogText(text: string): SessionLogParse {
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, issues: ['not valid JSON'] };
  }
  const parsed = SessionLogSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  return { ok: true, data: parsed.data };
}
