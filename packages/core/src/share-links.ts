import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { Hex64Schema, IsoDateTimeSchema, UuidSchema } from './primitives.js';

/**
 * A candidate-issued share link: references evidence ids by scope, carries
 * only the token HASH (the token itself is shown once at creation and never
 * stored). No UI yet — creation/storage endpoints are deferred to the
 * service layer; this is the contract plus pure helpers.
 */
export const ShareLinkSchema = z
  .object({
    id: UuidSchema,
    candidateId: UuidSchema,
    tokenHash: Hex64Schema,
    /** Evidence ids in scope — references only, never embedded evidence. */
    scope: z.array(UuidSchema).min(1),
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    revokedAt: IsoDateTimeSchema.optional(),
  })
  .refine((link) => Date.parse(link.expiresAt) > Date.parse(link.createdAt), {
    message: 'expiresAt must be after createdAt',
  });
export type ShareLink = z.infer<typeof ShareLinkSchema>;

/** One view of a share link. The log is append-only (see recordShareView). */
export const ShareViewEntrySchema = z.object({
  linkId: UuidSchema,
  viewedAt: IsoDateTimeSchema,
  viewerNote: z.string().min(1).max(280).optional(),
});
export type ShareViewEntry = z.infer<typeof ShareViewEntrySchema>;

/** 256-bit token, base64url. Show once; store only its hash. */
export function generateShareToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** sha256hex of a share token (what gets stored). */
export function hashShareToken(token: string): string {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('[vault-verify] share token must be a non-empty string');
  }
  return Hex64Schema.parse(bytesToHex(sha256(new TextEncoder().encode(token))));
}

/** Active = not revoked and not expired at `now` (default: current time). */
export function isShareLinkActive(link: ShareLink, now?: string): boolean {
  const at = now === undefined ? Date.now() : Date.parse(now);
  if (!Number.isFinite(at)) return false;
  if (link.revokedAt !== undefined) return false;
  return at < Date.parse(link.expiresAt);
}

/** Append a validated view entry. Returns a new log; never mutates. */
export function recordShareView(log: ShareViewEntry[], entry: ShareViewEntry): ShareViewEntry[] {
  return [...log, ShareViewEntrySchema.parse(entry)];
}
