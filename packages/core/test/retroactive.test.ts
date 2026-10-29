import { describe, expect, it } from 'vitest';
import {
  anchorDigest,
  generateSessionKeypair,
  genesisPrevHashFromNonce,
  hashEventStruct,
  observationPayloadHash,
  signHashHex,
  verifySession,
} from '../src/node.js';
import type { AnchorReceipt, HarnessFacts, SignedEvent } from '../src/index.js';

const SESSION_ID = '99999999-9999-9999-9999-999999999999';
const NONCE = 'ab'.repeat(16);
const SERVER_TIME = '2026-10-29T00:00:00.000Z';

function mintChain(length: number, privateKey: string): SignedEvent[] {
  const events: SignedEvent[] = [];
  let prev = genesisPrevHashFromNonce(NONCE);
  for (let seq = 0; seq < length; seq += 1) {
    const payload = { step: seq };
    const hash = hashEventStruct({ seq, prevHash: prev, payload });
    events.push({ seq, prevHash: prev, payload, hash, sig: signHashHex(privateKey, hash) });
    prev = hash;
  }
  return events;
}

function setup(provenance?: 'live' | 'retroactive') {
  const session = generateSessionKeypair();
  const server = generateSessionKeypair();
  const events = mintChain(3, session.privateKey);
  const facts: HarnessFacts = {
    sessionId: SESSION_ID,
    nonce: NONCE,
    sessionPublicKey: session.publicKey,
    anchorPublicKey: server.publicKey,
    observations: events.map((e) => ({ seq: e.seq, payloadHash: observationPayloadHash(e.payload) })),
    ...(provenance === undefined ? {} : { provenance }),
  };
  const head = events[events.length - 1];
  const digest = anchorDigest({ sessionId: SESSION_ID, seq: head.seq, headHash: head.hash, serverTime: SERVER_TIME });
  const anchors: AnchorReceipt[] = [
    { sessionId: SESSION_ID, seq: head.seq, headHash: head.hash, serverTime: SERVER_TIME, signature: signHashHex(server.privateKey, digest) },
  ];
  return { events, facts, anchors };
}

describe('retroactive provenance', () => {
  it('caps a valid chain with a matching server anchor at L2 and lists the reasons', () => {
    const { events, facts, anchors } = setup('retroactive');
    expect(verifySession(events, anchors, facts)).toEqual({
      level: 'L2',
      reasons: ['chain_valid:3_events', 'anchors_match:1', 'retroactive_anchored_cap'],
    });
  });

  it('caps a valid chain without anchors at L1 and lists the reason', () => {
    const { events, facts } = setup('retroactive');
    expect(verifySession(events, [], facts)).toEqual({
      level: 'L1',
      reasons: ['chain_valid:3_events', 'retroactive_unanchored_cap'],
    });
  });

  it('fails closed at L1 with the specific reason for a forged anchor', () => {
    const { events, facts, anchors } = setup('retroactive');
    const forged = [{ ...anchors[0], signature: `${anchors[0].signature.slice(0, 126)}ff` }];
    expect(verifySession(events, forged, facts)).toEqual({
      level: 'L1',
      reasons: ['chain_valid:3_events', 'anchor_signature_invalid@seq:2', 'retroactive_unanchored_cap'],
    });
  });

  it('still fails a tampered retroactive chain at L0', () => {
    const { events, facts, anchors } = setup('retroactive');
    const tampered = events.map((e, i) => (i === 1 ? { ...e, payload: { step: 'forged' } } : e));
    const verdict = verifySession(tampered, anchors, facts);
    expect(verdict.level).toBe('L0');
    expect(verdict.reasons).toEqual(['chain_break:hash_mismatch@seq:1']);
  });

  it('leaves explicit live provenance uncapped', () => {
    const { events, facts, anchors } = setup('live');
    expect(verifySession(events, anchors, facts).level).toBe('L4');
  });
});
