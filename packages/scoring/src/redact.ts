import { DerivedEventSchema, type DerivedEvent, type ScoredEvent } from '@vault-verify/core';
import { asSnapshot, asTestRun } from './payloads.js';

/**
 * Redact a verified session for the LLM judge: counts and timings only.
 * Dropped: diffs, diffstats, test commands, output tails, commit hashes,
 * transcripts. The judge cites `seq:<n>` refs from this derived set.
 */
export function redactForJudge(records: ScoredEvent[]): DerivedEvent[] {
  return records.map((record) => {
    const base = { seq: record.event.seq, kind: record.kind, at: record.collectedAt };
    if (record.kind === 'test_run') {
      const facts = asTestRun(record.event.payload);
      return DerivedEventSchema.parse({
        ...base,
        facts:
          facts === null
            ? { unparseable: true }
            : { passed: facts.passed, failed: facts.failed, exitCode: facts.exitCode },
      });
    }
    if (record.kind === 'repo_snapshot') {
      const snapshot = asSnapshot(record.event.payload);
      return DerivedEventSchema.parse({
        ...base,
        facts:
          snapshot === null
            ? { unparseable: true }
            : {
                final: snapshot.final,
                filesChanged: snapshot.filesChanged,
                insertions: snapshot.insertions,
                deletions: snapshot.deletions,
              },
      });
    }
    return DerivedEventSchema.parse({ ...base, facts: { observed: true } });
  });
}
