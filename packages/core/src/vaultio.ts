import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from './primitives.js';

/**
 * Talent context per candidate, joined live from Vaultio tables by the
 * `talent_context` view (migration 4). Keys mirror the view's snake_case
 * column names exactly (no camelCase mapping) so UI queries type-check 1:1.
 *
 * Every context field is nullable: LEFT JOINs yield NULL where the talent
 * has no row, and Vaultio RLS yields NULL where the caller may not see it.
 * Secrets are never selected (no OAuth tokens, no credentials).
 */
export const TalentContextSchema = z.object({
  candidate_id: UuidSchema,
  auth_user_id: UuidSchema,
  // Vaultio profile: identity + professional links.
  full_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  bio: z.string().nullable(),
  profession: z.string().nullable(),
  skills: z.unknown().nullable(),
  github_url: z.string().nullable(),
  linkedin_url: z.string().nullable(),
  portfolio_links: z.unknown().nullable(),
  country: z.string().nullable(),
  is_verified: z.boolean().nullable(),
  username: z.string().nullable(),
  // CV (latest upload).
  cv_text: z.string().nullable(),
  cv_url: z.string().nullable(),
  cv_uploaded_at: IsoDateTimeSchema.nullable(),
  // Verified profile + consent flags.
  verified_slug: z.string().nullable(),
  claimed_skills: z.unknown().nullable(),
  target_roles: z.unknown().nullable(),
  verified_is_public: z.boolean().nullable(),
  verified_share_with_recruiters: z.boolean().nullable(),
  show_name: z.boolean().nullable(),
  show_bio: z.boolean().nullable(),
  show_profession: z.boolean().nullable(),
  show_skills: z.boolean().nullable(),
  show_target_roles: z.boolean().nullable(),
  // Linked GitHub/LinkedIn presence.
  github_connected: z.boolean().nullable(),
  github_username: z.string().nullable(),
  github_score: z.number().int().nullable(),
  github_analysis: z.unknown().nullable(),
  github_connected_at: IsoDateTimeSchema.nullable(),
  linkedin_connected: z.boolean().nullable(),
  linkedin_profile_url: z.string().nullable(),
  linkedin_score: z.number().int().nullable(),
  linkedin_analysis: z.unknown().nullable(),
  linkedin_connected_at: IsoDateTimeSchema.nullable(),
  overall_score: z.number().int().nullable(),
  confidence: z.string().nullable(),
  flags: z.unknown().nullable(),
  presence_shared_with_recruiters: z.boolean().nullable(),
  analysis_status: z.string().nullable(),
  last_analyzed_at: IsoDateTimeSchema.nullable(),
  // Deep GitHub analysis (service-side only; NULL for interactive roles).
  github_deep_analysis: z.unknown().nullable(),
});
export type TalentContext = z.infer<typeof TalentContextSchema>;
