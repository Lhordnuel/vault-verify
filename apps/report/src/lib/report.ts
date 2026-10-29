import {
  FluencyReportSchema,
  TimelineMomentSchema,
  type FluencyReport,
  type TimelineMoment,
} from '@vault-verify/core';
import reportJson from '../fixtures/report.json' with { type: 'json' };
import timelineJson from '../fixtures/timeline.json' with { type: 'json' };
import validLogJson from '../fixtures/session-log.json' with { type: 'json' };
import tamperedLogJson from '../fixtures/session-log-tampered.json' with { type: 'json' };

/** Phase 4 reads fixtures only — no database connection. */
export const report: FluencyReport = FluencyReportSchema.parse(reportJson);

export const timeline: TimelineMoment[] = (timelineJson as unknown[]).map((moment) =>
  TimelineMomentSchema.parse(moment),
);

export const validLogText: string = JSON.stringify(validLogJson, null, 2);

export const tamperedLogText: string = JSON.stringify(tamperedLogJson, null, 2);

export function formatScore(score: number | null): string {
  return score === null ? 'Insufficient evidence' : `${Math.round(score * 100)} / 100`;
}
