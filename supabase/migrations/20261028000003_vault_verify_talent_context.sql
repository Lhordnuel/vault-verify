-- Phase 3b: talent context linkage (Vaultio CV, profiles, GitHub surface in VaultVerify).
--
-- A security_invoker view joining Vaultio talent tables per candidate:
-- - Our candidates RLS gates the ROW (owner, or org with an active grant).
-- - Vaultio RLS gates each CONTEXT GROUP (self/participant/consented reads).
-- security_invoker is load-bearing: a default view owned by postgres would
-- bypass Vaultio RLS. Never remove it (see DECISIONS.md A28).
--
-- Explicitly NEVER surfaced: candidate_github_credentials (whole table),
-- candidate_online_presence.linkedin_oauth_token, OAuth PII mirror columns,
-- billing/wallet/referral columns, internal fetch logs.
--
-- candidate_github_analysis has RLS on with zero policies (Vaultio-side),
-- so it resolves NULL for interactive roles and is service-side only. The
-- live GitHub surface is candidate_online_presence (consented reads). The
-- report builder MUST honor share flags (shared_with_recruiters, is_public,
-- show_*) when including context, since service_role bypasses RLS.

CREATE VIEW public.talent_context WITH (security_invoker = true) AS
SELECT
  c.id AS candidate_id,
  c.auth_user_id,
  -- Vaultio profile: identity + professional links.
  p.full_name,
  p.avatar_url,
  p.bio,
  p.profession,
  p.skills,
  p.github_url,
  p.linkedin_url,
  p.portfolio_links,
  p.country,
  p.is_verified,
  p.username,
  -- CV (latest upload wins).
  cv.cv_text,
  cv.cv_url,
  cv.cv_uploaded_at,
  -- Verified profile + consent flags.
  vp.slug AS verified_slug,
  vp.claimed_skills,
  vp.target_roles,
  vp.is_public AS verified_is_public,
  vp.share_with_recruiters AS verified_share_with_recruiters,
  vp.show_name,
  vp.show_bio,
  vp.show_profession,
  vp.show_skills,
  vp.show_target_roles,
  -- Linked GitHub/LinkedIn presence (OAuth token deliberately excluded).
  op.github_connected,
  op.github_username,
  op.github_score,
  op.github_analysis,
  op.github_connected_at,
  op.linkedin_connected,
  op.linkedin_profile_url,
  op.linkedin_score,
  op.linkedin_analysis,
  op.linkedin_connected_at,
  op.overall_score,
  op.confidence,
  op.flags,
  op.shared_with_recruiters AS presence_shared_with_recruiters,
  op.analysis_status,
  op.last_analyzed_at,
  -- Deep GitHub analysis (service-side only; see header).
  ga.analysis AS github_deep_analysis
FROM public.candidates c
LEFT JOIN public.profiles p ON p.id = c.auth_user_id
LEFT JOIN LATERAL (
  SELECT cv_text, cv_url, cv_uploaded_at FROM public.user_cv_data
  WHERE user_id = c.auth_user_id ORDER BY updated_at DESC NULLS LAST LIMIT 1
) cv ON true
LEFT JOIN LATERAL (
  SELECT slug, claimed_skills, target_roles, is_public, share_with_recruiters,
    show_name, show_bio, show_profession, show_skills, show_target_roles
  FROM public.candidate_verified_profiles
  WHERE candidate_id = c.auth_user_id ORDER BY updated_at DESC NULLS LAST LIMIT 1
) vp ON true
LEFT JOIN LATERAL (
  SELECT github_connected, github_username, github_score, github_analysis,
    github_connected_at, linkedin_connected, linkedin_profile_url,
    linkedin_score, linkedin_analysis, linkedin_connected_at,
    overall_score, confidence, flags, shared_with_recruiters,
    analysis_status, last_analyzed_at
  FROM public.candidate_online_presence
  WHERE candidate_id = c.auth_user_id ORDER BY updated_at DESC NULLS LAST LIMIT 1
) op ON true
LEFT JOIN LATERAL (
  SELECT analysis FROM public.candidate_github_analysis
  WHERE candidate_id = c.auth_user_id ORDER BY updated_at DESC NULLS LAST LIMIT 1
) ga ON true;

GRANT SELECT ON public.talent_context TO authenticated;
GRANT SELECT ON public.talent_context TO service_role;

COMMENT ON VIEW public.talent_context IS
'Talent context per VaultVerify candidate, joined live from Vaultio tables. security_invoker keeps Vaultio RLS enforced; our candidates RLS gates the row. Report builder must honor share flags (service_role bypasses RLS). Secrets (OAuth tokens, credentials) are never selected.';
