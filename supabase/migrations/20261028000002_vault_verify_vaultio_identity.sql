-- Phase 3: Vaultio identity integration (shared login, no second account).
--
-- Same Supabase project = same auth.users, so a Vaultio login IS a
-- VaultVerify login by construction. This migration wires the rest:
-- 1. Candidates auto-provisioned from auth.users (trigger + backfill).
-- 2. VaultVerify orgs mirror Vaultio organizations (shared UUIDs); viewer
--    rights derive from Vaultio team membership (unioned with explicit
--    VaultVerify org membership).
-- 3. Hiring context (profiles, verified profiles, assessments, CV data)
--    needs NO schema change: Vaultio RLS already permits self/participant
--    reads, and the VaultVerify app queries with the same JWT.
--
-- Touches to Vaultio-owned objects (additive only, no column/behavior
-- changes, no RLS changes): one trigger on auth.users, two triggers on
-- organizations. Vaultio tables keep their own RLS, which this project
-- must never weaken.

-- --------------------------------------------------------------------------
-- 1. Candidate auto-provisioning
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_vaultverify_candidate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_handle text;
BEGIN
  v_handle := COALESCE(
    NULLIF(NEW.raw_user_meta_data ->> 'user_name', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
    NULLIF(split_part(NEW.email, '@', 1), ''),
    'user-' || substr(NEW.id::text, 1, 8)
  );
  INSERT INTO public.candidates (auth_user_id, handle)
  VALUES (NEW.id, v_handle)
  ON CONFLICT (auth_user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_for_vaultverify ON auth.users;
CREATE TRIGGER on_auth_user_created_for_vaultverify
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_vaultverify_candidate();

-- Backfill every existing Vaultio login. A row only enables future use;
-- it is owner-visible and carries no evidence or access by itself.
INSERT INTO public.candidates (auth_user_id, handle)
SELECT
  u.id,
  COALESCE(
    NULLIF(u.raw_user_meta_data ->> 'user_name', ''),
    NULLIF(u.raw_user_meta_data ->> 'full_name', ''),
    NULLIF(split_part(u.email, '@', 1), ''),
    'user-' || substr(u.id::text, 1, 8)
  )
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.candidates c WHERE c.auth_user_id = u.id);

-- --------------------------------------------------------------------------
-- 2. VaultVerify orgs mirror Vaultio organizations (shared UUIDs)
-- --------------------------------------------------------------------------

-- Orgs row can only exist for a real Vaultio organization. Deleting the
-- Vaultio org cascades: its VaultVerify shares and reports go with it.
ALTER TABLE public.orgs
  ADD CONSTRAINT orgs_id_matches_organizations
  FOREIGN KEY (id) REFERENCES public.organizations (id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.mirror_organization_to_vaultverify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.orgs (id, name)
  VALUES (NEW.id, NEW.name)
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mirror_organization_insert ON public.organizations;
CREATE TRIGGER mirror_organization_insert
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.mirror_organization_to_vaultverify();

DROP TRIGGER IF EXISTS mirror_organization_update ON public.organizations;
CREATE TRIGGER mirror_organization_update
  AFTER UPDATE OF name ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.mirror_organization_to_vaultverify();

-- Backfill existing organizations.
INSERT INTO public.orgs (id, name)
SELECT o.id, o.name FROM public.organizations o
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Viewer orgs: explicit VaultVerify membership UNION active Vaultio team
-- membership. "Active" = not deactivated; the team status domain is
-- Vaultio-owned and deliberately not interpreted here (see DECISIONS A27).
-- Per-item grants still gate every evidence row, so a recently invited
-- (not yet joined) member sees grant metadata at most, never content.
CREATE OR REPLACE FUNCTION public.viewer_org_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.org_id FROM public.org_members m WHERE m.user_id = auth.uid()
  UNION
  SELECT t.organization_id FROM public.team_members t
  WHERE t.user_id = auth.uid() AND t.deactivated_at IS NULL;
$$;

-- No new GRANTs: no new tables, triggers run as owner, and all Vaultio
-- reads happen inside SECURITY DEFINER helpers or under Vaultio's own RLS.
