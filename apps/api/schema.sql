PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  github_username TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_nodes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claim_type TEXT NOT NULL,
  claim_value TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Supported', 'Partially supported', 'Unverified', 'Contradicted')),
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  evidence_ref TEXT NOT NULL,
  captured_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS evidence_nodes_user_captured ON evidence_nodes(user_id, captured_at);

CREATE TABLE IF NOT EXISTS test_blueprints (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  skill TEXT NOT NULL,
  competency TEXT NOT NULL,
  seniority TEXT NOT NULL,
  rubric TEXT NOT NULL,
  generator_prompt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blueprint_id TEXT REFERENCES test_blueprints(id) ON DELETE SET NULL,
  generated_test TEXT NOT NULL,
  rubric_instance TEXT NOT NULL,
  candidate_submission TEXT,
  ai_grade TEXT,
  ai_grade_confidence REAL CHECK (ai_grade_confidence IS NULL OR (ai_grade_confidence >= 0 AND ai_grade_confidence <= 1)),
  grader_agreement REAL,
  human_review_required INTEGER NOT NULL DEFAULT 0 CHECK (human_review_required IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'grading', 'graded', 'human_review_required', 'failed')),
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  graded_at INTEGER
);
CREATE INDEX IF NOT EXISTS assessments_user_started ON assessments(user_id, started_at);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO test_blueprints
  (id, slug, skill, competency, seniority, rubric, generator_prompt)
VALUES
  ('blueprint-general-001', 'evidence-grounded-engineering', 'software engineering', 'reasoning from code evidence', 'mid-level',
   '{"criteria":[{"skill":"problem framing","weight":25},{"skill":"technical reasoning","weight":35},{"skill":"tradeoff analysis","weight":20},{"skill":"communication","weight":20}]}',
   'Generate a short, candidate-specific engineering exercise that gathers new evidence for a rubric competency not directly covered by the supplied evidence. Lack of evidence is not evidence of lack of ability. Do not copy private source code; return only the requested JSON.');
