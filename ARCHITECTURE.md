# vault-verify — Architecture

A tamper-evident evidence ledger for assessing how candidates work with AI
coding agents. Candidates collect verifiable evidence of their agent-assisted
work; orgs see only what candidates explicitly grant them, scored against
fixed per-role rubrics.

Status: Phase 2 applied (decisions Q1–Q7 in `docs/DECISIONS.md`). Crypto,
sessions, and grant events are live contracts; collectors, anchor service,
scoring, and real UI screens are still deferred (see `tasks/backlog.md`).

## The five layers

### 1. Ledger (`packages/core`, `supabase/migrations`)

The source of truth. Every evidence item is a link in a per-candidate
hash chain:

- `SignedEvent { seq, prevHash, payload, hash, sig }` — the chain link.
- Crypto spec `vv-crypto-1` (Q2): RFC 8785 (JCS) canonicalization via the
  `canonicalize` library, sha256, ed25519 (`node:crypto`), lowercase hex.
  Hash input is domain-separated: `vv-crypto-1:event` + LF + JCS struct
  (anchor/report domains reserved). Executable form lives in
  `@vault-verify/core/node`; the universal entrypoint stays browser-safe.
- Signatures come from **per-session keys** (Q6): each session generates
  an ed25519 keypair locally on the candidate machine; the private key
  never leaves it; the public key is registered in `collector_sessions`
  at session start. `EvidenceItem.sessionId` binds an item to its
  signing session (absent for L0/L1 unsigned items).
- `Anchor` — periodic checkpoints over a seq range, bound to a
  server-issued nonce so a candidate cannot pre-compute or rewrite history
  without detection. The anchor checkpoint construction is still open (Q10).

The ledger detects tampering; it does not prevent it. See Threat model.

### 2. Collectors (Tier 1 harness-owned, Tier 2 adapters)

Vendor-neutral capture in two tiers:

- **Tier 1 — harness-owned, works with any agent.** The harness owns a git
  repo snapshotter and a test wrapper. Any agent's work that lands in the
  repo or runs under the wrapper produces evidence. No per-agent code needed.
- **Tier 2 — optional per-agent adapters** (`packages/adapter-claude-code`,
  `packages/adapter-copilot`, `packages/adapter-muse-code`). Adapters parse
  agent-specific transcripts into prompts and tool calls. They emit
  *unsigned* events; the harness assigns chain position, hashes, and signs
  with the session key. Chain integrity therefore never depends on
  adapter code.

Collectors and adapters are **not implemented** — only the
`EvidenceAdapter` interface in `packages/core` exists.

### 3. Claims & scoring (`Claim`, `RoleRubric`, scoring deferred)

- A `Claim` binds one rubric criterion to ≥1 evidence items plus a
  human-readable assertion. Its verification level is the weakest link:
  `min(level of cited items)`.
- A `RoleRubric` is a fixed, versioned template per role
  (`role_id` + `version` is immutable once published; changes ship as a new
  version). Rubrics name which evidence kinds count toward each criterion.
  The first draft exists: `software-engineer-ai` v1 (5 heuristic criteria
  with visible weights) in `supabase/seed.sql`, awaiting owner edits.
- The scoring engine that turns claims into per-criterion scores is
  **deferred**. Reports (layer 5) carry claims and evidence refs, never
  scores, until scoring is designed and reviewed.

### 4. Consent & access (grant events, RLS, tombstones)

Candidates own their evidence. Nothing is visible to an org without an
explicit, revocable, per-item grant tied to a role. Grants are
**append-only events** (Q4):

- `grant_events`: `issued` (item ids, role, optional expiry) and `revoked`
  rows keyed by `grant_id`. No UPDATE/DELETE policies — the log cannot be
  rewritten through the API.
- `active_grants` view derives current state: latest event per `grant_id`
  wins; active iff that event is `issued` and unexpired.
- Supabase Row Level Security enforces ownership and grants in the
  database, not just the app: candidates have full access to their own
  rows; org members can SELECT an evidence item only if an active grant
  from that candidate to their org covers that exact item id; claims and
  reports additionally require role match and full item coverage.
- No hard deletes: tables carry `tombstoned_at` (+ reason where useful).
  There are no DELETE policies for `authenticated`, so SQL deletes fail
  closed. Clearing a tombstone is blocked by trigger. Tombstoned items are
  invisible to orgs.

### 5. Surfaces (report UI first, MCP stretch)

- **Report app** (`apps/report`, Vite + React + Tailwind) — builds and
  renders `ScreeningReport`s: candidate + org + role + rubric version,
  cited claims, granted evidence subset, and a per-level verification
  summary. Report rows are written by a service-role builder, never
  directly by candidates or orgs. Shell scaffolded; screens are Phase 3.
- **MCP server** (`packages/mcp-server`, thin stretch goal) — exposes
  granted evidence, claims, and reports to AI clients (reviewer copilots)
  over the Model Context Protocol. Deferred until after the report UI.

## Data flow

