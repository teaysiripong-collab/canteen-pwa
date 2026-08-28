import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { PERMISSIONS, type PermissionCode, type RoleCode } from "@/lib/permissions";
import type { SheetsClient } from "@/lib/sheets/client";

/**
 * Phase 19. The export itself is one HTTP call to Google; what is worth testing is everything
 * around it — that a run is recorded whether it worked or not, that the rows are the same rows
 * the CSV would contain, and that pushing to a shared spreadsheet needs the export right.
 *
 * The transport is injected, so the whole lifecycle runs without a Google account.
 */
const actor = {
  id: "",
  organizationId: "",
  email: "integration-sheets@canteen.local",
  fullName: "Integration Syncer",
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
  sheetSyncRuns,
  stockBalances,
  units,
  users,
} = await import("@/database/schema");
const { postMovementAs } = await import("@/services/inventory-ledger-service");
const { createLot } = await import("@/services/inventory-lot-service");
const { buildReportTable } = await import("@/services/report-service");
const { listSyncRuns, syncReportToSheet } = await import("@/services/sheet-sync-service");

const ITEM_CODE = "TEST-SHEET-ITEM";
const ITEM_NAME = "ปลาทูนึ่ง (ทดสอบ sync)";

let itemId = "";
let locationId = "";
let keyCounter = 0;

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
const window = { fromDate: today, toDate: today };

/** Records what it was asked to write, so the test can assert on the payload. */
function fakeClient(): SheetsClient & { calls: { sheetName: string; values: string[][] }[] } {
  const calls: { sheetName: string; values: string[][] }[] = [];
  return {
    calls,
    async replaceSheet(sheetName, values) {
      calls.push({ sheetName, values });
      return { spreadsheetId: "test-spreadsheet" };
    },
  };
}

function failingClient(message: string): SheetsClient {
  return {
    async replaceSheet() {
      throw new Error(message);
    },
  };
}

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

  // Its own location: `stock_on_hand` reads a whole location, and sharing a seeded one would
  // make the row count depend on whatever else the seed happens to hold.
  const [location] = await db
    .insert(locations)
    .values({
      organizationId: organization.id,
      code: "TEST-SHEET-STORE",
      nameTh: "สโตร์ทดสอบ sync",
      holdsStock: true,
    })
    .onConflictDoUpdate({
      target: [locations.organizationId, locations.code],
      set: { nameTh: "สโตร์ทดสอบ sync" },
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
      baseUnitId: kg!.id,
      purchaseUnitId: kg!.id,
      purchaseConversion: "1",
    })
    .onConflictDoUpdate({ target: [items.organizationId, items.code], set: { nameTh: ITEM_NAME } })
    .returning();
  itemId = item!.id;
});

beforeEach(async () => {
  actor.permissions = Object.values(PERMISSIONS) as PermissionCode[];
  await purge();
  await db.delete(sheetSyncRuns).where(eq(sheetSyncRuns.triggeredBy, actor.id));
  await db
    .delete(auditLogs)
    .where(and(eq(auditLogs.userId, actor.id), eq(auditLogs.entityType, "sheet_sync_run")));

  const lot = await createLot({
    organizationId: actor.organizationId,
    itemId,
    lotNumber: `SHEET-${(keyCounter += 1)}-${Date.now()}`,
    receivedBaseQty: 12,
    unitCost: 140,
    expiryDate: "2030-12-31",
  });
  await postMovementAs(actor, {
    idempotencyKey: `test-sheet:${(keyCounter += 1)}:${Date.now()}`,
    referenceType: "GOODS_RECEIPT",
    lines: [{ type: "RECEIVE", itemId, lotId: lot.id, locationId, baseQty: 12 }],
  });
});

afterAll(async () => {
  await purge();
  await db.delete(sheetSyncRuns).where(eq(sheetSyncRuns.triggeredBy, actor.id));
  await db.delete(auditLogs).where(eq(auditLogs.userId, actor.id));
  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(eq(users.email, actor.email));
  await db.delete(locations).where(eq(locations.id, locationId));
});

