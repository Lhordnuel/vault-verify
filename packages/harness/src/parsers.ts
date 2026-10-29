import { redactText } from '@vault-verify/core';

/**
 * One parsed log line, pre-normalization. The importer feeds `kind` + `data`
 * through the shared core classifier, so types match the Tier 1 path.
 */
export interface RawLogEntry {
  /** Normalized ISO timestamp. */
  at: string;
  /** Parser-suggested kind (classifier input, not trusted blindly). */
  kind: string;
  /** Structured fields for classification and counts. */
  data: Record<string, unknown>;
  /** Free text -> AgentEvent note (redacted + truncated at normalize). */
  note?: string;
  /** Raw prompt -> kept only with --include-prompt-text. */
  promptText?: string;
  /**
   * Source fields this entry did NOT map, as dotted paths
   * (e.g. 'output_tail', 'files[].path'). Aggregated into the import
   * result so unmapped data stays visible, never silent.
   */
  unmapped?: string[];
}

export interface FormatParser {
  id: string;
  describe(): string;
  detect(firstLines: string[]): boolean;
  parse(text: string): RawLogEntry[];
}

function firstLinesOf(text: string, count: number): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, count);
}

function normalizeTimestamp(ts: unknown, lineNo: number): string {
  if (typeof ts !== 'string' || !Number.isFinite(Date.parse(ts))) {
    throw new Error(`[harness] line ${lineNo}: bad timestamp ${JSON.stringify(ts) ?? 'missing'}.`);
  }
  return new Date(ts).toISOString();
}

function entryObject(line: string, lineNo: number): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    throw new Error(`[harness] line ${lineNo}: not valid JSON.`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`[harness] line ${lineNo}: expected a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * vv-agent-log/1: JSONL agent transcript. Field names below are derived from
 * `packages/harness/fixtures/sample-agent-log.jsonl` — envelope {v, ts,
 * event}; edit {files[{path, added, removed}], summary}; test {command,
 * passed, failed, exit_code, output_tail}; prompt {text}; note {text}.
 */
/**
 * TEST-ONLY format. Deliberately NOT in PARSER_REGISTRY: tests inject it
 * explicitly. Production auto-detect and --format never see it.
 */
export const agentLogV1Parser: FormatParser = {
  id: 'vv-agent-log/1',

  describe(): string {
    return 'vv-agent-log/1 (TEST ONLY): JSONL lines with {v:1, ts, event} where event is edit|test|prompt|note';
  },

  detect(firstLines: string[]): boolean {
    if (firstLines.length === 0) return false;
    try {
      const first = JSON.parse(firstLines[0]) as { v?: unknown; event?: unknown };
      return (
        typeof first === 'object' && first !== null && first['v'] === 1 && typeof first['event'] === 'string'
      );
    } catch {
      return false;
    }
  },

  parse(text: string): RawLogEntry[] {
    const entries: RawLogEntry[] = [];
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const lineNo = index + 1;
      if (lines[index].trim() === '') continue;
      const line = entryObject(lines[index], lineNo);
      if (line['v'] !== 1) {
        throw new Error(`[harness] line ${lineNo}: unsupported version ${JSON.stringify(line['v'] ?? null)}.`);
      }
      const at = normalizeTimestamp(line['ts'], lineNo);
      const event = line['event'];
      if (event === 'edit') {
        const files = line['files'];
        if (!Array.isArray(files)) {
          throw new Error(`[harness] line ${lineNo}: edit entry needs a files array.`);
        }
        let insertions = 0;
        let deletions = 0;
        for (const file of files) {
          if (typeof file !== 'object' || file === null) {
            throw new Error(`[harness] line ${lineNo}: file entries must be objects.`);
          }
          const record = file as Record<string, unknown>;
          for (const key of ['added', 'removed'] as const) {
            const value = record[key];
            if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) {
              throw new Error(`[harness] line ${lineNo}: file "${key}" must be a non-negative integer.`);
            }
          }
          insertions += (record['added'] as number | undefined) ?? 0;
          deletions += (record['removed'] as number | undefined) ?? 0;
        }
        entries.push({
          at,
          kind: 'file_edit',
          data: { insertions, deletions, filesChanged: files.length },
          ...(typeof line['summary'] === 'string' ? { note: line['summary'] } : {}),
          unmapped: ['files[].path'],
        });
      } else if (event === 'test') {
        const passed = line['passed'];
        const failed = line['failed'];
        if (
          typeof passed !== 'number' ||
          !Number.isInteger(passed) ||
          passed < 0 ||
          typeof failed !== 'number' ||
          !Number.isInteger(failed) ||
          failed < 0
        ) {
          throw new Error(`[harness] line ${lineNo}: test entry needs numeric passed/failed.`);
        }
        entries.push({
          at,
          kind: 'test_run',
          data: { passed, failed },
          unmapped: ['command', 'exit_code', 'output_tail'],
        });
      } else if (event === 'prompt') {
        if (typeof line['text'] !== 'string') {
          throw new Error(`[harness] line ${lineNo}: prompt entry needs a text string.`);
        }
        entries.push({ at, kind: 'prompt', data: {}, promptText: line['text'] });
      } else if (event === 'note') {
        if (typeof line['text'] !== 'string') {
          throw new Error(`[harness] line ${lineNo}: note entry needs a text string.`);
        }
        entries.push({ at, kind: 'note', data: {}, note: line['text'] });
      } else {
        throw new Error(
          `[harness] line ${lineNo}: unknown event ${JSON.stringify(event ?? null)} (want edit|test|prompt|note).`,
        );
      }
    }
    if (entries.length === 0) {
      throw new Error('[harness] no log entries found (empty log).');
    }
    return entries;
  },
};

/**
 * Production parser registry: real agent formats register here. EMPTY
 * until the first real format lands — the authored vv-agent-log/1 is
 * test-only and lives outside this list (tests inject it explicitly).
 */
export const PARSER_REGISTRY: FormatParser[] = [];

export function knownFormats(registry: FormatParser[] = PARSER_REGISTRY): string[] {
  return registry.map((parser) => parser.id);
}

function knownList(registry: FormatParser[]): string {
  const known = knownFormats(registry);
  return known.length > 0 ? known.join(', ') : '(none registered yet)';
}

/**
 * Detect (or force) a parser over an explicit registry (default: the
 * global production one). Throws a clear error for unknown formats.
 */
export function detectParser(
  text: string,
  forcedId?: string,
  registry: FormatParser[] = PARSER_REGISTRY,
): FormatParser {
  if (forcedId !== undefined) {
    const forced = registry.find((parser) => parser.id === forcedId);
    if (!forced) {
      throw new Error(`[harness] unknown log format: "${forcedId}" (known: ${knownList(registry)}).`);
    }
    return forced;
  }
  const firstLines = firstLinesOf(text, 5);
  const matched = registry.find((parser) => parser.detect(firstLines));
  if (!matched) {
    const snippet = firstLines.length > 0 ? redactText(firstLines[0]).slice(0, 120) : '(empty file)';
    throw new Error(
      `[harness] unknown log format: no parser matched (known: ${knownList(registry)}). First line: "${snippet}".`,
    );
  }
  return matched;
}
