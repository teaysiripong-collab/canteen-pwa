import type { DbExecutor } from "@/database/client";
import { auditLogs } from "@/database/schema";
import { getRequestMetadata } from "@/lib/auth/session";

type AuditAction = (typeof auditLogs.action.enumValues)[number];

export type AuditEntry = {
  organizationId: string | null;
  userId: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  note?: string | null;
};

/**
 * Writes one audit row. Pass the transaction executor so the audit entry commits or
 * rolls back together with the change it describes.
 */
export async function writeAuditLog(executor: DbExecutor, entry: AuditEntry): Promise<void> {
  const { ipAddress, userAgent } = await getRequestMetadata();

  await executor.insert(auditLogs).values({
    organizationId: entry.organizationId,
    userId: entry.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    beforeData: entry.beforeData ?? null,
    afterData: entry.afterData ?? null,
    note: entry.note ?? null,
    ipAddress,
    userAgent,
  });
}
