# Decisions

Phase 1 assumptions, Phase 2 resolutions (Q1–Q7), new assumptions, and open
questions. Collectors, scoring, and real UI screens are still not built.

## Phase 2 resolutions

- Q1. **Secrets**: project created by the owner; project ref is read from
  the linked Supabase config at apply time, never stored in the repo.
  Keys via gitignored `.env` locally and function secrets server-side
  (see `.env.example`). Pre-commit secret check added
  (`scripts/check-secrets.mjs` + `.husky/pre-commit`, wired via
  `npm run check:secrets` and the `prepare` script). NOTE: the Supabase
  CLI here is not logged in, so `supabase login` + `supabase link` and
  the first `supabase db push` remain owner steps.
- Q2. **Crypto**: confirmed as spec `vv-crypto-1` — RFC 8785 (JCS) via the
  `canonicalize` library, sha256, ed25519 (`node:crypto`), lowercase hex,
  spec tag embedded in domain-separation prefixes
  (`vv-crypto-1:event|anchor|report`). Executable in
  `packages/core/src/crypto.node.ts` (`@vault-verify/core/node` entrypoint;
  universal entrypoint stays browser-safe).
- Q3. **Surfaces**: report UI first — `apps/report` rescaffolded as
  Vite + React + Tailwind (shell only). MCP server is a thin stretch goal.
- Q4. **Grants are append-only events** (`grant_events`: `issued`/`revoked`
  per `grant_id`); `active_grants` view derives state (latest event wins).
  The Phase 1 `grants` table is retired in migration 2.
- Q5. **First rubric drafted**: `software-engineer-ai` v1 in
  `supabase/seed.sql` — 5 heuristic criteria with visible weights summing
  to 1.0, each mapped to an observable signal. Owner to edit.
- Q6. **Session keys**: per-session ed25519 keypair generated locally;
  private key never leaves the candidate machine; public key registered in
  `collector_sessions` at session start; evidence links via `session_id`;
  server (anchor) key lives in function secrets only.
- Q7. **npm workspaces** confirmed.

## Integration resolutions (2026-10-28)

VaultVerify is a Vaultio product: one login, shared context, no second
account (same project = same `auth.users` by construction).

- I1. **Visible Vaultio data**: identity + hiring context — profiles,
  verified profiles, assessment history, CV data readable by the report
  surfaces under Vaultio's own RLS (no schema change; app-level queries).
- I2. **Org access derives from Vaultio teams**: VaultVerify orgs mirror
  Vaultio organizations (shared UUIDs); viewer rights = explicit VaultVerify
  membership UNION active (non-deactivated) team membership.
- I3. **Candidates auto-provision**: trigger on new auth users + backfill
  of existing logins (270 rows). A row enables future use only.
- I4. **Talent context linkage**: `talent_context` view (security_invoker)
  joins profiles, CV, verified profile, online presence, and GitHub analysis
  per candidate, latest-row-wins. Excluded always: `candidate_github_credentials`,
  `linkedin_oauth_token`, OAuth PII mirrors, billing/wallet/referral
  columns, internal fetch logs.

## Assumptions

- A1. Package manager is **npm with workspaces** (`packages/*`, `apps/*`).
- A2. `packages/core` pins **zod v3** (`^3.23.8`) and TypeScript `^5.5.0`.
  Single signature scheme (**ed25519**, lowercase hex); algorithm agility
  deferred.
- A3. Workspace packages expose **`src/` directly** (`main`/`types` point at
  `src/index.ts`). No build step yet; dist builds + project references come
  with the first implementation.
- A4. **One hash chain per candidate** (`UNIQUE (candidate_id, seq)`,
  genesis `prevHash` = 64 zeros). Cross-candidate anchoring is future work.
- A5. **The harness signs; adapters emit unsigned events only** (see
  `UnsignedEvent` / `EvidenceAdapter`). Chain integrity never depends on
  adapter code.
