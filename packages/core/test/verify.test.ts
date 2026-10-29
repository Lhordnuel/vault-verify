import { describe, expect, it } from 'vitest';
import {
  anchorDigest,
  generateSessionKeypair,
  genesisPrevHashFromNonce,
  hashEventStruct,
  observationPayloadHash,
  signHashHex,
  verifyAnchorReceipt,
  verifyChain,
  verifySession,
} from '../src/node.js';
import type { AnchorReceipt, HarnessFacts, SignedEvent } from '../src/index.js';

const SESSION_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_SESSION_ID = '22222222-2222-2222-2222-222222222222';
const NONCE = 'aa'.repeat(16);
const OTHER_NONCE = 'bb'.repeat(16);
const SERVER_TIME = '2026-10-28T00:00:00.000Z';

function mintChain(length: number, privateKey: string, nonce: string): SignedEvent[] {
  const events: SignedEvent[] = [];
  let prev = genesisPrevHashFromNonce(nonce);
  for (let seq = 0; seq < length; seq += 1) {
    const payload = { step: seq, note: `event-${seq}` };
    const hash = hashEventStruct({ seq, prevHash: prev, payload });
    events.push({ seq, prevHash: prev, payload, hash, sig: signHashHex(privateKey, hash) });
    prev = hash;
  }
  return events;
}

function factsFor(
  events: SignedEvent[],
  sessionPublicKey: string,
  anchorPublicKey: string,
  nonce: string = NONCE,
): HarnessFacts {
  return {
    sessionId: SESSION_ID,
    nonce,
    sessionPublicKey,
    anchorPublicKey,
    observations: events.map((e) => ({ seq: e.seq, payloadHash: observationPayloadHash(e.payload) })),
  };
}

function receiptFor(
  head: SignedEvent,
  serverSeed: string,
  sessionId: string = SESSION_ID,
  serverTime: string = SERVER_TIME,
): AnchorReceipt {
  const digest = anchorDigest({ sessionId, seq: head.seq, headHash: head.hash, serverTime });
  return { sessionId, seq: head.seq, headHash: head.hash, serverTime, signature: signHashHex(serverSeed, digest) };
}

function setup() {
  const session = generateSessionKeypair();
  const server = generateSessionKeypair();
  const events = mintChain(3, session.privateKey, NONCE);
  return { session, server, events };
}

describe('verifyChain', () => {
  it('accepts a clean chain', () => {
    const { session, events } = setup();
    const genesis = genesisPrevHashFromNonce(NONCE);
    const result = verifyChain(events, session.publicKey, { expectedGenesisPrevHash: genesis });
    expect(result).toEqual({ ok: true, count: 3 });
  });

  it('reports an edited payload', () => {
    const { session, events } = setup();
    const tampered = events.map((e, i) => (i === 1 ? { ...e, payload: { step: 1, note: 'forged' } } : e));
    const result = verifyChain(tampered, session.publicKey, {
      expectedGenesisPrevHash: genesisPrevHashFromNonce(NONCE),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.break.reason).toBe('hash_mismatch');
      expect(result.break.seq).toBe(1);
    }
  });

  it('reports a deleted event as a sequence gap', () => {
    const { session, events } = setup();
    const tampered = [events[0], events[2]];
    const result = verifyChain(tampered, session.publicKey, {
      expectedGenesisPrevHash: genesisPrevHashFromNonce(NONCE),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.break.reason).toBe('seq_discontinuity');
      expect(result.break.index).toBe(1);
    }
  });

  it('reports reordered events', () => {
    const { session, events } = setup();
    const tampered = [events[1], events[0], events[2]];
    const result = verifyChain(tampered, session.publicKey, {
      expectedGenesisPrevHash: genesisPrevHashFromNonce(NONCE),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.break.reason).toBe('seq_discontinuity');
      expect(result.break.index).toBe(0);
    }
  });

  it('reports a bad signature', () => {
    const { session, events } = setup();
    const tampered = events.map((e, i) => (i === 2 ? { ...e, sig: `${e.sig.slice(0, -1)}0` } : e));
    const result = verifyChain(tampered, session.publicKey, {
      expectedGenesisPrevHash: genesisPrevHashFromNonce(NONCE),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.break.reason).toBe('signature_invalid');
      expect(result.break.seq).toBe(2);
    }
  });

  it('reports an empty chain', () => {
    const { session } = setup();
    const result = verifyChain([], session.publicKey);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.break.reason).toBe('empty_chain');
  });
});

