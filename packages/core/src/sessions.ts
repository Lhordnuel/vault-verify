import { z } from 'zod';
import { Hex64Schema, IsoDateTimeSchema, UuidSchema } from './primitives';

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
