import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from './primitives.js';
import { EvidenceKindSchema } from './primitives.js';
import { VerificationLevelSchema } from './levels.js';
import { AttemptPayloadSchema } from './attempts.js';

/**
 * Candidate-owned evidence, keyed to the candidate — NEVER to a company
 * role. Roles, screenings, and reports reference evidence ids only, so
 * deleting a role or screening cannot delete evidence (no cascade).
 * Reference implementation is in-memory; the ledger tables stay the store
 * of record.
 */
export const EvidenceRecordSchema = z.object({
  id: UuidSchema,
  candidateId: UuidSchema,
  kind: EvidenceKindSchema,
  level: VerificationLevelSchema,
  addedAt: IsoDateTimeSchema,
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

export const RoleRecordSchema = z.object({
  roleId: UuidSchema,
  orgId: UuidSchema.optional(),
  title: z.string().min(1).max(200),
  templateId: z.string().min(1).max(80),
  evidenceIds: z.array(UuidSchema),
});
export type RoleRecord = z.infer<typeof RoleRecordSchema>;

export const ScreeningRecordSchema = z.object({
  screeningId: UuidSchema,
  roleId: UuidSchema,
  candidateId: UuidSchema,
  evidenceIds: z.array(UuidSchema),
});
export type ScreeningRecord = z.infer<typeof ScreeningRecordSchema>;

/** A role report: baseline + uplift + evidence REFERENCES only. */
export const RoleReportSchema = z.object({
  reportId: UuidSchema,
  roleId: UuidSchema,
  candidateId: UuidSchema,
  evidenceIds: z.array(UuidSchema),
  baseline: z.number().optional(),
  uplift: z.number().min(0).optional(),
  createdAt: IsoDateTimeSchema,
});
export type RoleReport = z.infer<typeof RoleReportSchema>;

export const AttemptRecordSchema = z.object({
  id: UuidSchema,
  candidateId: UuidSchema,
  attempt: AttemptPayloadSchema,
  level: VerificationLevelSchema,
  addedAt: IsoDateTimeSchema,
});
export type AttemptRecord = z.infer<typeof AttemptRecordSchema>;

export class EvidenceLibrary {
  private readonly evidence = new Map<string, EvidenceRecord>();
  private readonly roles = new Map<string, RoleRecord>();
  private readonly screenings = new Map<string, ScreeningRecord>();
  private readonly reports = new Map<string, RoleReport>();
  private readonly attempts: AttemptRecord[] = [];

  addEvidence(record: EvidenceRecord): EvidenceRecord {
    const parsed = EvidenceRecordSchema.parse(record);
    this.evidence.set(parsed.id, parsed);
    return parsed;
  }

  getEvidence(id: string): EvidenceRecord | undefined {
    return this.evidence.get(id);
  }

  listCandidateEvidence(candidateId: string): EvidenceRecord[] {
    return [...this.evidence.values()].filter((record) => record.candidateId === candidateId);
  }

  addRole(record: RoleRecord): RoleRecord {
    const parsed = RoleRecordSchema.parse(record);
    this.roles.set(parsed.roleId, parsed);
    return parsed;
  }

  getRole(roleId: string): RoleRecord | undefined {
    return this.roles.get(roleId);
  }

  addScreening(record: ScreeningRecord): ScreeningRecord {
    const parsed = ScreeningRecordSchema.parse(record);
    this.screenings.set(parsed.screeningId, parsed);
    return parsed;
  }

  getScreening(screeningId: string): ScreeningRecord | undefined {
    return this.screenings.get(screeningId);
  }

  addRoleReport(record: RoleReport): RoleReport {
    const parsed = RoleReportSchema.parse(record);
    this.reports.set(parsed.reportId, parsed);
    return parsed;
  }

  getRoleReport(reportId: string): RoleReport | undefined {
    return this.reports.get(reportId);
  }

  /**
   * Delete a role and its screenings + reports. Evidence is NEVER touched:
   * roles hold references, not rows. Throws for unknown roles.
   */
  deleteRole(roleId: string): { removedScreenings: number; removedReports: number } {
    if (!this.roles.has(roleId)) {
      throw new Error(`[vault-verify] unknown role: ${roleId}`);
    }
    this.roles.delete(roleId);
    let removedScreenings = 0;
    for (const [id, screening] of this.screenings) {
      if (screening.roleId === roleId) {
        this.screenings.delete(id);
        removedScreenings += 1;
      }
    }
    let removedReports = 0;
    for (const [id, report] of this.reports) {
      if (report.roleId === roleId) {
        this.reports.delete(id);
        removedReports += 1;
      }
    }
    return { removedScreenings, removedReports };
  }

  /** Delete a screening. Evidence is NEVER touched. Throws when unknown. */
  deleteScreening(screeningId: string): void {
    if (!this.screenings.has(screeningId)) {
      throw new Error(`[vault-verify] unknown screening: ${screeningId}`);
    }
    this.screenings.delete(screeningId);
  }

  /**
   * Append an attempt. Append-only by construction: there is no
   * update/remove API, and every attempt is retained in insert order.
   */
  addAttempt(record: AttemptRecord): AttemptRecord {
    const parsed = AttemptRecordSchema.parse(record);
    this.attempts.push(parsed);
    return parsed;
  }

  listAttempts(candidateId: string): AttemptRecord[] {
    return this.attempts.filter((record) => record.candidateId === candidateId);
  }
}
