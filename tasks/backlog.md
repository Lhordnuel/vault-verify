# Backlog (post ledger+harness)

Done in the ledger + Tier 1 phase: executable vv-crypto-1 (hash, genesis,
sign, verify), verifyChain/verifySession (L0/L3/L4 + reasons), anchor edge
function (deployed) with migration 5, Tier 1 harness CLI
(start/test/finish/watch/upload), 53 vitest tests green.

Remaining, in build order. Each item needs design before implementation.

1. Session/key lifecycle: expiry, rotation, server-key procedure, compromise cutoff (needs Q11).
2. Tier 2 adapters: `adapter-claude-code`, `adapter-copilot`, `adapter-muse-code` (transcript parsing).
3. Claim builder: criterion mapping, weakest-link level derivation.
4. Scoring engine: claims → per-criterion scores (needs rubric + fairness review first).
5. Report builder (service role): grant-coverage checks, share-flag checks, report hashing.
6. Report screens (same Supabase Auth as Vaultio; Vite shell scaffolded).
7. L3/L4 promotion pass over uploaded evidence (verification functions exist).
8. MCP server: thin tools for granted evidence/claims/reports (stretch goal).
9. Supabase Storage integration for large artifacts (`{ uri, sha256 }` payload pointers + storage RLS).
10. Hardening: harness attestation, duplicate/replay analysis, metadata-leak review.
