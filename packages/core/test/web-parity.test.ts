import { describe, expect, it } from 'vitest';
import {
  anchorDigest,
  generateSessionKeypair,
  genesisPrevHashFromNonce,
  hashEventStruct,
  observationPayloadHash,
  signHashHex,
  verifySession as verifySessionNode,
} from '../src/node.js';
import { verifySession as verifySessionWeb } from '../src/verify.web.js';
import type { AnchorReceipt, HarnessFacts, SignedEvent } from '../src/index.js';

const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const NONCE = 'cc'.repeat(16);
const SERVER_TIME = '2026-10-29T00:00:00.000Z';

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

function fullFacts(events: SignedEvent[], sessionPublicKey: string, anchorPublicKey: string): HarnessFacts {
  return {
    sessionId: SESSION_ID,
    nonce: NONCE,
    sessionPublicKey,
    anchorPublicKey,
    observations: events.map((e) => ({ seq: e.seq, payloadHash: observationPayloadHash(e.payload) })),
  };
}

function receiptFor(head: SignedEvent, serverSeed: string): AnchorReceipt {
  const digest = anchorDigest({ sessionId: SESSION_ID, seq: head.seq, headHash: head.hash, serverTime: SERVER_TIME });
  return {
    sessionId: SESSION_ID,
    seq: head.seq,
    headHash: head.hash,
    serverTime: SERVER_TIME,
    signature: signHashHex(serverSeed, digest),
  };
}

function setup() {
  const session = generateSessionKeypair();
  const server = generateSessionKeypair();
  const events = mintChain(4, session.privateKey, NONCE);
  const facts = fullFacts(events, session.publicKey, server.publicKey);
  const anchors = [receiptFor(events[3], server.privateKey)];
  return { session, server, events, facts, anchors };
}

describe('web/node verify parity', () => {
  it('agrees on a clean L4 session', () => {
    const { events, facts, anchors } = setup();
    const nodeVerdict = verifySessionNode(events, anchors, facts);
    const webVerdict = verifySessionWeb(events, anchors, facts);
    expect(nodeVerdict).toEqual({ level: 'L4', reasons: expect.any(Array) });
    expect(webVerdict).toEqual(nodeVerdict);
  });

  it('agrees on L3 without anchors', () => {
    const { events, facts } = setup();
    expect(verifySessionWeb(events, [], facts)).toEqual(verifySessionNode(events, [], facts));
  });

  it('agrees on the first break of a tampered chain', () => {
    const { events, facts, anchors } = setup();
    const tampered = events.map((e, i) =>
      i === 2 ? { ...e, payload: { step: 2, note: 'forged' } } : e,
    );
    const nodeVerdict = verifySessionNode(tampered, anchors, facts);
    expect(nodeVerdict.level).toBe('L0');
    expect(verifySessionWeb(tampered, anchors, facts)).toEqual(nodeVerdict);
  });

  it('agrees on reordered events', () => {
    const { events, facts, anchors } = setup();
    const reordered = [events[0], events[2], events[1], events[3]];
    expect(verifySessionWeb(reordered, anchors, facts)).toEqual(
      verifySessionNode(reordered, anchors, facts),
    );
  });

  it('agrees on a forged anchor', () => {
    const { events, facts, anchors } = setup();
    const forged = [{ ...anchors[0], signature: `${anchors[0].signature.slice(0, 126)}ff` }];
    const nodeVerdict = verifySessionNode(events, forged, facts);
    expect(nodeVerdict.level).toBe('L3');
    expect(verifySessionWeb(events, forged, facts)).toEqual(nodeVerdict);
  });

  it('agrees on the retroactive anchored L2 cap', () => {
    const { events, facts, anchors } = setup();
    const retro = { ...facts, provenance: 'retroactive' } as HarnessFacts;
    const nodeVerdict = verifySessionNode(events, anchors, retro);
    expect(nodeVerdict.level).toBe('L2');
    expect(verifySessionWeb(events, anchors, retro)).toEqual(nodeVerdict);
  });

  it('agrees on the retroactive unanchored L1 cap', () => {
    const { events, facts } = setup();
    const retro = { ...facts, provenance: 'retroactive' } as HarnessFacts;
    const nodeVerdict = verifySessionNode(events, [], retro);
    expect(nodeVerdict.level).toBe('L1');
    expect(verifySessionWeb(events, [], retro)).toEqual(nodeVerdict);
  });

  it('agrees on invalid facts', () => {
    const { events, anchors } = setup();
    const badFacts = { sessionId: 'not-a-uuid' } as unknown as HarnessFacts;
    expect(verifySessionWeb(events, anchors, badFacts)).toEqual(
      verifySessionNode(events, anchors, badFacts),
    );
  });
});
