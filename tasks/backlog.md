# Backlog (Phase 3 and beyond)

Done in Phase 2: core crypto (`vv-crypto-1`, executable), grant events +
sessions (contracts + migration 2), rubric draft seed (`software-engineer-ai`
v1, heuristic), report UI shell (Vite + React + Tailwind), pre-commit secret
check.

Remaining, in build order. Each item needs design before implementation.

1. Tier 1 harness capture: git repo snapshotter + test wrapper (works with any agent).
2. Harness chaining service: session registration, seq assignment, hashing, signing (uses core crypto), L0–L2 promotion.
3. Anchor service: server nonces, checkpoint issuance/verification, L3–L4 promotion (needs Q10 anchor construction).
4. Session/key lifecycle: expiry, rotation, server-key procedure, compromise cutoff (needs Q11).
5. Tier 2 adapters: `adapter-claude-code`, `adapter-copilot`, `adapter-muse-code` (transcript parsing).
6. Claim builder: criterion mapping, weakest-link level derivation.
7. Scoring engine: claims → per-criterion scores against `RoleRubric` (needs rubric + fairness review first).
8. Report builder (service role): grant-coverage checks, report hashing.
9. Report screens (same Supabase Auth as Vaultio — no second account; providers/session UX still TBD; Vite shell already scaffolded).
10. MCP server: thin tools for granted evidence/claims/reports (stretch goal).
11. Supabase Storage integration for large artifacts (`{ uri, sha256 }` payload pointers + storage RLS).
12. Hardening: harness attestation, duplicate/replay analysis across candidates, metadata-leak review.
