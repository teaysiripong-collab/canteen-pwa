import { daysBetween, todayIso } from "@/lib/date";
import { listExpiringLots } from "@/repositories/inventory-repository";
import { getExpiryThresholds } from "./settings-service";

export type ExpiryLot = {
  lotId: string;
  lotNumber: string;
  expiryDate: string;
  daysLeft: number;
  itemId: string;
  itemCode: string;
  itemNameTh: string;
  baseUnitCode: string | null;
  locationCode: string;
  locationNameTh: string;
  baseQty: string;
};

export type ExpiryGroup = {
  /** `-1` = already expired, `0` = expires today, otherwise the threshold in days. */
  key: number;
  labelTh: string;
  tone: "critical" | "warning" | "info";
  lots: ExpiryLot[];
};

export type ExpiryAlerts = {
  today: string;
  thresholds: number[];
  groups: ExpiryGroup[];
  totalLots: number;
};

function groupLabel(key: number): string {
  if (key < 0) return "หมดอายุแล้ว";
  if (key === 0) return "หมดอายุวันนี้";
  return `หมดอายุใน ${key} วัน`;
}

function groupTone(key: number, thresholds: number[]): ExpiryGroup["tone"] {
  if (key <= 0) return "critical";
  // The tightest configured threshold is the urgent one; the rest are early warnings.
  return key <= (thresholds[0] ?? 1) ? "critical" : "warning";
}

/**
 * Lots that need attention, grouped by how close they are to expiring.
 *
 * Thresholds come from `app_settings.expiry_alert_days` — nothing here is hardcoded, so
 * a canteen that wants 2/5/10 instead of 1/3/7 changes one row.
 */
export async function getExpiryAlerts(
  organizationId: string,
  options: { today?: string } = {},
): Promise<ExpiryAlerts> {
  const today = options.today ?? todayIso();
  const thresholds = await getExpiryThresholds(organizationId);
  const horizon = thresholds[thresholds.length - 1] ?? 7;

  const rows = await listExpiringLots(organizationId, horizon, today);

  const buckets = new Map<number, ExpiryLot[]>();
  for (const row of rows) {
    if (!row.expiryDate) continue;

    const daysLeft = daysBetween(today, row.expiryDate);
    // Anything past its date lands in the expired bucket; today gets its own; the rest
    // fall into the tightest threshold that still covers them.
    const key =
      daysLeft < 0 ? -1 : daysLeft === 0 ? 0 : (thresholds.find((day) => daysLeft <= day) ?? horizon);

    const lot: ExpiryLot = {
      lotId: row.lotId,
      lotNumber: row.lotNumber,
      expiryDate: row.expiryDate,
      daysLeft,
      itemId: row.itemId,
      itemCode: row.itemCode,
      itemNameTh: row.itemNameTh,
      baseUnitCode: row.baseUnitCode,
      locationCode: row.locationCode,
      locationNameTh: row.locationNameTh,
      baseQty: row.baseQty,
    };

    const existing = buckets.get(key);
    if (existing) existing.push(lot);
    else buckets.set(key, [lot]);
  }

  const groups: ExpiryGroup[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, lots]) => ({
      key,
      labelTh: groupLabel(key),
      tone: groupTone(key, thresholds),
      lots: lots.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)),
    }));

  return {
    today,
    thresholds,
    groups,
    totalLots: rows.length,
  };
}
