-- Phase 2: append-only grant events, collector sessions, init-migration fixes.
--
-- 1. Q4: grants become append-only events (`grant_events`); the
--    `active_grants` view derives current state (latest event wins).
-- 2. Q6: per-session collector keys (`collector_sessions`); evidence links
--    to its signing session.
-- 3. Fixes to the init migration (found by review, see DECISIONS.md A16):
--    RLS policies alone grant nothing, so tables need explicit GRANTs; and
--    two policies mis-aliased set-function output (`AS eid` -> `AS u(eid)`).

-- --------------------------------------------------------------------------
-- Append-only grant events (Q4)
-- --------------------------------------------------------------------------

CREATE TABLE public.grant_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL,
  candidate_id uuid NOT NULL REFERENCES public.candidates (id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.orgs (id) ON DELETE CASCADE,
  role_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('issued', 'revoked')),
  evidence_item_ids uuid[],
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (event_type = 'issued' AND evidence_item_ids IS NOT NULL AND cardinality(evidence_item_ids) > 0)
    OR (event_type = 'revoked' AND evidence_item_ids IS NULL AND expires_at IS NULL)
  )
);
CREATE INDEX grant_events_grant_idx ON public.grant_events (grant_id, created_at);
CREATE INDEX grant_events_lookup_idx ON public.grant_events (candidate_id, org_id, role_id);

-- Current state derives from events: latest event per grant_id wins; the
-- grant is active iff that event is `issued` and unexpired.
CREATE VIEW public.active_grants AS
SELECT grant_id, candidate_id, org_id, role_id, evidence_item_ids, expires_at, created_at AS granted_at
FROM (
  SELECT DISTINCT ON (grant_id) *
  FROM public.grant_events
  ORDER BY grant_id, created_at DESC, id DESC
) latest
WHERE event_type = 'issued'
  AND (expires_at IS NULL OR expires_at > now());

ALTER TABLE public.grant_events ENABLE ROW LEVEL SECURITY;

-- Append-only: SELECT + INSERT policies only. No UPDATE/DELETE policies.
CREATE POLICY grant_events_owner_select ON public.grant_events
  FOR SELECT TO authenticated USING (public.is_candidate_owner(candidate_id));
CREATE POLICY grant_events_owner_insert ON public.grant_events
  FOR INSERT TO authenticated WITH CHECK (public.is_candidate_owner(candidate_id));
CREATE POLICY grant_events_org_select ON public.grant_events
  FOR SELECT TO authenticated USING (org_id IN (SELECT * FROM public.viewer_org_ids()));

-- --------------------------------------------------------------------------
-- Helpers now read derived state
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.viewer_granted_items(p_candidate_id uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT u.eid FROM public.active_grants g
  JOIN public.org_members m ON m.org_id = g.org_id,
  LATERAL unnest(g.evidence_item_ids) AS u(eid)
  WHERE m.user_id = auth.uid()
    AND g.candidate_id = p_candidate_id;
$$;

CREATE OR REPLACE FUNCTION public.viewer_granted_items_for_role(p_candidate_id uuid, p_role_id text)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT u.eid FROM public.active_grants g
  JOIN public.org_members m ON m.org_id = g.org_id,
  LATERAL unnest(g.evidence_item_ids) AS u(eid)
  WHERE m.user_id = auth.uid()
    AND g.candidate_id = p_candidate_id
    AND g.role_id = p_role_id;
$$;

CREATE OR REPLACE FUNCTION public.org_has_active_grant_for_candidate(p_candidate_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.active_grants g
    JOIN public.org_members m ON m.org_id = g.org_id
    WHERE m.user_id = auth.uid()
      AND g.candidate_id = p_candidate_id
  );
$$;

-- --------------------------------------------------------------------------
-- Fix set-function aliasing in the two per-item policies from the init
-- migration: a bare table alias (`AS eid`) does not name the output column
-- of a set-returning function; `AS u(eid)` does.
-- --------------------------------------------------------------------------

DROP POLICY IF EXISTS claims_org_select ON public.claims;
CREATE POLICY claims_org_select ON public.claims
  FOR SELECT TO authenticated
  USING (
    tombstoned_at IS NULL
    AND evidence_item_ids <@ COALESCE(
      (SELECT array_agg(u.eid) FROM public.viewer_granted_items_for_role(candidate_id, role_id) AS u(eid)),
      '{}'::uuid[]
    )
  );

DROP POLICY IF EXISTS screening_reports_org_select ON public.screening_reports;
CREATE POLICY screening_reports_org_select ON public.screening_reports
  FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT * FROM public.viewer_org_ids())
    AND evidence_item_ids <@ COALESCE(
      (SELECT array_agg(u.eid) FROM public.viewer_granted_items_for_role(candidate_id, role_id) AS u(eid)),
      '{}'::uuid[]
    )
  );

