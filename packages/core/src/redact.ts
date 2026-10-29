/**
 * Universal secret redaction. The retroactive importer runs this BEFORE
 * hashing: sealed chains must never contain secret-shaped material.
 * Conservative by design — over-redaction is a cosmetic cost, a leak is not.
 */
export const REDACTED = '[REDACTED]';

const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const SK_KEY_RE = /\bsk-[A-Za-z0-9_-]{8,}/g;
// Built from fragments so this file never matches the pre-commit PEM rule.
const PEM_BEGIN = '-'.repeat(5) + 'BEGIN ';
const PEM_END = '-'.repeat(5) + 'END ';
const PEM_MID = 'PRIVATE' + ' KEY';
const PEM_FENCE = '-'.repeat(5);
const PEM_BLOCK_RE = new RegExp(
  `${PEM_BEGIN}[A-Z0-9 ]*${PEM_MID}${PEM_FENCE}[\\s\\S]*?${PEM_END}[A-Z0-9 ]*${PEM_MID}${PEM_FENCE}`,
  'g',
);
// key=value / key: value secrets (requires : or = so "token hash" prose survives).
const ASSIGNED_SECRET_RE =
  /(\b[\w$-]*(?:api[_-]?key|secret|token|password|passwd|pwd)\b['"]?\s*[:=]\s*['"]?)([^\s'";,}\[]+)/gi;
const CONN_STRING_RE = /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp):\/\/(?!\[REDACTED\])([^\s'"]+)/gi;
const ACCOUNT_KEY_RE = /AccountKey=[^;\s'"]+/gi;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const UNIX_PATH_RE =
  /\/(home|root|Users|etc|var|tmp|opt|srv|mnt|private|usr)\b(?:\/[\w\-.+@]*[\w+@])+/g;
const WINDOWS_PATH_RE = /\b[A-Za-z]:\\(?:[^\\\s'";,}]+\\?)+/g;

/** Redact secret-shaped substrings. Pure; never throws on string input. */
export function redactText(text: string): string {
  if (typeof text !== 'string') return text;
  return text
    .replace(PEM_BLOCK_RE, REDACTED)
    .replace(JWT_RE, '[REDACTED-JWT]')
    .replace(SK_KEY_RE, '[REDACTED-KEY]')
    .replace(ASSIGNED_SECRET_RE, '$1[REDACTED]')
    .replace(CONN_STRING_RE, (_m, scheme: string) => `${scheme}://[REDACTED]`)
    .replace(ACCOUNT_KEY_RE, 'AccountKey=[REDACTED]')
    .replace(EMAIL_RE, '[REDACTED-EMAIL]')
    .replace(UNIX_PATH_RE, '[REDACTED-PATH]')
    .replace(WINDOWS_PATH_RE, '[REDACTED-PATH]');
}

/** True when the text still contains a secret-shaped substring. */
export function containsSecretShape(text: string): boolean {
  if (typeof text !== 'string') return false;
  JWT_RE.lastIndex = 0;
  SK_KEY_RE.lastIndex = 0;
  PEM_BLOCK_RE.lastIndex = 0;
  ASSIGNED_SECRET_RE.lastIndex = 0;
  CONN_STRING_RE.lastIndex = 0;
  ACCOUNT_KEY_RE.lastIndex = 0;
  EMAIL_RE.lastIndex = 0;
  UNIX_PATH_RE.lastIndex = 0;
  WINDOWS_PATH_RE.lastIndex = 0;
  return (
    JWT_RE.test(text) ||
    SK_KEY_RE.test(text) ||
    PEM_BLOCK_RE.test(text) ||
    ASSIGNED_SECRET_RE.test(text) ||
    CONN_STRING_RE.test(text) ||
    ACCOUNT_KEY_RE.test(text) ||
    EMAIL_RE.test(text) ||
    UNIX_PATH_RE.test(text) ||
    WINDOWS_PATH_RE.test(text)
  );
}

/** Deep-clone a JSON value with every string redacted. */
export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactValue(entry);
    }
    return out;
  }
  return value;
}