- A6. Payloads are **inline `jsonb`** for now. Large artifacts will use
  `{ uri, sha256 }` pointers once Supabase Storage + storage RLS land.
- A7. SUPERSEDED by Q4 (grants were mutable rows in Phase 1; now
  append-only events).
- A8. Claims and reports require **full item coverage plus role match**: an
  org sees a claim/report only when active grants for that role cover every
  cited item. Report `claim_ids` ride along as ids; claim bodies stay gated
  by the claims policy.
- A9. Anchors (and now sessions) are visible at **candidate level** to orgs
  with any active grant (they commit to chain shape/keys, not payloads).
- A10. Rubric publishing, org provisioning, and report building are
  **service-role only**. No self-serve flows exist yet.
- A11. Migrations are **forward-only** (no down). The Supabase CLI is the
  apply path; no migration has been applied yet.
- A12. Scaffold layout: `packages/adapter-*`, `packages/mcp-server`,
  `apps/report`, root-level `tasks/`.
- A13. SUPERSEDED by A22 (Phase 1 verification status).
- A14. Timestamps prefer UTC (offsets accepted); rubric weights are relative
  and normalized at scoring time.
- A15. A candidate's handle is visible to orgs holding an active grant from
  them (required to render reports).
- A16. Migration 2 fixes two Phase 1 defects found by review: (a) tables
  had RLS policies but no `GRANT`s to `authenticated` — policies filter
  rows but confer no privileges, so every read/write would have failed
  with permission denied; (b) two policies mis-aliased set-function output
  (`AS eid` instead of `AS u(eid)`). Rule going forward: every migration
  carries its own `GRANT`s.
- A17. `canonicalize@^2` is assumed to ship its own TypeScript types (see
  Q12 for the fallback).
- A18. New dependency floors (React 19, Vite 6, Tailwind v4,
  `@vitejs/plugin-react` 4, husky 9, `@types/node` 20) are safe floors, not
  pinned currents; `npm install` on a provisioned machine confirms.
- A19. `esModuleInterop` is enabled in the base tsconfig for CJS/ESM
  interop (needed for default-importing CJS libraries).
- A20. Grant-stream semantics: latest event per `grant_id` wins
  (`DISTINCT ON`, ordered by `created_at`, `id`); re-issue after revoke is
  allowed and reactivates the stream if unexpired.
- A21. `evidence.session_id` is nullable (L0/L1 unsigned items predate
  sessions); once set, the session binding is immutable.
- A22. **Still unverified**: no Node.js or Postgres on this machine, so
  `npm install`, `tsc`, the secret-check run, migration apply, and seeding
  are all pending a provisioned machine (or owner steps).
- A23. Supabase link state is user-local (`supabase login` + `supabase
  link`); the project ref is read from the linked config, never from repo
  files or chat.
- A24. Co-located in the Vaultio Supabase project (owner decision
  2026-10-28; supersedes the dedicated-project constraint): 11 pre-existing
  remote migrations marked reverted in history (their tables/data untouched),
  ledger migrations applied and verified live (10 tables + view, RLS on,
  rubric seeded). Ledger table names verified collision-free.
- A25. Vaultio tables keep their own RLS, which this project never weakens;
  context reads ride on Vaultio's self/participant policies. Additive
  triggers only (one on auth.users, two on organizations).
- A26. VaultVerify org rows mirror organizations 1:1 (FK on shared id);
  deleting a Vaultio org cascades to its VaultVerify shares/reports.
- A27. Team "active" = deactivated_at IS NULL (status domain is
  Vaultio-owned and not interpreted). Per-item grants still gate every
  evidence row, so this edge leaks grant metadata at most.
- A28. `talent_context` MUST keep `security_invoker = true`: a default view
  owned by postgres would bypass Vaultio RLS. Our candidates RLS gates the
  row; Vaultio RLS gates each context group. The service-role report builder
  bypasses RLS and MUST therefore honor share flags itself
  (shared_with_recruiters, is_public, show_*).
