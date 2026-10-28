import { z } from 'zod';
import { EvidenceKindSchema, IsoDateTimeSchema, UuidSchema } from './primitives';

/**
 * Unsigned content from a Tier 2 adapter. Adapters parse agent transcripts;
 * the harness assigns chain position, hashes, and signs. Chain integrity
 * never depends on adapter code.
 */
export const UnsignedEventSchema = z.object({
  kind: EvidenceKindSchema,
  payload: z.unknown(),
  collectedAt: IsoDateTimeSchema,
});
export type UnsignedEvent = z.infer<typeof UnsignedEventSchema>;

export const AdapterCollectInputSchema = z.object({
  candidateId: UuidSchema,
  /** Agent session identifier, e.g. conversation or run id. */
  sessionRef: z.string().min(1).max(200),
  /** Incremental collection cursor. */
  since: IsoDateTimeSchema.optional(),
});
export type AdapterCollectInput = z.infer<typeof AdapterCollectInputSchema>;

export const AdapterCollectOutputSchema = z.object({
  adapterId: z.string().min(1).max(120),
  events: z.array(UnsignedEventSchema),
});
export type AdapterCollectOutput = z.infer<typeof AdapterCollectOutputSchema>;

/** Tier 2 per-agent adapter: parses agent transcripts into unsigned events. */
export interface EvidenceAdapter {
  readonly id: string;
  readonly agent: string;
  readonly tier: 2;
  collect(input: AdapterCollectInput): Promise<AdapterCollectOutput>;
}