describe("pushing a report", () => {
  it("writes the header row followed by the data rows", async () => {
    const client = fakeClient();

    await syncReportToSheet("stock_on_hand", { ...window, locationId }, { client });

    const [call] = client.calls;
    expect(call!.sheetName).toBe("Stock On Hand");
    expect(call!.values[0]).toContain("ชื่อวัตถุดิบ");
    expect(call!.values).toHaveLength(2);
    expect(call!.values[1]).toContain(ITEM_NAME);
  });

  it("sends exactly the rows the CSV download would contain", async () => {
    const client = fakeClient();

    await syncReportToSheet("stock_on_hand", { ...window, locationId }, { client });
    const table = await buildReportTable("stock_on_hand", actor.organizationId, {
      ...window,
      locationId,
    });

    // One builder feeds both, so a column can never mean different things in the two places.
    expect(client.calls[0]!.values).toEqual([table.headers, ...table.rows]);
  });

  it("records a successful run with its row count", async () => {
    const client = fakeClient();

    const result = await syncReportToSheet("stock_on_hand", { ...window, locationId }, { client });

    expect(result.status).toBe("SUCCESS");
    const [run] = await listSyncRuns(actor.organizationId, 1);
    expect(run).toMatchObject({
      status: "SUCCESS",
      target: "INVENTORY_BALANCE",
      sheetName: "Stock On Hand",
      rowCount: "1",
      errorMessage: null,
    });
    expect(run!.finishedAt).not.toBeNull();
  });

  it("sends an empty report as a header row rather than nothing", async () => {
    const client = fakeClient();

    // Clearing a tab and leaving the header is a readable "no rows"; leaving last week's
    // numbers behind is not.
    await syncReportToSheet("daily_cost", { fromDate: "2020-01-01", toDate: "2020-01-02" }, {
      client,
    });

    expect(client.calls[0]!.values).toHaveLength(1);
  });
});

describe("when Google refuses", () => {
  it("records the failure with the reason instead of losing it", async () => {
    await expect(
      syncReportToSheet(
        "stock_on_hand",
        { ...window, locationId },
        { client: failingClient("Sheets write failed (403): caller has no edit access") },
      ),
    ).rejects.toMatchObject({ code: "INTERNAL" });

    const [run] = await listSyncRuns(actor.organizationId, 1);
    expect(run!.status).toBe("FAILED");
    expect(run!.errorMessage).toContain("403");
    expect(run!.finishedAt).not.toBeNull();
  });

  it("does not leave the run stuck at PENDING", async () => {
    await expect(
      syncReportToSheet("stock_on_hand", { ...window, locationId }, { client: failingClient("x") }),
    ).rejects.toThrow();

    const runs = await listSyncRuns(actor.organizationId, 10);
    expect(runs.every((run) => run.status !== "PENDING")).toBe(true);
  });

  it("writes no audit row for an export that never landed", async () => {
    await expect(
      syncReportToSheet("stock_on_hand", { ...window, locationId }, { client: failingClient("x") }),
    ).rejects.toThrow();

    const logs = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, actor.id), eq(auditLogs.entityType, "sheet_sync_run")));

    expect(logs).toHaveLength(0);
  });
});

describe("permissions and configuration", () => {
  it("needs the export right, not just the right to read the report", async () => {
    actor.permissions = [PERMISSIONS.STOCK_VIEW, PERMISSIONS.REPORT_VIEW];

    await expect(
      syncReportToSheet("stock_on_hand", window, { client: fakeClient() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("needs the report's own permission too", async () => {
    actor.permissions = [PERMISSIONS.REPORT_VIEW, PERMISSIONS.REPORT_EXPORT];

    await expect(
      syncReportToSheet("daily_cost", window, { client: fakeClient() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses an unknown report before touching the sheet", async () => {
    const client = fakeClient();

    await expect(
      syncReportToSheet("not_a_report" as never, window, { client }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(client.calls).toHaveLength(0);
  });

  it("says so plainly when no credentials are configured", async () => {
    // No run row either: nothing was attempted, so a FAILED row would send an operator
    // hunting for a bug that does not exist.
    await expect(
      syncReportToSheet("stock_on_hand", window, { client: null }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const runs = await listSyncRuns(actor.organizationId, 10);
    expect(runs).toHaveLength(0);
  });

  it("audits a successful push", async () => {
    await syncReportToSheet("stock_on_hand", { ...window, locationId }, { client: fakeClient() });

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, actor.id), eq(auditLogs.entityType, "sheet_sync_run")))
      .limit(1);

    expect(log!.action).toBe("EXPORT");
    expect(log!.afterData).toMatchObject({ report: "stock_on_hand", target: "INVENTORY_BALANCE" });
  });
});
