import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { PERMISSIONS, type PermissionCode, type RoleCode } from "@/lib/permissions";

/**
 * Phase 18. An export is data leaving the building, so the interesting properties are about
 * who may do it and whether the file survives the trip: quoting that a comma cannot break,
 * a permission that is separate from viewing, and an audit row saying what left.
 */
const actor = {
  id: "",
  organizationId: "",
  email: "integration-report@canteen.local",
  fullName: "Integration Reporter",
  defaultLocationId: null as string | null,
  defaultLocationName: null,
  roleCodes: ["MANAGER"] as RoleCode[],
  permissions: Object.values(PERMISSIONS) as PermissionCode[],
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async (required: string | string[]) => {
    const list = Array.isArray(required) ? required : [required];
    if (!list.every((code) => (actor.permissions as string[]).includes(code))) {
      const { AppError } = await import("@/lib/errors");
      throw new AppError("FORBIDDEN");
    }
    return actor;
  }),
  requireUser: vi.fn(async () => actor),
  getCurrentUser: vi.fn(async () => actor),
  getRequestMetadata: vi.fn(async () => ({ ipAddress: "127.0.0.1", userAgent: "vitest" })),
}));

const { db } = await import("@/database/client");
const {
  auditLogs,
  inventoryLots,
  inventoryPostings,
  inventoryTransactions,
  items,
  locations,
  organizations,
  stockBalances,
  units,
  users,
} = await import("@/database/schema");
const { postMovementAs } = await import("@/services/inventory-ledger-service");
const { createLot } = await import("@/services/inventory-lot-service");
const { exportReport, previewReport, reportsForUser } = await import("@/services/report-service");

/** A name with a comma and a quote in it — the two characters that break naive CSV. */
const ITEM_NAME = 'ไก่บด, ไม่ติดมัน ขนาด 5"';
const ITEM_CODE = "TEST-REPORT-ITEM";

let itemId = "";
let locationId = "";
let kgUnitId = "";
let keyCounter = 0;

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

async function purge() {
  if (!itemId) return;
  const lots = await db
    .select({ id: inventoryLots.id })
    .from(inventoryLots)
    .where(eq(inventoryLots.itemId, itemId));
  const lotIds = lots.map((lot) => lot.id);
  if (lotIds.length === 0) return;

  const postingIds = [
    ...new Set(
      (
        await db
          .select({ postingId: inventoryTransactions.postingId })
          .from(inventoryTransactions)
          .where(inArray(inventoryTransactions.lotId, lotIds))
      ).map((row) => row.postingId),
    ),
  ];
  await db.delete(inventoryTransactions).where(inArray(inventoryTransactions.lotId, lotIds));
  await db.delete(stockBalances).where(inArray(stockBalances.lotId, lotIds));
  if (postingIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, postingIds));
    await db.delete(inventoryPostings).where(inArray(inventoryPostings.id, postingIds));
  }
  await db.delete(inventoryLots).where(inArray(inventoryLots.id, lotIds));
}

beforeAll(async () => {
  const [organization] = await db.select().from(organizations).limit(1);
  if (!organization) throw new Error("Run `npm run db:seed` before the integration tests.");
  actor.organizationId = organization.id;

  await db.delete(users).where(eq(users.email, actor.email));
  const [userRow] = await db
    .insert(users)
    .values({ organizationId: organization.id, email: actor.email, fullName: actor.fullName })
    .returning();
  actor.id = userRow!.id;

  const [kg] = await db.select().from(units).where(eq(units.code, "KG")).limit(1);
  kgUnitId = kg!.id;

  const [location] = await db
    .insert(locations)
    .values({
      organizationId: organization.id,
      code: "TEST-REPORT-STORE",
      nameTh: "สโตร์ทดสอบรายงาน",
      holdsStock: true,
    })
    .onConflictDoUpdate({
      target: [locations.organizationId, locations.code],
      set: { nameTh: "สโตร์ทดสอบรายงาน" },
    })
    .returning();
  locationId = location!.id;
  actor.defaultLocationId = locationId;

  const [item] = await db
    .insert(items)
    .values({
      organizationId: organization.id,
      code: ITEM_CODE,
      nameTh: ITEM_NAME,
      baseUnitId: kgUnitId,
      purchaseUnitId: kgUnitId,
      purchaseConversion: "1",
    })
    .onConflictDoUpdate({ target: [items.organizationId, items.code], set: { nameTh: ITEM_NAME } })
    .returning();
  itemId = item!.id;
});

