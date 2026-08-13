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
