#!/usr/bin/env node
/**
 * Generate committed report fixtures from a freshly minted, really-signed
 * Tier 1 session. Regenerate with: npm run fixtures -w @vault-verify/scoring
 * (requires built core + scoring dist). Carries public keys only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOFTWARE_ENGINEER_AI_RUBRIC_V1 } from '../../core/dist/index.js';
import {
  anchorDigest,
  generateSessionKeypair,
  genesisPrevHashFromNonce,
  hashEventStruct,
  observationPayloadHash,
  signHashHex,
  verifySession,
} from '../../core/dist/node.js';
import { buildTimeline, MockJudge, scoreSession } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '..', '..', 'apps', 'report', 'src', 'fixtures');

const SESSION_ID = '77777777-7777-7777-7777-777777777777';
const CANDIDATE_ID = '88888888-8888-8888-8888-888888888888';
const BASE_MS = Date.parse('2026-10-28T10:00:00.000Z');
const at = (minutes) => new Date(BASE_MS + minutes * 60000).toISOString();

function snapshot(filesChanged, insertions, deletions, final = false) {
  return {
    commit: 'c'.repeat(40),
    diffstat: ` ${filesChanged} files changed, ${insertions} insertions(+), ${deletions} deletions(-)`,
    diff: 'diff --git a/app.ts b/app.ts\n+demo fixture diff (not real code)',
    diffTruncated: false,
    ...(final ? { final: true, fromCommit: 'a'.repeat(40), toCommit: 'b'.repeat(40) } : {}),
  };
}

function testRun(passed, failed, exitCode) {
  return {
    command: 'npm test',
    exitCode,
    durationMs: 4200,
    passed,
    failed,
    framework: 'vitest',
    outputTail: `demo fixture output tail: ${passed} passed, ${failed} failed`,
  };
}

// A realistic arc: big first import, two failing rounds, a revert-ish edit,
// recovery, final diff. Offsets in minutes from the base time.
const specs = [
  { kind: 'repo_snapshot', payload: snapshot(4, 120, 0), at: at(0) },
  { kind: 'test_run', payload: testRun(3, 2, 1), at: at(3) },
  { kind: 'repo_snapshot', payload: snapshot(2, 15, 4), at: at(7) },
  { kind: 'test_run', payload: testRun(4, 1, 1), at: at(11) },
  { kind: 'repo_snapshot', payload: snapshot(1, 8, 22), at: at(14) },
  { kind: 'repo_snapshot', payload: snapshot(1, 6, 1), at: at(18) },
  { kind: 'test_run', payload: testRun(5, 0, 0), at: at(22) },
  { kind: 'repo_snapshot', payload: snapshot(6, 149, 27, true), at: at(25) },
];

const sessionKeys = generateSessionKeypair();
const serverKeys = generateSessionKeypair();
const nonce = 'f0'.repeat(16);

let prev = genesisPrevHashFromNonce(nonce);
const records = specs.map((spec, seq) => {
  const hash = hashEventStruct({ seq, prevHash: prev, payload: spec.payload });
  const record = {
    event: { seq, prevHash: prev, payload: spec.payload, hash, sig: signHashHex(sessionKeys.privateKey, hash) },
    kind: spec.kind,
    collectedAt: spec.at,
  };
  prev = hash;
  return record;
});

const events = records.map((r) => r.event);
const facts = {
  sessionId: SESSION_ID,
  nonce,
  sessionPublicKey: sessionKeys.publicKey,
  anchorPublicKey: serverKeys.publicKey,
  observations: events.map((e) => ({ seq: e.seq, payloadHash: observationPayloadHash(e.payload) })),
};

function receipt(seq) {
  const head = events[seq];
  const serverTime = '2026-10-28T10:30:00.000Z';
  const digest = anchorDigest({ sessionId: SESSION_ID, seq, headHash: head.hash, serverTime });
  return {
    sessionId: SESSION_ID,
    seq,
    headHash: head.hash,
    serverTime,
    signature: signHashHex(serverKeys.privateKey, digest),
  };
}
const anchors = [receipt(3), receipt(7)];

const verdict = verifySession(events, anchors, facts);
if (verdict.level !== 'L4') {
  throw new Error(`fixture session must verify at L4, got ${verdict.level}: ${verdict.reasons.join('; ')}`);
}

const judge = new MockJudge((request) => ({
  criterionId: 'task-decomposition',
  aspect: request.aspect,
  score: request.aspect === 'decomposition' ? 0.75 : 0.7,
  citedEventIds: request.aspect === 'decomposition' ? ['seq:1', 'seq:3', 'seq:6'] : ['seq:0', 'seq:2', 'seq:4', 'seq:5'],
  rationale:
    request.aspect === 'decomposition'
      ? 'Work proceeds in small test-checked steps with one revert and recovery.'
      : 'Repeated short edit cycles suggest focused prompts; no transcript available.',
}));

const report = await scoreSession({
  input: {
    sessionId: SESSION_ID,
    candidateId: CANDIDATE_ID,
    records,
    verification: verdict,
    hiddenTestOutcome: { passed: true },
  },
  rubric: SOFTWARE_ENGINEER_AI_RUBRIC_V1,
  judge,
  generatedAt: '2026-10-29T00:00:00.000Z',
});
// Deterministic fixture id (scoreSession mints a random one).
report.id = '99999999-9999-9999-9999-999999999999';

const timeline = buildTimeline(records);

const sessionLog = { version: 'vv-session-log/1', facts, events, anchors };
const tampered = structuredClone(sessionLog);
tampered.events[2].payload = {
  ...tampered.events[2].payload,
  diffstat: ' 2 files changed, 150 insertions(+), 4 deletions(-)',
};

mkdirSync(outDir, { recursive: true });
for (const [name, data] of [
  ['report.json', report],
  ['timeline.json', timeline],
  ['session-log.json', sessionLog],
  ['session-log-tampered.json', tampered],
]) {
  writeFileSync(join(outDir, name), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`wrote apps/report/src/fixtures/${name}`);
}
console.log(`overall=${report.overallScore?.toFixed(4)} level=${report.verification.level}`);
