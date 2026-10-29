import {
  generateSessionKeypair,
  genesisPrevHashFromNonce,
  hashEventStruct,
  signHashHex,
} from '@vault-verify/core/node';
import type { EvidenceKind, ScoredEvent } from '@vault-verify/core';

export const TEST_NONCE = 'dd'.repeat(16);
const BASE_MS = Date.parse('2026-10-28T10:00:00.000Z');

/** ISO timestamp `minutes` after the fixed test base. */
export function at(minutes: number): string {
  return new Date(BASE_MS + minutes * 60000).toISOString();
}

export function snapshotPayload(args: {
  filesChanged: number;
  insertions: number;
  deletions: number;
  final?: boolean;
}): unknown {
  const { filesChanged, insertions, deletions, final } = args;
  return {
    commit: 'f'.repeat(40),
    diffstat: ` ${filesChanged} file${filesChanged === 1 ? '' : 's'} changed, ${insertions} insertion${insertions === 1 ? '' : 's'}(+), ${deletions} deletion${deletions === 1 ? '' : 's'}(-)`,
    diff: 'SECRET_DIFF_MARKER: must never reach the judge',
    diffTruncated: false,
    ...(final === true ? { final: true, fromCommit: 'a'.repeat(40), toCommit: 'b'.repeat(40) } : {}),
  };
}

export function testPayload(args: { passed: number; failed: number; exitCode: number }): unknown {
  return {
    command: 'npm test -- SECRET_COMMAND_MARKER',
    exitCode: args.exitCode,
    durationMs: 1234,
    passed: args.passed,
    failed: args.failed,
    framework: 'vitest',
    outputTail: 'SECRET_OUTPUT_MARKER: must never reach the judge',
  };
}

export interface RecordSpec {
  kind: EvidenceKind;
  payload: unknown;
  at: string;
}

/** Mint chain-signed ScoredEvents (real hashes + signatures, fixed test key). */
export function mintScoredRecords(specs: RecordSpec[]): {
  records: ScoredEvent[];
  publicKey: string;
  nonce: string;
} {
  const keypair = generateSessionKeypair();
  let prev = genesisPrevHashFromNonce(TEST_NONCE);
  const records = specs.map((spec, seq) => {
    const hash = hashEventStruct({ seq, prevHash: prev, payload: spec.payload });
    const record: ScoredEvent = {
      event: {
        seq,
        prevHash: prev,
        payload: spec.payload,
        hash,
        sig: signHashHex(keypair.privateKey, hash),
      },
      kind: spec.kind,
      collectedAt: spec.at,
    };
    prev = hash;
    return record;
  });
  return { records, publicKey: keypair.publicKey, nonce: TEST_NONCE };
}
