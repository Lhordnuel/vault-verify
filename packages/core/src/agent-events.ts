import { z } from 'zod';
import { IsoDateTimeSchema } from './primitives.js';
import type { ScoredEvent } from './scoring.js';

/**
 * Normalized agent action. BOTH the Tier 1 path (harness records) and the
 * retroactive importer normalize into this shape through the shared
 * `classifyAgentEvent` below, so file_edit / test_run mean the same thing
 * no matter how the evidence was collected.
 */
export const AGENT_EVENT_TYPES = ['file_edit', 'test_run', 'session_note'] as const;
export const AgentEventTypeSchema = z.enum(AGENT_EVENT_TYPES);
export type AgentEventType = z.infer<typeof AgentEventTypeSchema>;

export const AgentEventSchema = z.object({
  type: AgentEventTypeSchema,
  at: IsoDateTimeSchema,
  files: z
    .object({
      changed: z.number().int().min(0),
      insertions: z.number().int().min(0),
      deletions: z.number().int().min(0),
    })
    .optional(),
  tests: z
    .object({
      passed: z.number().int().min(0),
      failed: z.number().int().min(0),
    })
    .optional(),
  note: z.string().min(1).max(280).optional(),
  /** Raw prompt text — set ONLY when the importer runs with --include-prompt-text. */
  promptText: z.string().min(1).max(20000).optional(),
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;

function asRecord(payload: unknown): Record<string, unknown> | null {
  return typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : null;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function hasTestCounts(payload: unknown): boolean {
  const record = asRecord(payload);
  return record !== null && isCount(record['passed']) && isCount(record['failed']);
}

function hasAttemptResult(payload: unknown): boolean {
  const record = asRecord(payload);
  const result = record === null ? null : asRecord(record['result']);
  return result !== null && typeof result['passed'] === 'boolean';
}

function isFinalSnapshot(payload: unknown): boolean {
  return asRecord(payload)?.['final'] === true;
}

function hasFileChanges(payload: unknown): boolean {
  const record = asRecord(payload);
  if (record === null) return false;
  if (typeof record['diffstat'] === 'string' && record['diffstat'].length > 0) return true;
  if (isCount(record['insertions']) || isCount(record['deletions']) || isCount(record['filesChanged'])) {
    return true;
  }
  return Array.isArray(record['files']) && record['files'].length > 0;
}

/**
 * Shared classifier: one rule set for Tier 1 records and imported log
 * entries. Unknown shapes fall back to session_note (never crash).
 */
export function classifyAgentEvent(kind: string, payload: unknown): AgentEventType {
  // Sealed AgentEvent payloads are self-typed (set by our own importer from
  // this same classifier); trust the hint so import -> read round-trips.
  const hinted = asRecord(payload)?.['type'];
  if (hinted === 'file_edit' || hinted === 'test_run' || hinted === 'session_note') {
    return hinted;
  }
  if (kind === 'test_run' || kind === 'test') {
    return hasTestCounts(payload) ? 'test_run' : 'session_note';
  }
  if (kind === 'attempt') {
    return hasAttemptResult(payload) ? 'test_run' : 'session_note';
  }
  if (kind === 'repo_snapshot' || kind === 'snapshot' || kind === 'file_edit' || kind === 'edit') {
    if (isFinalSnapshot(payload)) return 'session_note';
    return hasFileChanges(payload) ? 'file_edit' : 'session_note';
  }
  return 'session_note';
}

function numberOrZero(value: unknown): number {
  return isCount(value) ? value : 0;
}

/**
 * Parse `git diff --stat` summary counts ("N files changed,
 * I insertions(+), D deletions(-)"); missing parts read as zero.
 * Canonical home (scoring re-exports this).
 */
export function parseDiffstatCounts(diffstat: string): {
  filesChanged: number;
  insertions: number;
  deletions: number;
} {
  const zero = { filesChanged: 0, insertions: 0, deletions: 0 };
  if (typeof diffstat !== 'string' || diffstat === '') return zero;
  const lines = diffstat.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const m =
      /(\d+)\s+files?\s+changed(?:,\s*(\d+)\s+insertions?\(\+\))?(?:,\s*(\d+)\s+deletions?\(-\))?/.exec(
        lines[i],
      );
    if (m) {
      return {
        filesChanged: Number(m[1]),
        insertions: m[2] === undefined ? 0 : Number(m[2]),
        deletions: m[3] === undefined ? 0 : Number(m[3]),
      };
    }
  }
  return zero;
}

/**
 * Tier 1 path into AgentEvent: harness record -> shared classifier ->
 * counts only (no diffs, commands, or output — redacted by construction).
 */
export function scoredEventToAgentEvent(record: ScoredEvent): AgentEvent {
  const payload = asRecord(record.event.payload) ?? {};
  const hinted = payload['type'];
  if (hinted === 'file_edit' || hinted === 'test_run' || hinted === 'session_note') {
    // Already a sealed AgentEvent: revalidate and keep its own timestamp.
    const parsed = AgentEventSchema.safeParse(payload);
    if (parsed.success) return parsed.data;
  }
  const type = classifyAgentEvent(record.kind, record.event.payload);
  const base = { type, at: record.collectedAt };
  if (type === 'test_run') {
    const result = asRecord(payload['result']);
    if (result !== null && typeof result['passed'] === 'boolean') {
      const passed = result['passed'] ? 1 : 0;
      return AgentEventSchema.parse({ ...base, tests: { passed, failed: 1 - passed } });
    }
    return AgentEventSchema.parse({
      ...base,
      tests: { passed: numberOrZero(payload['passed']), failed: numberOrZero(payload['failed']) },
    });
  }
  if (type === 'file_edit') {
    const stat =
      typeof payload['diffstat'] === 'string' ? parseDiffstatCounts(payload['diffstat']) : null;
    const files = Array.isArray(payload['files'])
      ? payload['files'].length
      : (stat?.filesChanged ?? numberOrZero(payload['filesChanged']));
    return AgentEventSchema.parse({
      ...base,
      files: {
        changed: files,
        insertions: stat?.insertions ?? numberOrZero(payload['insertions']),
        deletions: stat?.deletions ?? numberOrZero(payload['deletions']),
      },
    });
  }
  if (record.kind === 'repo_snapshot' && isFinalSnapshot(record.event.payload)) {
    return AgentEventSchema.parse({ ...base, note: 'final diff checkpoint' });
  }
  return AgentEventSchema.parse(base);
}
