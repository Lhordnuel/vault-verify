import type { EvidenceAdapter } from '@vault-verify/core';

export const adapterId = 'adapter/claude-code';

/** Tier 2 Claude Code adapter (stub — not implemented). */
export const adapter: EvidenceAdapter = {
  id: adapterId,
  agent: 'claude-code',
  tier: 2,
  async collect() {
    throw new Error(`[${adapterId}] not implemented (scaffold only)`);
  },
};

export default adapter;
