import { describe, expect, it } from 'vitest';
import { containsSecretShape, redactText, redactValue } from '../src/redact.js';

// Secret-shaped fixtures are built from fragments at runtime so this file
// never contains a committable secret pattern (see scripts/check-secrets).
const JWT = `eyJ${'A'.repeat(12)}.${'B'.repeat(12)}.${'C'.repeat(12)}`;
const SK = `sk-${'D'.repeat(24)}`;
const PRIV = ['PRIVATE', 'KEY'].join(' ');
const PEM = `-----BEGIN ${PRIV}-----\n${'E'.repeat(64)}\n-----END ${PRIV}-----`;

describe('redactText', () => {
  it('redacts JWTs', () => {
    const out = redactText(`auth ${JWT} done`);
    expect(out).not.toContain(JWT);
    expect(out).toContain('[REDACTED-JWT]');
  });

  it('redacts sk-style keys, including test-prefixed ones', () => {
    expect(redactText(`key=${SK}`)).toContain('[REDACTED-KEY]');
    expect(redactText('key=sk-test-FAKEKEY123')).toContain('[REDACTED-KEY]');
  });

  it('redacts assigned secrets but leaves "token hash" prose alone', () => {
    expect(redactText('password=hunter2 ok')).toBe('password=[REDACTED] ok');
    expect(redactText('apiKey: "abc123"')).toBe('apiKey: "[REDACTED]"');
    expect(redactText('api_token=demo-fake-9')).toBe('api_token=[REDACTED]');
    expect(redactText('secretion = 5')).toBe('secretion = 5');
    expect(redactText('store the token hash')).toBe('store the token hash');
  });

  it('redacts connection strings, keeping the scheme', () => {
    const out = redactText('db postgres://demo:FAKEPASS@db:5432/app live');
    expect(out).not.toContain('FAKEPASS');
    expect(out).toContain('postgres://[REDACTED]');
  });

  it('redacts emails', () => {
    expect(redactText('mail ada@example.com here')).toContain('[REDACTED-EMAIL]');
  });

  it('redacts absolute local paths, keeps relative ones', () => {
    expect(redactText('open /home/demo/proj/app.ts')).toContain('[REDACTED-PATH]');
    expect(redactText('open C:\\Users\\demo\\proj\\app.ts')).toContain('[REDACTED-PATH]');
    expect(redactText('open src/app.ts')).toBe('open src/app.ts');
  });

  it('redacts PEM private key blocks', () => {
    expect(redactText(`k:${PEM}:k`)).toBe('k:[REDACTED]:k');
  });
});

describe('redactValue', () => {
  it('deep-redacts objects and arrays', () => {
    const out = redactValue({
      cmd: 'deploy',
      env: { token: `token=${SK}`, nested: ['mail bob@example.com'] },
      count: 3,
      keep: null,
    }) as { env: { token: string; nested: string[] }; count: number; keep: null };
    expect(out.env.token).toContain('[REDACTED-KEY]');
    expect(out.env.nested[0]).toContain('[REDACTED-EMAIL]');
    expect(out.count).toBe(3);
    expect(out.keep).toBeNull();
  });
});

describe('containsSecretShape', () => {
  it('detects leftover secret shapes', () => {
    expect(containsSecretShape(`x ${JWT}`)).toBe(true);
    expect(containsSecretShape('mail zed@example.com')).toBe(true);
    expect(containsSecretShape('open src/app.ts')).toBe(false);
    expect(containsSecretShape(redactText(`x ${JWT} y`))).toBe(false);
  });

  it('is idempotent: redacted output never re-matches', () => {
    const dirty = `a ${JWT} b ${SK} c password=x d postgres://u:pw@h/db e f@g.com f /home/u/x g C:\\u\\x h ${PEM}`;
    const once = redactText(dirty);
    expect(containsSecretShape(once)).toBe(false);
    expect(redactText(once)).toBe(once);
  });
});
