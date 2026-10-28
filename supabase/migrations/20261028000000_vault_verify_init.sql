-- vault-verify initial schema: tamper-evident evidence ledger.
--
-- Design rules enforced here:
-- 1. Candidates own their evidence. Orgs see a row only through an active,
--    revocable, per-item grant tied to a role (see ARCHITECTURE.md layer 4).
-- 2. No hard deletes. Tombstone columns + NO delete policies (deletes fail
--    closed) + triggers blocking tombstone/revocation removal.
-- 3. Chain fields are immutable after insert; verification levels promote one way.
-- 4. All cross-table RLS checks go through SECURITY DEFINER helpers so
--    policies can never recurse into each other.
-- 5. service_role bypasses RLS (report builder, rubric publishing, provisioning).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- --------------------------------------------------------------------------
-- Tables
-- --------------------------------------------------------------------------

CREATE TABLE public.candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  handle text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.org_members (
  org_id uuid NOT NULL REFERENCES public.orgs (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  member_role text NOT NULL DEFAULT 'viewer',
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX org_members_user_idx ON public.org_members (user_id);

-- Fixed rubric templates per role. (role_id, version) is immutable once
-- published; changes ship as a new version. Writes are service-role only
-- (no write policies below).
CREATE TABLE public.role_rubrics (
  role_id text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  title text NOT NULL,
  criteria jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, version)
);

-- One row = one SignedEvent link in the candidate's hash chain, flattened.
CREATE TABLE public.evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.candidates (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('repo_snapshot', 'test_run', 'prompt_transcript', 'tool_calls', 'self_report')),
  tier smallint NOT NULL CHECK (tier IN (0, 1, 2)),
  verification_level text NOT NULL CHECK (verification_level IN ('L0', 'L1', 'L2', 'L3', 'L4')),
  collector_id text NOT NULL,
  seq bigint NOT NULL CHECK (seq >= 0),
  prev_hash text NOT NULL,
  payload jsonb NOT NULL,
  hash text NOT NULL,
  sig text NOT NULL,
  summary text,
  collected_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  tombstoned_at timestamptz,
  tombstone_reason text,
  UNIQUE (candidate_id, seq)
);

CREATE TABLE public.anchors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.candidates (id) ON DELETE CASCADE,
  from_seq bigint NOT NULL CHECK (from_seq >= 0),
  to_seq bigint NOT NULL CHECK (to_seq >= from_seq),
  anchor_hash text NOT NULL,
  nonce text NOT NULL,
  issuer text NOT NULL,
  signature text NOT NULL,
  anchored_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX anchors_candidate_idx ON public.anchors (candidate_id, to_seq);

CREATE TABLE public.claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.candidates (id) ON DELETE CASCADE,
  role_id text NOT NULL,
  rubric_version integer NOT NULL,
  criterion_id text NOT NULL,
  statement text NOT NULL,
  evidence_item_ids uuid[] NOT NULL CHECK (cardinality(evidence_item_ids) > 0),
  verification_level text NOT NULL CHECK (verification_level IN ('L0', 'L1', 'L2', 'L3', 'L4')),
  created_at timestamptz NOT NULL DEFAULT now(),
  tombstoned_at timestamptz,
  FOREIGN KEY (role_id, rubric_version) REFERENCES public.role_rubrics (role_id, version)
);
CREATE INDEX claims_candidate_idx ON public.claims (candidate_id);

