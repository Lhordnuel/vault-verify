import { describe, expect, it } from 'vitest';
import {
  anchorDigest,
  generateSessionKeypair,
  genesisPrevHashFromNonce,
  hashEventStruct,
  observationPayloadHash,
  signHashHex,
} from '../src/node.js';
import { parseSessionLogText, type HarnessFacts, type SessionLog } from '../src/index.js';

const SESSION_ID = '66666666-6666-6666-6666-666666666666';
const NONCE = 'ee'.repeat(16);

function validLog(): SessionLog {
  const session = generateSessionKeypair();
  const server = generateSessionKeypair();
  let prev = genesisPrevHashFromNonce(NONCE);
  const payload = { step: 0 };
  const hash = hashEventStruct({ seq: 0, prevHash: prev, payload });
  const events = [{ seq: 0, prevHash: prev, payload, hash, sig: signHashHex(session.privateKey, hash) }];
  const facts: HarnessFacts = {
    sessionId: SESSION_ID,
    nonce: NONCE,
    sessionPublicKey: session.publicKey,
    anchorPublicKey: server.publicKey,
    observations: [{ seq: 0, payloadHash: observationPayloadHash(payload) }],
  };
  const serverTime = '2026-10-29T00:00:00.000Z';
  const digest = anchorDigest({ sessionId: SESSION_ID, seq: 0, headHash: hash, serverTime });
  return {
    version: 'vv-session-log/1',
    facts,
    events,
    anchors: [
      { sessionId: SESSION_ID, seq: 0, headHash: hash, serverTime, signature: signHashHex(server.privateKey, digest) },
    ],
  };
}

describe('parseSessionLogText', () => {
  it('accepts a valid session log', () => {
    const parsed = parseSessionLogText(JSON.stringify(validLog()));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.events).toHaveLength(1);
      expect(parsed.data.version).toBe('vv-session-log/1');
    }
  });

  it('rejects non-JSON with a plain issue', () => {
    expect(parseSessionLogText('{oops')).toEqual({ ok: false, issues: ['not valid JSON'] });
  });

  it('reports schema issues with paths', () => {
    const log = validLog() as unknown as Record<string, unknown>;
    const parsed = parseSessionLogText(JSON.stringify({ ...log, version: 'vv-session-log/9' }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issues.length).toBeGreaterThan(0);
      expect(parsed.issues[0]).toMatch(/version/);
    }
  });
});
