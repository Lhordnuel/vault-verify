# Backlog (post ledger+harness)

Done in the ledger + Tier 1 phase: executable vv-crypto-1 (hash, genesis,
sign, verify), verifyChain/verifySession (L0/L3/L4 + reasons), anchor edge
function (deployed) with migration 5, Tier 1 harness CLI
(start/test/finish/watch/upload), 53 vitest tests green.

Remaining, in build order. Each item needs design before implementation.

1. Session/key lifecycle: expiry, rotation, server-key procedure, compromise cutoff (needs Q11).
2. Tier 2 adapters: `adapter-claude-code`, `adapter-copilot`, `adapter-muse-code` (transcript parsing). Real agent log formats also register as new `import-log` parsers — BLOCKED: the sanitized real log for fixtures/real/ was never provided (see A55).
3. Claim builder: criterion mapping, weakest-link level derivation.
4. Scoring engine: DONE session-level (`packages/scoring`: deterministic signals + cited judge → `FluencyReport`) and DONE evidence-over-baseline (`RoleTemplate`/`EvidenceProfile`/`computeUplift`); claim-based scoring still needs item 3. Rubric + fairness review still needed before scores mean anything.
5. Report builder (service role): grant-coverage checks, share-flag checks, report hashing, attach fluency scores to grant-based `ScreeningReport`.
6. Report screens: DONE fixture-driven (score, badge, criteria, timeline, verify panel); DB/auth wiring (same Supabase Auth as Vaultio) still needs Q9.
11. Phase 5A DB migrations (staging first): `evidence_items.kind` CHECK + 'attempt'; new tables role_templates, test_definitions, attempts, share_links, share view log. Contracts in core; `EvidenceLibrary` is the no-cascade reference.
12. Share-link service endpoints (create/store/revoke) + upload wiring for imported sessions.
7. L3/L4 promotion pass over uploaded evidence (verification functions exist).
8. MCP server: thin tools for granted evidence/claims/reports (stretch goal).
9. Supabase Storage integration for large artifacts (`{ uri, sha256 }` payload pointers + storage RLS).
10. Hardening: harness attestation, duplicate/replay analysis, metadata-leak review.