CREATE TABLE public.grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.candidates (id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.orgs (id) ON DELETE CASCADE,
  role_id text NOT NULL,
  evidence_item_ids uuid[] NOT NULL CHECK (cardinality(evidence_item_ids) > 0),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX grants_lookup_idx ON public.grants (candidate_id, org_id, role_id)
  WHERE revoked_at IS NULL;

-- Written by the service-role report builder only (no write policies below).
CREATE TABLE public.screening_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.candidates (id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.orgs (id) ON DELETE CASCADE,
  role_id text NOT NULL,
  rubric_version integer NOT NULL,
  claim_ids uuid[] NOT NULL DEFAULT '{}',
  evidence_item_ids uuid[] NOT NULL DEFAULT '{}',
  verification_summary jsonb NOT NULL,
  generator text NOT NULL,
  report_hash text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (role_id, rubric_version) REFERENCES public.role_rubrics (role_id, version)
);
CREATE INDEX screening_reports_lookup_idx ON public.screening_reports (candidate_id, org_id);

-- --------------------------------------------------------------------------
-- RLS helper functions (SECURITY DEFINER: bypass RLS, no policy recursion)
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_candidate_owner(p_candidate_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.candidates c
    WHERE c.id = p_candidate_id AND c.auth_user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.viewer_org_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.org_id FROM public.org_members m WHERE m.user_id = auth.uid();
$$;

-- Item ids covered by ACTIVE grants (not revoked, not expired) from the
-- candidate to any org the viewer belongs to. Any role.
CREATE OR REPLACE FUNCTION public.viewer_granted_items(p_candidate_id uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT eid FROM public.grants g
  JOIN public.org_members m ON m.org_id = g.org_id,
  LATERAL unnest(g.evidence_item_ids) AS eid
  WHERE m.user_id = auth.uid()
    AND g.candidate_id = p_candidate_id
    AND g.revoked_at IS NULL
    AND (g.expires_at IS NULL OR g.expires_at > now());
$$;

-- Same, restricted to grants tied to one role.
CREATE OR REPLACE FUNCTION public.viewer_granted_items_for_role(p_candidate_id uuid, p_role_id text)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT eid FROM public.grants g
  JOIN public.org_members m ON m.org_id = g.org_id,
  LATERAL unnest(g.evidence_item_ids) AS eid
  WHERE m.user_id = auth.uid()
    AND g.candidate_id = p_candidate_id
    AND g.role_id = p_role_id
    AND g.revoked_at IS NULL
    AND (g.expires_at IS NULL OR g.expires_at > now());
$$;

CREATE OR REPLACE FUNCTION public.org_has_active_grant_for_candidate(p_candidate_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.grants g
    JOIN public.org_members m ON m.org_id = g.org_id
    WHERE m.user_id = auth.uid()
      AND g.candidate_id = p_candidate_id
      AND g.revoked_at IS NULL
      AND (g.expires_at IS NULL OR g.expires_at > now())
  );
$$;

-- --------------------------------------------------------------------------
-- Integrity triggers
-- --------------------------------------------------------------------------

-- Revocation is append-only: revoked_at can be set, never cleared.
CREATE OR REPLACE FUNCTION public.prevent_grant_unrevoke()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'grants cannot be un-revoked (grant %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER grants_no_unrevoke
  BEFORE UPDATE ON public.grants
  FOR EACH ROW EXECUTE FUNCTION public.prevent_grant_unrevoke();

-- Tombstones are append-only: tombstoned_at can be set, never cleared.
CREATE OR REPLACE FUNCTION public.prevent_untombstone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.tombstoned_at IS NOT NULL AND NEW.tombstoned_at IS NULL THEN
    RAISE EXCEPTION 'tombstone cannot be cleared (% %)', TG_TABLE_NAME, OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_items_no_untombstone
  BEFORE UPDATE ON public.evidence_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_untombstone();

CREATE TRIGGER claims_no_untombstone
  BEFORE UPDATE ON public.claims
  FOR EACH ROW EXECUTE FUNCTION public.prevent_untombstone();

-- Chain fields are immutable; only level promotion, summary, and tombstone
-- columns may change after insert.
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

CREATE TRIGGER evidence_items_no_chain_mutation
  BEFORE UPDATE ON public.evidence_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_chain_mutation();

-- --------------------------------------------------------------------------
-- Row Level Security
-- --------------------------------------------------------------------------

ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_rubrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screening_reports ENABLE ROW LEVEL SECURITY;

-- NOTE: policies are per-operation on purpose. FOR ALL would silently grant
-- DELETE; there must be no DELETE policy on any table (tombstones instead).

-- candidates: owner manages own row; org members see only candidates who
-- granted them something.
CREATE POLICY candidates_owner_select ON public.candidates
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());
CREATE POLICY candidates_owner_insert ON public.candidates
  FOR INSERT TO authenticated WITH CHECK (auth_user_id = auth.uid());
CREATE POLICY candidates_owner_update ON public.candidates
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid()) WITH CHECK (auth_user_id = auth.uid());
CREATE POLICY candidates_org_select ON public.candidates
  FOR SELECT TO authenticated
  USING (public.org_has_active_grant_for_candidate(id));

-- orgs / org_members: readable by members; provisioning is service-role only.
CREATE POLICY orgs_member_select ON public.orgs
  FOR SELECT TO authenticated USING (id IN (SELECT * FROM public.viewer_org_ids()));
CREATE POLICY org_members_member_select ON public.org_members
  FOR SELECT TO authenticated USING (org_id IN (SELECT * FROM public.viewer_org_ids()));

-- role_rubrics: readable by all authenticated users; publishing is
-- service-role only (migrations or admin tooling).
CREATE POLICY role_rubrics_read ON public.role_rubrics
  FOR SELECT TO authenticated USING (true);

-- evidence_items: owner full row access (no delete); org members see an item
-- only if an active grant to their org covers that exact item id.
-- Tombstoned items are invisible to orgs.
CREATE POLICY evidence_items_owner_select ON public.evidence_items
  FOR SELECT TO authenticated USING (public.is_candidate_owner(candidate_id));
CREATE POLICY evidence_items_owner_insert ON public.evidence_items
  FOR INSERT TO authenticated WITH CHECK (public.is_candidate_owner(candidate_id));
CREATE POLICY evidence_items_owner_update ON public.evidence_items
  FOR UPDATE TO authenticated
  USING (public.is_candidate_owner(candidate_id))
  WITH CHECK (public.is_candidate_owner(candidate_id));
CREATE POLICY evidence_items_org_select ON public.evidence_items
  FOR SELECT TO authenticated
  USING (
    tombstoned_at IS NULL
    AND id IN (SELECT * FROM public.viewer_granted_items(candidate_id))
  );

-- anchors: owner access; org read at candidate level (anchors commit to
-- chain shape, not payload content — see DECISIONS.md A9).
CREATE POLICY anchors_owner_select ON public.anchors
  FOR SELECT TO authenticated USING (public.is_candidate_owner(candidate_id));
CREATE POLICY anchors_owner_insert ON public.anchors
  FOR INSERT TO authenticated WITH CHECK (public.is_candidate_owner(candidate_id));
CREATE POLICY anchors_owner_update ON public.anchors
  FOR UPDATE TO authenticated
  USING (public.is_candidate_owner(candidate_id))
  WITH CHECK (public.is_candidate_owner(candidate_id));
CREATE POLICY anchors_org_select ON public.anchors
  FOR SELECT TO authenticated
  USING (public.org_has_active_grant_for_candidate(candidate_id));

-- claims: owner access; org read requires the claim's role to match a grant
-- role AND every cited item to be covered by that role's active grants.
CREATE POLICY claims_owner_select ON public.claims
  FOR SELECT TO authenticated USING (public.is_candidate_owner(candidate_id));
CREATE POLICY claims_owner_insert ON public.claims
  FOR INSERT TO authenticated WITH CHECK (public.is_candidate_owner(candidate_id));
CREATE POLICY claims_owner_update ON public.claims
  FOR UPDATE TO authenticated
  USING (public.is_candidate_owner(candidate_id))
  WITH CHECK (public.is_candidate_owner(candidate_id));
CREATE POLICY claims_org_select ON public.claims
  FOR SELECT TO authenticated
  USING (
    tombstoned_at IS NULL
    AND evidence_item_ids <@ COALESCE(
      (SELECT array_agg(eid) FROM public.viewer_granted_items_for_role(candidate_id, role_id) AS eid),
      '{}'::uuid[]
    )
  );

-- grants: candidate manages own grants; org members read grants made to them.
-- No delete: revocation sets revoked_at and stays auditable.
CREATE POLICY grants_owner_select ON public.grants
  FOR SELECT TO authenticated USING (public.is_candidate_owner(candidate_id));
CREATE POLICY grants_owner_insert ON public.grants
  FOR INSERT TO authenticated WITH CHECK (public.is_candidate_owner(candidate_id));
CREATE POLICY grants_owner_update ON public.grants
  FOR UPDATE TO authenticated
  USING (public.is_candidate_owner(candidate_id))
  WITH CHECK (public.is_candidate_owner(candidate_id));
CREATE POLICY grants_org_select ON public.grants
  FOR SELECT TO authenticated USING (org_id IN (SELECT * FROM public.viewer_org_ids()));

-- screening_reports: candidate reads own; org members read reports for their
-- org only when every cited item is covered by that role's active grants.
-- (Claim id lists ride along; claim bodies stay gated by the claims policy.)
CREATE POLICY screening_reports_owner_select ON public.screening_reports
  FOR SELECT TO authenticated USING (public.is_candidate_owner(candidate_id));
CREATE POLICY screening_reports_org_select ON public.screening_reports
  FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT * FROM public.viewer_org_ids())
    AND evidence_item_ids <@ COALESCE(
      (SELECT array_agg(eid) FROM public.viewer_granted_items_for_role(candidate_id, role_id) AS eid),
      '{}'::uuid[]
    )
  );
