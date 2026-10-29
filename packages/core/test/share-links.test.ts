import { describe, expect, it } from 'vitest';
import {
  ShareLinkSchema,
  generateShareToken,
  hashShareToken,
  isShareLinkActive,
  recordShareView,
  type ShareLink,
} from '../src/share-links.js';

const CANDIDATE_ID = '22222222-2222-2222-2222-222222222222';
const EVIDENCE_ID = '33333333-3333-3333-3333-333333333333';

function link(overrides: Partial<ShareLink> = {}): ShareLink {
  return ShareLinkSchema.parse({
    id: '44444444-4444-4444-4444-444444444444',
    candidateId: CANDIDATE_ID,
    tokenHash: 'a'.repeat(64),
    scope: [EVIDENCE_ID],
    createdAt: '2026-10-29T00:00:00.000Z',
    expiresAt: '2026-11-29T00:00:00.000Z',
    ...overrides,
  });
}

describe('share tokens', () => {
  it('generates unique tokens with deterministic hashes', () => {
    const first = generateShareToken();
    const second = generateShareToken();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashShareToken(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashShareToken(first)).toBe(hashShareToken(first));
  });

  it('rejects empty tokens', () => {
    expect(() => hashShareToken('')).toThrow();
  });
});

describe('isShareLinkActive', () => {
  it('is active before expiry, dead after expiry or revocation', () => {
    expect(isShareLinkActive(link(), '2026-10-30T00:00:00.000Z')).toBe(true);
    expect(isShareLinkActive(link(), '2026-12-01T00:00:00.000Z')).toBe(false);
    expect(
      isShareLinkActive(link({ revokedAt: '2026-10-30T00:00:00.000Z' }), '2026-10-31T00:00:00.000Z'),
    ).toBe(false);
  });

  it('rejects links expiring before creation', () => {
    expect(() =>
      link({ createdAt: '2026-11-01T00:00:00.000Z', expiresAt: '2026-10-01T00:00:00.000Z' }),
    ).toThrow(/expiresAt must be after createdAt/);
  });
});

describe('recordShareView', () => {
  it('appends validated entries without mutating', () => {
    const log = [
      { linkId: '44444444-4444-4444-4444-444444444444', viewedAt: '2026-10-30T00:00:00.000Z' },
    ];
    const next = recordShareView(log, {
      linkId: '44444444-4444-4444-4444-444444444444',
      viewedAt: '2026-10-31T00:00:00.000Z',
      viewerNote: 'hiring review',
    });
    expect(log).toHaveLength(1);
    expect(next).toHaveLength(2);
    expect(() =>
      recordShareView(log, { linkId: 'not-a-uuid', viewedAt: '2026-10-31T00:00:00.000Z' }),
    ).toThrow();
  });
});
