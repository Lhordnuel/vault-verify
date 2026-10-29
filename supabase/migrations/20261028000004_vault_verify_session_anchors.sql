-- Ledger + Tier 1 phase: session nonces + anchor session linkage.
--
-- collector_sessions.nonce: server-issued session nonce (the chain genesis
-- prevHash derives from it via vv-crypto-1:session).
-- anchors.session_id: anchors checkpoint one session head each; seq
-- monotonicity per session is enforced by the anchor edge function.
--
-- Both tables are empty at apply time (no sessions/anchors exist yet), so
-- NOT NULL is safe and fail-loud otherwise.

ALTER TABLE public.collector_sessions
  ADD COLUMN nonce text NOT NULL CHECK (nonce ~ '^[0-9a-f]{32}$');

ALTER TABLE public.anchors
  ADD COLUMN session_id uuid NOT NULL REFERENCES public.collector_sessions (id) ON DELETE CASCADE;

CREATE INDEX anchors_session_idx ON public.anchors (session_id, to_seq DESC);

-- No new tables: no new GRANTs. Existing anchors/collector_sessions
-- policies and GRANTs cover the new columns.