```text
candidate starts session ──► keypair generated locally ──► pubkey registered
        │                      (privkey never leaves machine)    │
        ▼                                                       ▼
candidate works with any agent                        collector_sessions
        │
        ▼
Tier 1 harness capture (git snapshot, test wrapper) ──┐
Tier 2 adapter parse (prompts, tool calls, unsigned) ──┤
        │                                             │
        ▼                                             ▼
harness chains + signs (session key) ──► SignedEvents ──► evidence_items
        │                                                        │
        ▼                                                        ▼
anchor service (nonce + checkpoint) ──► anchors ──► L3/L4 promotion
                                                                 │
candidate reviews ──► claims (criterion + items) ────────────────┤
candidate grants ──► grant_events (issued/revoked; state derived) ┤
                                                                 ▼
org requests ──► report builder (service role) ──► screening_reports
                                                                 │
                                              ┌────────────────────┴────────────┐
                                              ▼                                 ▼
                                     report UI (first)                  MCP server (stretch)
```

RLS sits between every reader and every row: the report builder and both
surfaces only ever resolve items covered by active grants.

## Trust boundaries

| Boundary | Trusted for | NOT trusted for |
|---|---|---|
| Candidate machine / agent | Running the task, producing artifacts, holding session private keys | Chain integrity, timestamps, completeness |
| Tier 2 adapter | Faithful parsing of transcripts | Signing, seq assignment (harness-only) |
| Harness collector | Correct capture, hashing, signing, clock | Candidate intent, off-harness work |
| Anchor service + Supabase | Nonce freshness, anchor signatures, RLS enforcement | Semantic truth of payloads |
| Function secrets | Holding the server (anchor) signing key | Anything else (least privilege) |
| Report builder (service role) | Grant coverage checks, report hashing | Scoring (does not exist yet) |
| Org viewer | Reading granted rows only | Anything beyond active grants |

Key rule: anything the candidate controls (files, clocks, adapter input)
is *observed and chained*, never trusted at face value. Verification
levels record exactly how much corroboration each item has.

## Verification levels

Stored on every evidence item. Ordered; higher subsumes lower.

| Level | Name | Meaning |
|---|---|---|
| L0 | self-reported | Candidate-supplied, no corroboration |
| L1 | linked | Referenced artifact exists (e.g. connected repo) |
| L2 | platform-observed | Collected by our harness or collector |
| L3 | chain-verified | Hash chain + signatures internally consistent |
| L4 | anchored + corroborated | Server nonce/anchors verify AND harness facts agree |

Promotion is one-way and recomputed by the harness, never asserted by the
candidate. Claims inherit the minimum level of their cited items.

## Threat model & honest limits

**Tamper-evident, not tamper-proof.** The ledger makes quiet rewriting
detectable (broken chain, anchor mismatch, nonce replay); it cannot stop a
determined candidate from misbehaving outside the harness. Specifically:

What we detect:

- Post-hoc editing, deletion, or reordering of chained evidence
  (hash mismatch, seq gap, signature failure).
- Backdating or pre-computation (anchor nonces are server-issued and
  unpredictable; anchors commit to seq ranges).
- Grant forgery or scope creep (grants are an append-only event log;
  `active_grants` derives state; RLS re-checks coverage on every read).
- Silent rubric changes (rubrics immutable per version; reports pin
  `role_id + version`).

What we do NOT claim:

- **Authorship.** We cannot prove the human (vs. the agent, vs. a friend)
  produced an artifact — only that the artifact passed through the harness.
- **Completeness.** Off-harness work (a second repo, pasted solutions,
  unlogged prompts) is invisible to us. L2+ means "observed", not "exhaustive".
- **Semantic truth.** A passing test run is evidence the tests passed, not
  that the candidate understands the code. Rubrics and reviewers bridge that gap.
- **Session-key compromise.** A leaked session private key lets an attacker
  mint that session's history until expiry/revocation. Blast radius is
  bounded to one session by design (Q6); rotation means starting a new
  session. The compromise-cutoff procedure is still open (Q11).
- **Server-key compromise.** The anchor signing key lives in Supabase
  function secrets only; if it leaks, anchors are forgeable. Storage and
  rotation of that key need an explicit procedure (part of Q11).
- **Harness subversion.** A modified harness binary on the candidate's
  machine can lie at collection time. Mitigations (attestation, reproducible
  builds, server-side cross-checks) are future work.
- **Collusion / replay across candidates.** Near-duplicate payloads across
  candidates are detectable only if someone looks (deferred analysis).
- **Metadata leakage.** Chain shape (counts, timing) and anchor rows reveal
  activity patterns even where payloads are hidden. Accepted for now.

## Vaultio integration

VaultVerify shares the Vaultio Supabase project: one `auth.users` means one
login for both products — no second account. Candidates auto-provision from
auth users; VaultVerify orgs mirror Vaultio organizations (shared UUIDs)
with viewer rights derived from team membership; hiring context (profiles,
verified profiles, assessments, CV data) is readable under Vaultio's own
RLS. The evidence ledger keeps its own tables, grants, and consent model;
Vaultio objects are only ever read, never restructured.

## Non-goals for this scaffold

Collector and adapter implementations, the anchor service, scoring, real
UI screens, MCP implementation, and Supabase Storage integration.
Contracts for all of them live in `packages/core`; the crypto contract
(`vv-crypto-1`) is executable; build order lives in `tasks/backlog.md`.
