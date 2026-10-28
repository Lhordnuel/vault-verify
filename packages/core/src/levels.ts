import { z } from 'zod';

/**
 * Ordered verification levels, weakest to strongest.
 * Stored on every evidence item; claims inherit the minimum of cited items.
 *
 * L0 self-reported — candidate-supplied, no corroboration.
 * L1 linked — referenced artifact exists (e.g. connected repo).
 * L2 platform-observed — collected by our harness or collector.
 * L3 chain-verified — hash chain + signatures internally consistent.
 * L4 anchored + corroborated — server nonce/anchors verify AND harness
 * facts agree.
 */
export const VERIFICATION_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;

export const VerificationLevelSchema = z.enum(VERIFICATION_LEVELS);
export type VerificationLevel = z.infer<typeof VerificationLevelSchema>;