-- --------------------------------------------------------------------------
-- Retire the legacy grants table (superseded by grant_events)
-- --------------------------------------------------------------------------

DROP POLICY IF EXISTS grants_owner_select ON public.grants;
DROP POLICY IF EXISTS grants_owner_insert ON public.grants;
DROP POLICY IF EXISTS grants_owner_update ON public.grants;
DROP POLICY IF EXISTS grants_org_select ON public.grants;
DROP TRIGGER IF EXISTS grants_no_unrevoke ON public.grants;
DROP TABLE IF EXISTS public.grants;
DROP FUNCTION IF EXISTS public.prevent_grant_unrevoke();

-- --------------------------------------------------------------------------
-- Collector sessions (Q6): public keys registered at session start.
-- Private keys never leave the candidate machine; the server (anchor)
-- signing key lives in Supabase function secrets only.
-- --------------------------------------------------------------------------

CREATE TABLE public.collector_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.candidates (id) ON DELETE CASCADE,
  public_key text NOT NULL CHECK (public_key ~ '^[0-9a-f]{64}$'),
  registered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX collector_sessions_candidate_idx ON public.collector_sessions (candidate_id);

ALTER TABLE public.collector_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY collector_sessions_owner_select ON public.collector_sessions
  FOR SELECT TO authenticated USING (public.is_candidate_owner(candidate_id));
CREATE POLICY collector_sessions_owner_insert ON public.collector_sessions
  FOR INSERT TO authenticated WITH CHECK (public.is_candidate_owner(candidate_id));
CREATE POLICY collector_sessions_owner_update ON public.collector_sessions
  FOR UPDATE TO authenticated
  USING (public.is_candidate_owner(candidate_id))
  WITH CHECK (public.is_candidate_owner(candidate_id));
CREATE POLICY collector_sessions_org_select ON public.collector_sessions
  FOR SELECT TO authenticated
  USING (public.org_has_active_grant_for_candidate(candidate_id));

-- Evidence links to its signing session. NULL for L0/L1 items that predate
-- sessions or are unsigned.
ALTER TABLE public.evidence_items
  ADD COLUMN session_id uuid REFERENCES public.collector_sessions (id) ON DELETE SET NULL;

-- Session binding is immutable once written (re-keying requires re-issue).
CREATE OR REPLACE FUNCTION public.prevent_chain_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.tier IS DISTINCT FROM OLD.tier
    OR NEW.collector_id IS DISTINCT FROM OLD.collector_id
    OR NEW.session_id IS DISTINCT FROM OLD.session_id
    OR NEW.seq IS DISTINCT FROM OLD.seq
    OR NEW.prev_hash IS DISTINCT FROM OLD.prev_hash
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.hash IS DISTINCT FROM OLD.hash
    OR NEW.sig IS DISTINCT FROM OLD.sig
    OR NEW.collected_at IS DISTINCT FROM OLD.collected_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'evidence chain fields are immutable (item %)', OLD.id;
  END IF;
  IF array_position(ARRAY['L0', 'L1', 'L2', 'L3', 'L4'], NEW.verification_level)
     < array_position(ARRAY['L0', 'L1', 'L2', 'L3', 'L4'], OLD.verification_level) THEN
    RAISE EXCEPTION 'verification level cannot be downgraded (item %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

-- --------------------------------------------------------------------------
-- Init-migration fix: RLS policies filter rows but grant no privileges.
-- Every table needs explicit GRANTs (and every future migration must carry
-- its own). Still no DELETE for `authenticated` anywhere: tombstones only.
-- --------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON public.candidates TO authenticated;
GRANT SELECT ON public.orgs TO authenticated;
GRANT SELECT ON public.org_members TO authenticated;
GRANT SELECT ON public.role_rubrics TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.evidence_items TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.anchors TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.claims TO authenticated;
GRANT SELECT, INSERT ON public.grant_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.collector_sessions TO authenticated;
GRANT SELECT ON public.screening_reports TO authenticated;
GRANT SELECT ON public.active_grants TO authenticated;

-- The backend key needs full access (report builder, rubric publishing,
-- provisioning). Idempotent: safe to re-run.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