describe('verifySession levels', () => {
  it('verifies a clean session at L3 without anchors', () => {
    const { session, server, events } = setup();
    const verdict = verifySession(events, [], factsFor(events, session.publicKey, server.publicKey));
    expect(verdict.level).toBe('L3');
    expect(verdict.reasons.join(' ')).toContain('chain_valid:3_events');
  });

  it('verifies at L4 with matching anchors and agreeing facts', () => {
    const { session, server, events } = setup();
    const anchors = [receiptFor(events[2], server.privateKey)];
    const verdict = verifySession(
      events,
      anchors,
      factsFor(events, session.publicKey, server.publicKey),
    );
    expect(verdict.level).toBe('L4');
    expect(verdict.reasons.join(' ')).toContain('anchors_match:1');
    expect(verdict.reasons.join(' ')).toContain('harness_agrees:3/3');
  });

  it('rejects a replayed chain under a new nonce', () => {
    const { session, server, events } = setup();
    const verdict = verifySession(
      events,
      [],
      factsFor(events, session.publicKey, server.publicKey, OTHER_NONCE),
    );
    expect(verdict.level).toBe('L0');
    expect(verdict.reasons.join(' ')).toContain('genesis_prev_hash_mismatch');
  });

  it('rejects a forged anchor with a specific reason', () => {
    const { session, server, events } = setup();
    const attacker = generateSessionKeypair();
    const anchors = [receiptFor(events[2], attacker.privateKey)];
    const verdict = verifySession(
      events,
      anchors,
      factsFor(events, session.publicKey, server.publicKey),
    );
    expect(verdict.level).toBe('L3');
    expect(verdict.reasons.join(' ')).toContain('anchor_signature_invalid@seq:2');
  });

  it('rejects an anchor whose head does not match', () => {
    const { session, server, events } = setup();
    const digest = anchorDigest({ sessionId: SESSION_ID, seq: 2, headHash: events[0].hash, serverTime: SERVER_TIME });
    const anchors: AnchorReceipt[] = [
      { sessionId: SESSION_ID, seq: 2, headHash: events[0].hash, serverTime: SERVER_TIME, signature: signHashHex(server.privateKey, digest) },
    ];
    const verdict = verifySession(
      events,
      anchors,
      factsFor(events, session.publicKey, server.publicKey),
    );
    expect(verdict.level).toBe('L3');
    expect(verdict.reasons.join(' ')).toContain('anchor_head_mismatch@seq:2');
  });

  it('rejects an anchor beyond the chain', () => {
    const { session, server, events } = setup();
    const digest = anchorDigest({ sessionId: SESSION_ID, seq: 99, headHash: events[2].hash, serverTime: SERVER_TIME });
    const anchors: AnchorReceipt[] = [
      { sessionId: SESSION_ID, seq: 99, headHash: events[2].hash, serverTime: SERVER_TIME, signature: signHashHex(server.privateKey, digest) },
    ];
    const verdict = verifySession(
      events,
      anchors,
      factsFor(events, session.publicKey, server.publicKey),
    );
    expect(verdict.level).toBe('L3');
    expect(verdict.reasons.join(' ')).toContain('anchor_seq_beyond_chain@seq:99');
  });

  it('rejects an anchor for another session', () => {
    const { session, server, events } = setup();
    const anchors = [receiptFor(events[2], server.privateKey, OTHER_SESSION_ID)];
    const verdict = verifySession(
      events,
      anchors,
      factsFor(events, session.publicKey, server.publicKey),
    );
    expect(verdict.level).toBe('L3');
    expect(verdict.reasons.join(' ')).toContain('anchor_session_mismatch@seq:2');
  });

  it('rejects disagreeing harness facts', () => {
    const { session, server, events } = setup();
    const facts = factsFor(events, session.publicKey, server.publicKey);
    facts.observations[1] = { seq: 1, payloadHash: '00'.repeat(32) };
    const anchors = [receiptFor(events[2], server.privateKey)];
    const verdict = verifySession(events, anchors, facts);
    expect(verdict.level).toBe('L3');
    expect(verdict.reasons.join(' ')).toContain('harness_payload_mismatch@seq:1');
  });

  it('rejects incomplete harness coverage', () => {
    const { session, server, events } = setup();
    const facts = factsFor(events, session.publicKey, server.publicKey);
    facts.observations = facts.observations.filter((o) => o.seq !== 1);
    const anchors = [receiptFor(events[2], server.privateKey)];
    const verdict = verifySession(events, anchors, facts);
    expect(verdict.level).toBe('L3');
    expect(verdict.reasons.join(' ')).toContain('harness_coverage_gap@seq:1');
  });

  it('returns L0 for an empty chain', () => {
    const { session, server } = setup();
    const verdict = verifySession([], [], factsFor([], session.publicKey, server.publicKey));
    expect(verdict.level).toBe('L0');
    expect(verdict.reasons.join(' ')).toContain('empty_chain');
  });
});

describe('verifyAnchorReceipt', () => {
  it('accepts a valid receipt and rejects tampering', () => {
    const { server, events } = setup();
    const receipt = receiptFor(events[1], server.privateKey);
    expect(verifyAnchorReceipt(receipt, server.publicKey)).toBe(true);
    expect(verifyAnchorReceipt({ ...receipt, headHash: events[0].hash }, server.publicKey)).toBe(false);
    const other = generateSessionKeypair();
    expect(verifyAnchorReceipt(receipt, other.publicKey)).toBe(false);
  });
});
