import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from './primitives.js';

/**
 * Q4: grants are append-only events; current state derives from events.
 * A grant stream (`grantId`) starts with `issued` and ends with `revoked`.
 * Latest event wins; a grant is active iff the latest event is `issued`
 * and unexpired (see the `active_grants` view in supabase/migrations).
 */
export const GrantEventTypeSchema = z.enum(['issued', 'revoked']);
export type GrantEventType = z.infer<typeof GrantEventTypeSchema>;

export const GrantIssuedEventSchema = z.object({
  eventId: UuidSchema,
  grantId: UuidSchema,
  eventType: z.literal('issued'),
  candidateId: UuidSchema,
  orgId: UuidSchema,
  roleId: z.string().min(1).max(80),
  evidenceItemIds: z.array(UuidSchema).min(1),
  issuedAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema.optional(),
});
export type GrantIssuedEvent = z.infer<typeof GrantIssuedEventSchema>;

export const GrantRevokedEventSchema = z.object({
  eventId: UuidSchema,
  grantId: UuidSchema,
  eventType: z.literal('revoked'),
  candidateId: UuidSchema,
  orgId: UuidSchema,
  roleId: z.string().min(1).max(80),
  revokedAt: IsoDateTimeSchema,
});
export type GrantRevokedEvent = z.infer<typeof GrantRevokedEventSchema>;

export const GrantEventSchema = z.discriminatedUnion('eventType', [
  GrantIssuedEventSchema,
  GrantRevokedEventSchema,
]);
export type GrantEvent = z.infer<typeof GrantEventSchema>;

/** Derived current state of one grant stream (never written directly). */
export const GrantStatusSchema = z.enum(['active', 'revoked', 'expired']);
export type GrantStatus = z.infer<typeof GrantStatusSchema>;

export const GrantStateSchema = z.object({
  grantId: UuidSchema,
  candidateId: UuidSchema,
  orgId: UuidSchema,
  roleId: z.string().min(1).max(80),
  evidenceItemIds: z.array(UuidSchema).min(1),
  grantedAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema.optional(),
  status: GrantStatusSchema,
});
export type GrantState = z.infer<typeof GrantStateSchema>;
