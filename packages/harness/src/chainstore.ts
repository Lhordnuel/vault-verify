import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  EvidenceKindSchema,
  IsoDateTimeSchema,
  SignedEventSchema,
  type SignedEvent,
} from '@vault-verify/core';
import { genesisPrevHashFromNonce, hashEventStruct, signHashHex } from '@vault-verify/core/node';

/** One persisted chain line: the signed event plus collection metadata. */
export interface ChainRecord {
  event: SignedEvent;
  kind: string;
  collectedAt: string;
  summary?: string;
}

export async function loadChainRecords(file: string): Promise<ChainRecord[]> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return [];
    throw error;
  }
  const records: ChainRecord[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const parsed = JSON.parse(line) as { event?: unknown; kind?: unknown; collectedAt?: unknown; summary?: unknown };
    const summary: unknown = parsed.summary;
    records.push({
      event: SignedEventSchema.parse(parsed.event),
      kind: EvidenceKindSchema.parse(parsed.kind),
      collectedAt: IsoDateTimeSchema.parse(parsed.collectedAt),
      ...(typeof summary === 'string' ? { summary } : {}),
    });
  }
  return records;
}

export async function appendChainRecord(args: {
  file: string;
  sessionNonce: string;
  privateKeyHex: string;
  kind: string;
  payload: unknown;
  summary?: string;
}): Promise<ChainRecord> {
  const kind = EvidenceKindSchema.parse(args.kind);
  const records = await loadChainRecords(args.file);
  const seq = records.length;
  const prevHash = seq === 0 ? genesisPrevHashFromNonce(args.sessionNonce) : records[seq - 1].event.hash;
  const hash = hashEventStruct({ seq, prevHash, payload: args.payload });
  const sig = signHashHex(args.privateKeyHex, hash);
  const record: ChainRecord = {
    event: { seq, prevHash, payload: args.payload, hash, sig },
    kind,
    collectedAt: new Date().toISOString(),
    ...(args.summary === undefined ? {} : { summary: args.summary }),
  };
  await mkdir(dirname(args.file), { recursive: true });
  await appendFile(args.file, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}
