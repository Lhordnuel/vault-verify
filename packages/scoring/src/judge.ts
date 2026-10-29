import type { JudgeRequest, JudgeVerdict } from '@vault-verify/core';

/**
 * Optional LLM judge for criteria that need judgment (instruction quality,
 * decomposition). Receives only redacted, derived events — never raw
 * transcripts — and every verdict must cite the event ids it relies on.
 * Judgments never affect the verification level.
 */
export interface FluencyJudge {
  judge(request: JudgeRequest): Promise<JudgeVerdict>;
}

export type MockResponder = (request: JudgeRequest) => JudgeVerdict | Promise<JudgeVerdict>;

/** Deterministic judge for tests and fixture generation. */
export class MockJudge implements FluencyJudge {
  constructor(private readonly respond: MockResponder) {}

  judge(request: JudgeRequest): Promise<JudgeVerdict> {
    return Promise.resolve().then(() => this.respond(request));
  }
}