beforeEach(async () => {
  actor.permissions = Object.values(PERMISSIONS) as PermissionCode[];
  await purge();
  await db
    .delete(auditLogs)
    .where(and(eq(auditLogs.userId, actor.id), eq(auditLogs.entityType, "report")));

  const lot = await createLot({
    organizationId: actor.organizationId,
    itemId,
    lotNumber: `REPORT-${(keyCounter += 1)}-${Date.now()}`,
    receivedBaseQty: 25,
    unitCost: 88.5,
    expiryDate: "2030-12-31",
  });
  await postMovementAs(actor, {
    idempotencyKey: `test-report:${(keyCounter += 1)}:${Date.now()}`,
    referenceType: "GOODS_RECEIPT",
    lines: [{ type: "RECEIVE", itemId, lotId: lot.id, locationId, baseQty: 25 }],
  });
});

afterAll(async () => {
  await purge();
  await db.delete(auditLogs).where(eq(auditLogs.userId, actor.id));
  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(eq(users.email, actor.email));
  await db.delete(locations).where(eq(locations.id, locationId));
});

describe("exporting", () => {
  it("quotes a name containing a comma so the columns cannot shift", async () => {
    const report = await exportReport("stock_on_hand", {
      fromDate: today,
      toDate: today,
      locationId,
    });

    const line = report.csv.split("\r\n").find((row) => row.includes("ไก่บด"))!;
    // The comma and the quote both survive, escaped rather than breaking the row.
    expect(line).toContain('"ไก่บด, ไม่ติดมัน ขนาด 5"""');
    // Header plus exactly one data row means nothing split into an extra column-row.
    expect(report.rowCount).toBe(1);
  });

  it("starts the file with a BOM so Excel reads Thai", async () => {
    const report = await exportReport("stock_on_hand", {
      fromDate: today,
      toDate: today,
      locationId,
    });

    expect(report.csv.codePointAt(0)).toBe(0xfeff);
  });

  it("exports the movements that happened in the window", async () => {
    const report = await exportReport("stock_movements", {
      fromDate: today,
      toDate: today,
      locationId,
    });

    expect(report.rowCount).toBe(1);
    expect(report.csv).toContain("RECEIVE");
  });

  it("returns just a header when the window is empty", async () => {
    const report = await exportReport("stock_movements", {
      fromDate: "2020-01-01",
      toDate: "2020-01-02",
      locationId,
    });

    expect(report.rowCount).toBe(0);
    expect(report.csv.split("\r\n").filter((line) => line !== "")).toHaveLength(1);
  });
});

describe("permissions", () => {
  it("needs the export permission on top of the report's own", async () => {
    // Allowed to look at stock, not allowed to walk out with the table.
    actor.permissions = [PERMISSIONS.STOCK_VIEW, PERMISSIONS.REPORT_VIEW];

    await expect(
      exportReport("stock_on_hand", { fromDate: today, toDate: today }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("needs the report's own permission even with the export right", async () => {
    actor.permissions = [PERMISSIONS.REPORT_VIEW, PERMISSIONS.REPORT_EXPORT];

    await expect(
      exportReport("daily_cost", { fromDate: today, toDate: today }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("still allows viewing a preview without the export right", async () => {
    actor.permissions = [PERMISSIONS.STOCK_VIEW, PERMISSIONS.REPORT_VIEW];

    const preview = await previewReport("stock_on_hand", {
      fromDate: today,
      toDate: today,
      locationId,
    });

    expect(preview.rowCount).toBe(1);
  });

  it("offers only the reports the user can read", () => {
    const keys = reportsForUser([PERMISSIONS.STOCK_VIEW]).map((report) => report.key);

    expect(keys).toContain("stock_on_hand");
    expect(keys).not.toContain("daily_cost");
  });

  it("rejects an unknown report key", async () => {
    await expect(
      // A key that does not exist must not fall through to a query.
      exportReport("not_a_report" as never, { fromDate: today, toDate: today }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("audit", () => {
  it("records what left the building", async () => {
    await exportReport("stock_on_hand", { fromDate: today, toDate: today, locationId });

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, actor.id), eq(auditLogs.entityType, "report")))
      .limit(1);

    expect(log).toBeDefined();
    expect(log!.action).toBe("EXPORT");
    expect(log!.afterData).toMatchObject({ report: "stock_on_hand", rows: 1 });
  });

  it("does not record an export that was refused", async () => {
    actor.permissions = [PERMISSIONS.STOCK_VIEW];

    await expect(
      exportReport("stock_on_hand", { fromDate: today, toDate: today }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const logs = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, actor.id), eq(auditLogs.entityType, "report")));

    expect(logs).toHaveLength(0);
  });
});
