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
- A39. **Rubric source: no owner edits were found.** Phase 4 asked for the
  criteria "edited in docs/DECISIONS.md", but git history holds only agent
  commits, the tree was clean, `supabase/seed.sql` is still the verbatim v1
  draft, and DECISIONS.md only references it. The code template
  (`packages/core/src/rubric.ts`) is therefore a verbatim copy of the seed
  v1 id/description/weight/evidenceKinds plus added labels and signal
  wiring. Owner: review the template (and the seed) and say what to change;
  template changes ship as rubric v2.
- A40. Criterion-to-signal wiring (v1): task-decomposition reads
  recovery-cost + revert-count (+ judge); test-driven-iteration reads
  test-follow-share + edit-test-latency; change-quality reads revert-count
  + test-follow-share; verification-discipline adds hidden-test-outcome;
  oversight-recovery reads recovery-cost + revert-count.
- A41. Tier 1 signal proxies (adapters change these): recovery-cost counts
  edit batches between failure and next pass (prompt counts need Tier 2
  transcripts); revert-count flags snapshots with deletions > insertions;
  the final-diff checkpoint counts as a diff review for test-follow-share.
- A42. Judge design: aspects are instruction-quality and decomposition;
  both feed task-decomposition only (prompting behavior); all other v1
  criteria are deterministic-only. The judge sees redacted derived events
  (counts/timings, `redactForJudge`); uncited, miscited, wrong-criterion,
  malformed, or throwing verdicts are discarded and counted, never fatal.
  The input verification verdict is echoed untouched.
- A43. Confidence caps by level (heuristic): L0 0, L1 0.4, L2 0.6, L3 0.8,
  L4 1.0 (`LEVEL_CONFIDENCE_CAP`). Scoring refuses L0 input outright
  (`UnverifiableSessionError`): signals are computed only from verified
  events. Criteria with no applicable signal score null (confidence 0) and
  are excluded from the weight-renormalized overall.
- A44. `FluencyReport` (new, core scoring contracts) is the session-level
  scoring output; the grant-based claims `ScreeningReport` keeps its writer
  (deferred service-role report builder), which will attach fluency scores
  later. Citations are session-scoped `seq:<n>` refs.
