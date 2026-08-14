import { desc, eq } from "drizzle-orm";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { db } from "@/database/client";
import { auditLogs, users } from "@/database/schema";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { formatDateTimeTh } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ACTION_LABELS_TH: Record<string, string> = {
  LOGIN: "เข้าสู่ระบบ",
  LOGOUT: "ออกจากระบบ",
  CREATE: "สร้าง",
  UPDATE: "แก้ไข",
  DELETE: "ลบ",
  APPROVE: "อนุมัติ",
  CANCEL: "ยกเลิก",
  CONFIRM: "ยืนยัน",
  OVERRIDE_FEFO: "ข้าม FEFO",
  PERMISSION_CHANGE: "เปลี่ยนสิทธิ์",
  EXPORT: "ส่งออกข้อมูล",
};

export default async function AuditLogPage() {
  const user = await requirePagePermission(PERMISSIONS.AUDIT_VIEW);

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      note: auditLogs.note,
      createdAt: auditLogs.createdAt,
      userName: users.fullName,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(eq(auditLogs.organizationId, user.organizationId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(100);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Audit Log" description="บันทึกการกระทำสำคัญ 100 รายการล่าสุด" />

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="ยังไม่มีบันทึก" description="ระบบจะบันทึกทุกการสร้าง แก้ไข และอนุมัติโดยอัตโนมัติ" />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusBadge tone="info">{ACTION_LABELS_TH[row.action] ?? row.action}</StatusBadge>
                    <span className="text-sm text-ink">{row.entityType}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-subtle">
                    {row.userName ?? "ระบบ"}
                    {row.note ? ` · ${row.note}` : ""}
                  </p>
                </div>
                <time className="text-xs text-ink-muted" dateTime={row.createdAt.toISOString()}>
                  {formatDateTimeTh(row.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
