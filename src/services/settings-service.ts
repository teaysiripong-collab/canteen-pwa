import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/database/client";
import { appSettings } from "@/database/schema";

/**
 * Runtime settings live in `app_settings` so operations can change them without a deploy.
 * Every key is declared here with a schema and a fallback: a malformed or missing row
 * degrades to the default instead of breaking the page that reads it.
 */
const SETTINGS = {
  expiry_alert_days: {
    schema: z.array(z.number().int().min(0).max(365)).min(1).max(6),
    fallback: [1, 3, 7],
  },
  allow_negative_stock: {
    schema: z.boolean(),
    fallback: false,
  },
  document_prefixes: {
    schema: z.object({
      goodsReceipt: z.string(),
      stockIssue: z.string(),
      stockTransfer: z.string(),
      purchaseOrder: z.string(),
      stockCount: z.string(),
    }),
    fallback: {
      goodsReceipt: "GR",
      stockIssue: "IS",
      stockTransfer: "TF",
      purchaseOrder: "PO",
      stockCount: "SC",
    },
  },
} as const;

type SettingKey = keyof typeof SETTINGS;
type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;

export async function getSetting<K extends SettingKey>(
  organizationId: string,
  key: K,
): Promise<SettingValue<K>> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(and(eq(appSettings.organizationId, organizationId), eq(appSettings.key, key)))
    .limit(1);

  const parsed = SETTINGS[key].schema.safeParse(row?.value);
  return (parsed.success ? parsed.data : SETTINGS[key].fallback) as SettingValue<K>;
}

/**
 * Day thresholds for the expiry alerts, ascending and de-duplicated so the buckets the
 * UI renders are always in a sensible order.
 */
export async function getExpiryThresholds(organizationId: string): Promise<number[]> {
  const days = await getSetting(organizationId, "expiry_alert_days");
  return [...new Set(days)].sort((a, b) => a - b);
}

export type SettingsSnapshot = {
  expiryAlertDays: number[];
  allowNegativeStock: boolean;
  documentPrefixes: SettingValue<"document_prefixes">;
};

export async function getSettingsSnapshot(organizationId: string): Promise<SettingsSnapshot> {
  const [expiryAlertDays, allowNegativeStock, documentPrefixes] = await Promise.all([
    getExpiryThresholds(organizationId),
    getSetting(organizationId, "allow_negative_stock"),
    getSetting(organizationId, "document_prefixes"),
  ]);

  return { expiryAlertDays, allowNegativeStock, documentPrefixes };
}

/**
 * Writes a setting after validating it against the same schema reads use, so a bad value can
 * never be stored in the first place — the read-side fallback is a safety net, not a plan.
 *
 * Changing a setting is audited: "why did documents start being numbered differently" should
 * have an answer.
 */
export async function updateSetting<K extends SettingKey>(
  key: K,
  value: unknown,
): Promise<SettingValue<K>> {
  const { requirePermission } = await import("@/lib/auth/session");
  const { AppError } = await import("@/lib/errors");
  const { PERMISSIONS } = await import("@/lib/permissions");
  const { writeAuditLog } = await import("./audit-service");

  const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);

  const parsed = SETTINGS[key].schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError("VALIDATION", `ค่าที่ตั้งไม่ถูกต้อง: ${parsed.error.issues[0]?.message ?? key}`);
  }

  const before = await getSetting(user.organizationId, key);

  await db.transaction(async (tx) => {
    await tx
      .insert(appSettings)
      .values({ organizationId: user.organizationId, key, value: parsed.data })
      .onConflictDoUpdate({
        target: [appSettings.organizationId, appSettings.key],
        set: { value: parsed.data, updatedAt: new Date() },
      });

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "UPDATE",
      entityType: "app_setting",
      entityId: user.organizationId,
      beforeData: { key, value: before },
      afterData: { key, value: parsed.data },
    });
  });

  return parsed.data as SettingValue<K>;
}