- A45. The browser verifier (`@vault-verify/core/web`, @noble/*) is a
  byte-for-byte twin of the node verifier: same constructions, same reason
  strings, parity-tested; it skips the constant-time hash compare
  (node-only hardening, same boolean outcome).
- A46. Report fixtures are generated with real signatures by the committed
  `packages/scoring/scripts/generate-fixtures.mjs` (public keys only, no
  secrets); the tampered sample fails `chain_break:hash_mismatch@seq:2`.
  The portable session-log format is `vv-session-log/1`
  (facts + events + anchors).
- A47. **No sample agent log existed in the repo**, so Phase 5A authored
  the sanitized `packages/harness/fixtures/sample-agent-log.jsonl`
  (`vv-agent-log/1`) and built the parser FROM its field names (envelope
  v/ts/event; edit files[]/summary; test passed/failed; prompt/note text).
  Real agent formats register as new parsers; the golden test pins the
  sample's digest + normalized events.
- A48. Tier 1 proxies retired (supersedes A41's measurement use):
  `revert-count` always returns null, and the final-diff checkpoint no
  longer counts as a review in `test-follow-share`. Fixture overall moved
  0.6631 -> 0.6815 on regeneration.
- A49. Uplift math (all invariant-tested): per-skill
  weight * level-strength * min(1, n/3), normalized by template weight;
  level strengths L0 0 / L1 .25 / L2 .5 / L3 .75 / L4 1. Only max-level and
  evidence-count feed the math — heuristic scores, fluency score, and
  flags are ignored — so adding evidence can never lower the result.
  must/nice is a reporting label (missing skills contribute zero, never
  subtract). Defaults: range 100, cap 15% of range; uplift also capped by
  scale headroom. Baselines on a 0..1 scale must pass range 1.
- A50. Retroactive sessions: `provenance` on HarnessFacts (absent = live,
  back-compat); both verifiers cap valid retroactive chains at L2 with
  reason `retroactive_provenance_cap` (anchors not consulted); the
  "anchor at import time" is a LOCAL self-signed attestation, never
  presented as a server anchor. Duplicates rejected by content digest;
  timestamp disorder flagged, not rejected; repo-history corroboration is
  a note (60min window), never a level change. The importer has no
  network/upload path at all: the raw log never leaves the machine, and
  imported evidence has no upload wiring yet.
- A51. **No live database work in Phase 5A** (DATABASE SAFETY): "schema"
  means core contracts. Still needing migrations (staging first): the
  `evidence_items.kind` CHECK gaining 'attempt', plus role_templates,
  test_definitions, attempts, share_links, and share view-log tables.
  `EvidenceLibrary` is the in-memory reference for no-cascade delete
  semantics (roles/screenings/reports hold id references only).
- A52. Skill slugs (`typescript-node`, ...) are ours until the Vaultio
  skill taxonomy is mapped. `TestDefinition.seedParameters` maps
  parameter name -> option count; `deriveAttemptParams` hashes
  (nonce, test, attempt) under `vv-crypto-1:attempt` and picks
  byte % count per name (names sorted for determinism).
- A53. Share links are contract + pure helpers only (generate/hash/
  active-check/append-only view log); creation, storage, and revocation
  endpoints are deferred to the service layer. Tokens are shown once;
  only the hash is stored.
- A54. Secret-shaped test material is built from runtime fragments so
  committed files never trip the pre-commit scanner; the redactor is
  idempotent by construction (redacted output never re-matches) and
  that property is tested.
- A55. **fixtures/real/ does not exist.** Searched the repo, Desktop,
  Downloads, and Documents: no sanitized real log was provided. Phase
  5A.2 item 1 is therefore staged, not finished: the parser registry
  is injectable, unmapped-field reporting is plumbed (parser ->
  ImportResult -> import.json -> CLI), and vv-agent-log/1 is demoted
  to test-only (out of PARSER_REGISTRY, which is empty until the
  first real format lands). Drop the log at
  `packages/harness/fixtures/real/` and the real parser + golden +
  unmapped-field report follow. v1's own unmapped fields (proving
  the machinery): `command`, `exit_code`, `output_tail`,
  `files[].path`.
- A56. Retroactive verification tiers (both twins, reason-listed):
  valid chain + matching server countersignature -> L2
  (`anchors_match:N`, `retroactive_anchored_cap`); valid chain with
  no/bad anchors -> L1 with the specific anchor reason plus
  `retroactive_unanchored_cap`; broken chain -> L0 as before. L1
  here stretches "linked" to mean "digest-bound import record
  exists" — report-badge copy will need a pass when UI work resumes.
- A57. Anchored-at-import mode: with --token/VAULTVERIFY_JWT plus an
  anchor URL, the importer opens a real server session (server nonce
  + session id + candidate id), seals the chain on it, and stores
  the server countersignature; failures fail closed (partial dir
  removed, nothing recorded). Without credentials the import stays
  fully offline with a self-signed attestation (L1 track) and a
  note saying so. The stub-anchored online path is test-covered;
  the live server path is not (same JWT limitation as A38).
- A58. Uplift rework: per skill only the BEST item counts —
  weight * quality(best) * level-strength(best.level) — times
  distinct-source saturation min(1, sessions/3). Best = argmax of
  the product (first wins ties). Item quality heuristic: test-run
  pass rate (0 when no tests ran), 0.5 neutral edits (Tier 1
  cannot assess edit quality), 0.25 notes. SkillClaim carries
  `best` explicitly. Fluency keeps cite-count saturation (its
  cites live in one session). All invariants re-tested, plus
  bad-vs-good session at equal level and 1-source-vs-3-sources.
- A59. **fixtures/real/ still absent** (re-searched in 5A.3; the
  Downloads `seed-to-vault...build.log` is a deployment build log,
  not an agent transcript). Item 1 stays staged per A55: drop the
  sanitized real log at `packages/harness/fixtures/real/` to
  unblock the production parser, golden, and unmapped report.
- A60. Quality heuristic rework (supersedes A58's pass rate): test
  quality is session-level — final outcome sets the base (pass
  0.8, fail 0.2), a fail-to-pass recovery adds 0.2 up to 1.0, and
  no test runs stays neutral at 0.5. All test items in a session
  share its quality; edits stay 0.5, notes 0.25. Monotonicity now
  rests on session immutability: sessions are sealed units, so
  evidence grows by ADDING sessions (best-product and source
  count only grow); appending records inside an open session can
  change that session's quality. Tested: recovery >= no-tests,
  plus all prior invariants.

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

Ledger, Tier 1 harness, anchor service, session-level heuristic scoring
(`packages/scoring`), fixture-driven report screens, the evidence model +
uplift, and the retroactive importer are built. Still deferred (see
`tasks/backlog.md`): session/key lifecycle, Tier 2 adapters, claim
builder, service-role report builder (grant-based org reports), Phase 5A
DB migrations, share-link endpoints, import upload wiring, MCP server,
Storage integration, hardening. Scores stay heuristic until the rubric +
fairness review; the owner still has to review the v1 criteria.