- A29. `candidate_github_analysis` has RLS on with zero Vaultio policies, so
  it resolves NULL for interactive roles (service-side only). Live GitHub
  context flows via `candidate_online_presence`. Vaultio can add a self-read
  policy there if candidates should see it in-app; this project will not
  modify Vaultio RLS.

## Ledger + Tier 1 harness phase (user's Phase 2)

Implemented and tested: executable ledger crypto, verifyChain/verifySession,
anchor edge function (deployed), Tier 1 harness CLI, 53 vitest tests green.

- A30. Hash construction reconciles the phase formula with Q2: sha256hex of
  `vv-crypto-1:event` LF seq LF prevHash LF JCS(payload). The domain prefix
  stands; JCS covers the payload per the formula. No chains existed, so the
  construction change from the earlier scaffold breaks nothing.
- A31. Genesis prevHash derives from the server-issued session nonce (sha256
  under `vv-crypto-1:session`). GENESIS_PREV_HASH (64 zeros) remains only as
  the verifyChain default for sessionless/legacy checks.
- A32. verifySession returns L0/L3/L4 only; L1/L2 are collection-time
  attributions the harness stamps (L2 at upload), since verification inputs
  cannot retroactively establish provenance.
- A33. Strict anchors: L4 needs >=1 valid matching anchor AND zero invalid
  ones; any forged/mismatched anchor caps at L3 with its reason. Harness
  observations need full seq coverage, else L3.
- A34. Anchor routes take a user JWT (ownership-checked); no anonymous
  session creation; seq strictly increasing per session. Request signing by
  session key deferred: both secrets live on the same machine, so it adds
  no threat-model value today.
- A35. Harness: templates are user-provided dirs with vaultverify.json (no
  sample shipped); snapshots debounced on change via a detached recorder;
  test counts best-effort per runner (null when unknown); `test` records
  even on failure and propagates the exit code; finish self-verifies,
  anchors best-effort, uploads fatally (PostgREST upsert, deterministic
  row ids); L2 stamped at collection, promotion deferred.
- A36. Server anchor key generated into function secrets (value never
  logged); rotation procedure still open (old pubkey must be retained for
  old anchors); anchor public key distribution deferred to the builder phase.
- A37. Toolchain: portable Node under .tools/ (gitignored); core+harness
  build to dist (NodeNext ESM, .js extensions enforced); single Vite 7
  across vitest+report; `canonicalize` required explicitly (CJS without
  ESM-typed default).
- A38. Live edge invocation with a real user JWT remains untested (no JWT
  exists outside the Vaultio login flow); handler logic is unit-tested with
  fakes plus core interop tests, and unauthenticated calls verified 401
  against the deployed function.

## Open questions

- Q8. (Still open.) **L1 mechanics**: what exactly counts as "linked" proof
  for a connected repo? Affects the harness spec.
- Q9. **Auth method** for candidate/org login (Supabase Auth: magic link?
  GitHub OAuth? both?) — needed before UI auth screens.
- Q10. **Anchor checkpoint construction**: spec the `vv-crypto-1:anchor`
  struct (hash over what, exactly?) — needed before the anchor service.
- Q11. **Session/key lifecycle**: session expiry duration, rotation UX,
  server-key storage/rotation procedure, compromise cutoff.
- Q12. Confirm `canonicalize` v2 ships types at install; fallback is a
  local `d.ts` (or v1) — 5-minute fix, flagged here so it is not a mystery.

## Deferred items

Everything in `tasks/backlog.md`: Tier 1 collectors, harness chaining,
anchor service, session lifecycle, Tier 2 adapters, claim builder, scoring
engine, report builder + screens, MCP server, Storage integration,
hardening. Scoring still needs rubric + fairness review before any code.
