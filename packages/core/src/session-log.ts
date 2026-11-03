import { createChainHash, GENESIS_HASH, type SessionEvidence } from './index.js';

export interface ImportedSessionEvent {
  id: string;
  at: string;
  actor: 'user' | 'assistant' | 'tool' | 'system';
  type: 'message' | 'tool_use' | 'file_edit' | 'test_run' | 'note';
  text: string;
}

export interface ImportedSessionLog {
  sessionId: string;
  format: 'claude-code-jsonl' | 'attest-session-log/1' | 'vv-session-log/1';
  level: SessionEvidence['evidence_ref']['verification_level'];
  reasons: string[];
  events: ImportedSessionEvent[];
}

interface LegacySignedEvent {
  seq: number;
  prevHash: string;
  payload: unknown;
  hash: string;
  sig: string;
}

const encoder = new TextEncoder();
const REDACTIONS = [
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/gi,
  /\b(?:api[_-]?key|secret|password|token)\b[\s"'`]*[:=][\s"'`]*[A-Za-z0-9._~+/-]{8,}/gi,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
];

function redact(text: string): string {
  return REDACTIONS.reduce((value, pattern) => value.replace(pattern, '[REDACTED]'), text).slice(0, 600);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textFromClaudeContent(content: unknown, actor: ImportedSessionEvent['actor']): Array<{ actor: ImportedSessionEvent['actor']; type: ImportedSessionEvent['type']; text: string }> {
  if (typeof content === 'string') return content.trim() ? [{ actor, type: 'message', text: content }] : [];
  if (!Array.isArray(content)) return [];
  const found: Array<{ actor: ImportedSessionEvent['actor']; type: ImportedSessionEvent['type']; text: string }> = [];
  for (const raw of content) {
    const item = record(raw);
    if (!item) continue;
    if (item['type'] === 'text' && typeof item['text'] === 'string' && item['text'].trim()) {
      found.push({ actor, type: 'message', text: item['text'] });
    } else if (item['type'] === 'tool_use' && typeof item['name'] === 'string') {
      const input = record(item['input']);
      const path = input && typeof input['file_path'] === 'string' ? ` (${input['file_path']})` : '';
      const command = input && typeof input['command'] === 'string'
        ? `: ${input['command'].slice(0, 180)}`
        : '';
      const tool = item['name'];
      found.push({ actor, type: 'tool_use', text: `Requested ${tool}${path}${command}` });
    }
  }
  return found;
}

function hexBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error('Malformed hexadecimal value.');
  return Uint8Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().filter((key) => object[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}

async function signatureValid(publicKey: string, hash: string, signature: string): Promise<boolean> {
  try {
    const keyBytes = Uint8Array.from(hexBytes(publicKey));
    const signatureBytes = Uint8Array.from(hexBytes(signature));
    const hashBytes = Uint8Array.from(hexBytes(hash));
    const key = await crypto.subtle.importKey('raw', keyBytes.buffer, { name: 'Ed25519' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'Ed25519' }, key, signatureBytes.buffer, hashBytes.buffer);
  } catch {
    return false;
  }
}

async function verifyLegacyLog(input: Record<string, unknown>): Promise<{ level: ImportedSessionLog['level']; reasons: string[]; events: ImportedSessionEvent[]; sessionId: string }> {
  const facts = record(input['facts']);
  const sessionId = typeof facts?.['sessionId'] === 'string' ? facts['sessionId'] : '';
  const nonce = typeof facts?.['nonce'] === 'string' ? facts['nonce'] : '';
  const publicKey = typeof facts?.['sessionPublicKey'] === 'string' ? facts['sessionPublicKey'] : '';
  const rawEvents = input['events'];
  if (!facts || !sessionId || sessionId.length > 160 || !/^[0-9a-f]{32}$/i.test(nonce) || !/^[0-9a-f]{64}$/i.test(publicKey) ||
    !Array.isArray(rawEvents) || rawEvents.length === 0 || rawEvents.length > 200) {
    throw new Error('Invalid vv-session-log/1 facts or empty event chain.');
  }
  const genesis = await sha256Hex(`vv-crypto-1:session\n${nonce}`);
  let previous = genesis;
  const normalized: ImportedSessionEvent[] = [];
  for (let index = 0; index < rawEvents.length; index += 1) {
    const event = record(rawEvents[index]) as unknown as LegacySignedEvent | null;
    if (!event || event.seq !== index || event.prevHash !== previous || !record(event.payload) ||
      !/^[0-9a-f]{64}$/i.test(event.hash) || !/^[0-9a-f]{128}$/i.test(event.sig)) {
      throw new Error(`Invalid session chain at event ${index}.`);
    }
    const expected = await sha256Hex(`vv-crypto-1:event\n${event.seq}\n${event.prevHash}\n${canonical(event.payload)}`);
    if (expected !== event.hash || !(await signatureValid(publicKey, event.hash, event.sig))) {
      throw new Error(`Session hash or signature verification failed at event ${index}.`);
    }
    previous = event.hash;
    const payload = record(event.payload) ?? {};
    const at = typeof payload['at'] === 'string' && Number.isFinite(Date.parse(payload['at']))
      ? new Date(payload['at']).toISOString()
      : '';
    if (!at) throw new Error(`Invalid event timestamp at event ${index}.`);
    const kind = payload['type'] === 'file_edit' ? 'file_edit'
      : payload['type'] === 'test_run' ? 'test_run'
        : 'note';
    const details = typeof payload['note'] === 'string' ? payload['note']
      : typeof payload['promptText'] === 'string' ? payload['promptText']
        : kind === 'file_edit' ? 'File edit observed'
          : kind === 'test_run' ? 'Test run observed'
            : 'Session event observed';
    normalized.push({
      id: `${sessionId}:${index}`,
      at,
      actor: 'system',
      type: kind,
      text: redact(details),
    });
  }
  const retroactive = facts['provenance'] === 'retroactive';
  return {
    sessionId,
    level: 'L1',
    reasons: [
      `chain_valid:${normalized.length}_events`,
      'self_supplied_keys_and_anchors_not_independently_authenticated',
      retroactive ? 'retroactive_log' : 'exported_log',
    ],
    events: normalized,
  };
}

function parseNormalized(input: Record<string, unknown>): ImportedSessionLog {
  if (!Array.isArray(input['events']) || input['events'].length === 0 || input['events'].length > 200 ||
    typeof input['session_id'] !== 'string' || input['session_id'].length > 160) {
    throw new Error('The normalized session log requires session_id and a non-empty events array.');
  }
  const events = input['events'].map((raw, index): ImportedSessionEvent => {
    const item = record(raw);
    if (!item || typeof item['at'] !== 'string' || !Number.isFinite(Date.parse(item['at'])) ||
      !['user', 'assistant', 'tool', 'system'].includes(String(item['actor'])) ||
      !['message', 'tool_use', 'file_edit', 'test_run', 'note'].includes(String(item['type'])) ||
      typeof item['text'] !== 'string' || item['text'].length > 20_000 ||
      (item['id'] !== undefined && (typeof item['id'] !== 'string' || !item['id'] || item['id'].length > 240))) {
      throw new Error(`Invalid normalized session event at index ${index}.`);
    }
    return {
      id: typeof item['id'] === 'string' ? item['id'] : `${input['session_id']}:${index}`,
      at: new Date(item['at']).toISOString(),
      actor: item['actor'] as ImportedSessionEvent['actor'],
      type: item['type'] as ImportedSessionEvent['type'],
      text: redact(item['text']),
    };
  });
  if (new Set(events.map((event) => event.id)).size !== events.length) {
    throw new Error('The normalized session log contains duplicate event IDs.');
  }
  return {
    sessionId: input['session_id'],
    format: 'attest-session-log/1',
    level: 'L0',
    reasons: ['candidate_supplied_normalized_log'],
    events,
  };
}

export async function parseSessionLogText(text: string): Promise<ImportedSessionLog> {
  if (text.length > 5_000_000) throw new Error('Session log exceeds the 5 MB import limit.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const object = record(parsed);
  if (object?.['version'] === 'vv-session-log/1') {
    const verified = await verifyLegacyLog(object);
    return { ...verified, format: 'vv-session-log/1' };
  }
  if (object?.['version'] === 'attest-session-log/1') return parseNormalized(object);

  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error('The session log is empty.');
  const events: ImportedSessionEvent[] = [];
  let sessionId = '';
  for (const [index, line] of lines.entries()) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON on line ${index + 1}.`);
    }
    const item = record(raw);
    if (!item) throw new Error(`Expected a JSON object on line ${index + 1}.`);
    if (item['type'] !== 'user' && item['type'] !== 'assistant') continue;
    const message = record(item['message']);
    const blocks = textFromClaudeContent(message?.['content'] ?? item['content'], item['type']);
    const atValue = item['timestamp'] ?? item['ts'];
    if (blocks.length === 0) continue;
    if (typeof atValue !== 'string' || !Number.isFinite(Date.parse(atValue))) {
      throw new Error(`Missing or invalid timestamp on line ${index + 1}.`);
    }
    if (typeof item['sessionId'] === 'string') sessionId = item['sessionId'];
    for (const block of blocks) {
      if (events.length === 200) throw new Error('Session log contains more than 200 supported events; split it into smaller logs.');
      events.push({
        id: typeof item['uuid'] === 'string' ? `${item['uuid']}:${events.length}` : `line:${index + 1}:${events.length}`,
        at: new Date(atValue).toISOString(),
        actor: item['type'],
        type: block.type,
        text: redact(block.text),
      });
    }
  }
  if (events.length === 0) throw new Error('No supported Claude Code user, assistant, or tool events were found.');
  if (!sessionId) sessionId = `claude-${(await sha256Hex(text)).slice(0, 24)}`;
  return {
    sessionId,
    format: 'claude-code-jsonl',
    level: 'L0',
    reasons: ['native_session_export_unverified'],
    events: events.slice(-200),
  };
}

export async function sessionEvidenceFromImport(log: ImportedSessionLog, startingHash = GENESIS_HASH): Promise<SessionEvidence[]> {
  let previousHash = startingHash;
  const output: SessionEvidence[] = [];
  for (const event of log.events) {
    const id = crypto.randomUUID();
    const base = {
      id,
      claim_type: event.type === 'test_run' ? 'testing'
        : event.type === 'file_edit' ? 'implementation'
          : event.type === 'tool_use' ? 'tool-use'
            : event.actor === 'user' ? 'problem-framing'
              : 'ai-collaboration',
      claim_value: `${event.actor} ${event.type.replace(/_/g, ' ')}: ${event.text.slice(0, 150)}`,
      source: 'session' as const,
      status: log.level === 'L0' || log.level === 'L1' ? 'Unverified' as const : 'Supported' as const,
      confidence: null,
      captured_at: Date.parse(event.at),
    };
    const reference = {
      session_id: log.sessionId,
      format: log.format,
      event_id: event.id,
      event_type: event.type,
      actor: event.actor,
      occurred_at: event.at,
      quote: event.text,
      verification_level: log.level,
      verification_reasons: log.reasons,
    };
    const chainHash = await createChainHash(previousHash, base, reference);
    output.push({
      ...base,
      evidence_ref: { ...reference, previous_hash: previousHash, chain_hash: chainHash },
    });
    previousHash = chainHash;
  }
  return output;
}
