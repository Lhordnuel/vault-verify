import { z } from 'zod';

/** Canonical id for all entities. */
export const UuidSchema = z.string().uuid();
export type Uuid = z.infer<typeof UuidSchema>;

/** ISO 8601 timestamp; offsets allowed, UTC preferred. */
export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/** Lowercase-hex sha256 digest (64 chars). Canonical form is always lowercase. */
export const Hex64Schema = z.string().regex(/^[0-9a-f]{64}$/);
export type Hex64 = z.infer<typeof Hex64Schema>;

/** Lowercase-hex ed25519 signature (128 chars). Single-scheme for now; see DECISIONS.md. */
export const Hex128Schema = z.string().regex(/^[0-9a-f]{128}$/);
export type Hex128 = z.infer<typeof Hex128Schema>;

/** Server-issued anchor nonce: 128 bits, lowercase hex. */
export const NonceSchema = z.string().regex(/^[0-9a-f]{32}$/);
export type Nonce = z.infer<typeof NonceSchema>;

/**
 * Fixed set of evidence kinds. Rubrics reference these; adding a kind is a
 * contract change (new core minor + migration if new columns are needed).
 */
export const EVIDENCE_KINDS = [
  'repo_snapshot',
  'test_run',
  'prompt_transcript',
  'tool_calls',
  'self_report',
] as const;

export const EvidenceKindSchema = z.enum(EVIDENCE_KINDS);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

/**
 * Collection tier: 0 = uncollected / self-reported, 1 = harness-owned
 * capture (works with any agent), 2 = per-agent adapter content.
 */
export const CollectionTierSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export type CollectionTier = z.infer<typeof CollectionTierSchema>;
