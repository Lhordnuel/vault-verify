-- Draft rubric (Q5): software engineer working with AI agents (backend/full-stack).
-- HEURISTIC — owner to edit. Idempotent: safe to re-seed.
INSERT INTO public.role_rubrics (role_id, version, title, criteria, published_at)
VALUES (
  'software-engineer-ai',
  1,
  'Software Engineer working with AI agents (backend/full-stack) — heuristic draft',
  '[
    {
      "id": "task-decomposition",
      "description": "Breaks work into small verifiable steps instead of mega-prompts. Signal: prompt transcripts show stepwise plans with tool calls scoped to one step at a time.",
      "weight": 0.25,
      "evidenceKinds": ["prompt_transcript", "tool_calls"],
      "heuristic": true
    },
    {
      "id": "test-driven-iteration",
      "description": "Drives debugging with test runs rather than guessing. Signal: repeated test_run evidence interleaved with edits, showing failing-to-passing transitions.",
      "weight": 0.25,
      "evidenceKinds": ["test_run", "tool_calls"],
      "heuristic": true
    },
    {
      "id": "change-quality",
      "description": "Produces coherent, reviewable agent-assisted diffs. Signal: repo snapshots show focused diffs without unrelated churn.",
      "weight": 0.20,
      "evidenceKinds": ["repo_snapshot"],
      "heuristic": true
    },
    {
      "id": "verification-discipline",
      "description": "Verifies agent output before claiming done. Signal: test runs and snapshots follow agent edits instead of untested handoffs.",
      "weight": 0.15,
      "evidenceKinds": ["test_run", "repo_snapshot"],
      "heuristic": true
    },
    {
      "id": "oversight-recovery",
      "description": "Catches and corrects agent mistakes. Signal: transcripts and tool calls show rejection or re-prompting after bad agent output, followed by corrected snapshots.",
      "weight": 0.15,
      "evidenceKinds": ["prompt_transcript", "tool_calls", "repo_snapshot"],
      "heuristic": true
    }
  ]'::jsonb,
  now()
)
ON CONFLICT (role_id, version) DO NOTHING;
