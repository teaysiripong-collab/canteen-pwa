import { db } from "./db";

export async function audit(opts: {
  userId: string;
  entity: string;
  entityId: string;
  action: "CREATE" | "UPDATE" | "DELETE" | "STATUS" | "OVERRIDE";
  field?: string;
  oldValue?: string | number | null;
  newValue?: string | number | null;
  detail?: string;
}) {
  await db.auditLog.create({
    data: {
      userId: opts.userId,
      entity: opts.entity,
      entityId: opts.entityId,
      action: opts.action,
      field: opts.field,
      oldValue: opts.oldValue != null ? String(opts.oldValue) : null,
      newValue: opts.newValue != null ? String(opts.newValue) : null,
      detail: opts.detail,
    },
  });
}
