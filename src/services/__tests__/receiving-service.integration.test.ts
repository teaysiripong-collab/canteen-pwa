import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { PERMISSIONS, type PermissionCode, type RoleCode } from "@/lib/permissions";

/**
 * Phase 5: receiving is the first workflow a real user drives. The whole document —
 * receipt, lines, lots and ledger rows — has to land in one transaction or not at all.
 */
const actor = {
  id: "",
  organizationId: "",
  email: "integration-receiver@canteen.local",
  fullName: "Integration Receiver",
  defaultLocationId: null,
  defaultLocationName: null,
  roleCodes: ["STORE"] as RoleCode[],
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
  goodsReceiptItems,
  goodsReceipts,
  inventoryLots,
  inventoryPostings,
  inventoryTransactions,
  items,
  locations,
  organizations,
  stockBalances,
  supplierItems,
  suppliers,
  units,
  users,
} = await import("@/database/schema");
const { createGoodsReceipt } = await import("@/services/receiving-service");
const { listStockMovements } = await import("@/repositories/inventory-repository");

const ITEM_CODE = "TEST-RECV-001";
const EGG_CODE = "TEST-RECV-EGG";

let itemId = "";
let eggId = "";
let locationId = "";
let supplierId = "";
let kgUnitId = "";
let pangUnitId = "";
let fongUnitId = "";
let keyCounter = 0;

const nextKey = () => `test-recv:${(keyCounter += 1)}:${Date.now()}`;

async function stockOf(id: string): Promise<number> {
  const rows = await db
    .select({ baseQty: stockBalances.baseQty })
    .from(stockBalances)
    .where(and(eq(stockBalances.itemId, id), eq(stockBalances.locationId, locationId)));
  return rows.reduce((sum, row) => sum + Number(row.baseQty), 0);
}

async function purge() {
  const testItemIds = [itemId, eggId].filter(Boolean);
  if (testItemIds.length === 0) return;

  const lots = await db
    .select({ id: inventoryLots.id })
    .from(inventoryLots)
    .where(inArray(inventoryLots.itemId, testItemIds));
  const lotIds = lots.map((lot) => lot.id);

  const receipts = await db
    .select({ id: goodsReceipts.id })
    .from(goodsReceipts)
    .where(eq(goodsReceipts.supplierId, supplierId || "00000000-0000-0000-0000-000000000000"));
  const receiptIds = receipts.map((receipt) => receipt.id);

  if (lotIds.length > 0) {
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
  }

  if (receiptIds.length > 0) {
    await db.delete(goodsReceiptItems).where(inArray(goodsReceiptItems.goodsReceiptId, receiptIds));
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, receiptIds));
  }
  if (lotIds.length > 0) {
    await db.delete(inventoryLots).where(inArray(inventoryLots.id, lotIds));
  }
  if (receiptIds.length > 0) {
    await db.delete(goodsReceipts).where(inArray(goodsReceipts.id, receiptIds));
  }
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

  const unitRows = await db.select().from(units);
  kgUnitId = unitRows.find((unit) => unit.code === "KG")!.id;
  pangUnitId = unitRows.find((unit) => unit.code === "PANG")!.id;
  fongUnitId = unitRows.find((unit) => unit.code === "FONG")!.id;

  const [b16] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.organizationId, organization.id), eq(locations.code, "B16")))
    .limit(1);
  locationId = b16!.id;

  const [supplier] = await db
    .insert(suppliers)
    .values({
      organizationId: organization.id,
      code: "TEST-RECV-SUP",
      nameTh: "ผู้ขายทดสอบรับของ",
    })
    .onConflictDoUpdate({
      target: [suppliers.organizationId, suppliers.code],
      set: { nameTh: "ผู้ขายทดสอบรับของ" },
    })
    .returning();
  supplierId = supplier!.id;

  const [meat] = await db
    .insert(items)
    .values({
      organizationId: organization.id,
      code: ITEM_CODE,
      nameTh: "ไก่บด (ทดสอบรับของ)",
      baseUnitId: kgUnitId,
      purchaseUnitId: kgUnitId,
      purchaseConversion: "1",
      shelfLifeDays: 3,
    })
    .onConflictDoUpdate({
      target: [items.organizationId, items.code],
      set: { shelfLifeDays: 3 },
    })
    .returning();
  itemId = meat!.id;

  // Bought by the tray, stocked by the egg — the conversion has to be applied.
  const [egg] = await db
    .insert(items)
    .values({
      organizationId: organization.id,
      code: EGG_CODE,
      nameTh: "ไข่ไก่ (ทดสอบรับของ)",
      baseUnitId: fongUnitId,
      purchaseUnitId: pangUnitId,
      purchaseConversion: "30",
    })
    .onConflictDoUpdate({
      target: [items.organizationId, items.code],
      set: { purchaseConversion: "30" },
    })
    .returning();
  eggId = egg!.id;

  await db
    .insert(supplierItems)
    .values({ supplierId, itemId, purchaseUnitId: kgUnitId, purchaseConversion: "1" })
    .onConflictDoNothing();
});

beforeEach(async () => {
  await purge();
});

afterAll(async () => {
  await purge();
  await db.delete(supplierItems).where(eq(supplierItems.supplierId, supplierId));
  await db.delete(items).where(inArray(items.id, [itemId, eggId]));
  await db.delete(suppliers).where(eq(suppliers.id, supplierId));
  await db.delete(users).where(eq(users.email, actor.email));
});

describe("goods receiving", () => {
  it("creates the receipt, its lines, a lot and the ledger rows in one go", async () => {
    const result = await createGoodsReceipt({
      idempotencyKey: nextKey(),
      supplierId,
      locationId,
      supplierDocNumber: "INV-001",
      lines: [
        {
          itemId,
          receivedQty: 20,
          receiptUnitId: kgUnitId,
          conversionToBase: 1,
          rejectedQty: 0,
          unitPrice: 88.5,
          lineStatus: "ACCEPTED",
          expiryDate: "2026-09-01",
        },
      ],
    });

    expect(result.receiptNumber).toMatch(/^GR-\d{8}-\d{3}$/);
    expect(result.acceptedLines).toBe(1);

    const [receipt] = await db
      .select()
      .from(goodsReceipts)
      .where(eq(goodsReceipts.id, result.receiptId));
    expect(receipt!.status).toBe("CONFIRMED");
    expect(receipt!.supplierDocNumber).toBe("INV-001");

    const lines = await db
      .select()
      .from(goodsReceiptItems)
      .where(eq(goodsReceiptItems.goodsReceiptId, result.receiptId));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.receivedBaseQty).toBe("20.0000");

    const [lot] = await db
      .select()
      .from(inventoryLots)
      .where(eq(inventoryLots.goodsReceiptId, result.receiptId));
    expect(lot!.expiryDate).toBe("2026-09-01");
    expect(lot!.unitCost).toBe("88.5000");

    expect(await stockOf(itemId)).toBe(20);

    const { rows } = await listStockMovements(actor.organizationId, { itemId });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.transactionType).toBe("RECEIVE");
    expect(rows[0]!.referenceNumber).toBe(result.receiptNumber);
  });

  it("converts the purchase unit into the stock unit", async () => {
    // 3 แผง × 30 = 90 ฟอง, and 128 บาท/แผง becomes 4.2667 บาท/ฟอง.
    await createGoodsReceipt({
      idempotencyKey: nextKey(),
      supplierId,
      locationId,
      lines: [
        {
          itemId: eggId,
          receivedQty: 3,
          receiptUnitId: pangUnitId,
          conversionToBase: 30,
          rejectedQty: 0,
          unitPrice: 128,
          lineStatus: "ACCEPTED",
        },
      ],
    });

    expect(await stockOf(eggId)).toBe(90);

    const [lot] = await db
      .select()
      .from(inventoryLots)
      .where(eq(inventoryLots.itemId, eggId));
    expect(lot!.receivedBaseQty).toBe("90.0000");
    expect(lot!.unitCost).toBe("4.2667");
  });

  it("fills the expiry date from the item's shelf life when the box has none", async () => {
    const result = await createGoodsReceipt({
      idempotencyKey: nextKey(),
      supplierId,
      locationId,
      lines: [
        {
          itemId,
          receivedQty: 5,
          receiptUnitId: kgUnitId,
          conversionToBase: 1,
          rejectedQty: 0,
          lineStatus: "ACCEPTED",
        },
      ],
    });

    const [lot] = await db
      .select()
      .from(inventoryLots)
      .where(eq(inventoryLots.goodsReceiptId, result.receiptId));

    expect(lot!.expiryDate).not.toBeNull();
  });

  it("keeps refused quantity on the document but out of stock", async () => {
    const result = await createGoodsReceipt({
      idempotencyKey: nextKey(),
      supplierId,
      locationId,
      lines: [
        {
          itemId,
          receivedQty: 10,
          receiptUnitId: kgUnitId,
          conversionToBase: 1,
          rejectedQty: 4,
          unitPrice: 90,
          lineStatus: "DAMAGED",
        },
      ],
    });

    const lines = await db
      .select()
      .from(goodsReceiptItems)
      .where(eq(goodsReceiptItems.goodsReceiptId, result.receiptId));

    expect(lines[0]!.receivedBaseQty).toBe("10.0000");
    expect(lines[0]!.rejectedBaseQty).toBe("4.0000");
    expect(lines[0]!.lineStatus).toBe("DAMAGED");

    // Only the 6 that were accepted are on the shelf.
    expect(await stockOf(itemId)).toBe(6);
  });

  it("records a fully refused line without creating a lot or moving stock", async () => {
    const result = await createGoodsReceipt({
      idempotencyKey: nextKey(),
      supplierId,
      locationId,
      lines: [
        {
          itemId,
          receivedQty: 8,
          receiptUnitId: kgUnitId,
          conversionToBase: 1,
          rejectedQty: 8,
          lineStatus: "WRONG_ITEM",
        },
      ],
    });

    expect(result.acceptedLines).toBe(0);
    expect(result.postingId).toBeNull();
    expect(await stockOf(itemId)).toBe(0);

    const lots = await db
      .select()
      .from(inventoryLots)
      .where(eq(inventoryLots.goodsReceiptId, result.receiptId));
    expect(lots).toHaveLength(0);

    // The document still records what the supplier tried to deliver.
    const lines = await db
      .select()
      .from(goodsReceiptItems)
      .where(eq(goodsReceiptItems.goodsReceiptId, result.receiptId));
    expect(lines).toHaveLength(1);
  });

  it("receives once when the same submission arrives twice", async () => {
    const payload = {
      idempotencyKey: nextKey(),
      supplierId,
      locationId,
      lines: [
        {
          itemId,
          receivedQty: 12,
          receiptUnitId: kgUnitId,
          conversionToBase: 1,
          rejectedQty: 0,
          lineStatus: "ACCEPTED" as const,
        },
      ],
    };

    const first = await createGoodsReceipt(payload);
    const second = await createGoodsReceipt(payload);

    expect(second.replayed).toBe(true);
    expect(second.receiptId).toBe(first.receiptId);
    expect(await stockOf(itemId)).toBe(12);

    const receipts = await db
      .select()
      .from(goodsReceipts)
      .where(eq(goodsReceipts.supplierId, supplierId));
    expect(receipts).toHaveLength(1);
  });

  it("leaves nothing behind when a line is invalid", async () => {
    await expect(
      createGoodsReceipt({
        idempotencyKey: nextKey(),
        supplierId,
        locationId,
        lines: [
          {
            itemId,
            receivedQty: 5,
            receiptUnitId: kgUnitId,
            conversionToBase: 1,
            rejectedQty: 0,
            lineStatus: "ACCEPTED",
          },
          {
            itemId: "00000000-0000-4000-8000-000000000000",
            receivedQty: 5,
            receiptUnitId: kgUnitId,
            conversionToBase: 1,
            rejectedQty: 0,
            lineStatus: "ACCEPTED",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(await stockOf(itemId)).toBe(0);

    const receipts = await db
      .select()
      .from(goodsReceipts)
      .where(eq(goodsReceipts.supplierId, supplierId));
    expect(receipts).toHaveLength(0);
  });

  it("numbers receipts sequentially within the day", async () => {
    const first = await createGoodsReceipt({
      idempotencyKey: nextKey(),
      supplierId,
      locationId,
      lines: [
        { itemId, receivedQty: 1, receiptUnitId: kgUnitId, conversionToBase: 1, rejectedQty: 0, lineStatus: "ACCEPTED" },
      ],
    });
    const second = await createGoodsReceipt({
      idempotencyKey: nextKey(),
      supplierId,
      locationId,
      lines: [
        { itemId, receivedQty: 1, receiptUnitId: kgUnitId, conversionToBase: 1, rejectedQty: 0, lineStatus: "ACCEPTED" },
      ],
    });

    const sequence = (number: string) => Number(number.slice(number.lastIndexOf("-") + 1));
    expect(sequence(second.receiptNumber)).toBe(sequence(first.receiptNumber) + 1);
  });

  it("remembers the supplier's latest price", async () => {
    await createGoodsReceipt({
      idempotencyKey: nextKey(),
      supplierId,
      locationId,
      lines: [
        {
          itemId,
          receivedQty: 4,
          receiptUnitId: kgUnitId,
          conversionToBase: 1,
          unitPrice: 95.25,
          rejectedQty: 0,
          lineStatus: "ACCEPTED",
        },
      ],
    });

    const [mapping] = await db
      .select()
      .from(supplierItems)
      .where(and(eq(supplierItems.supplierId, supplierId), eq(supplierItems.itemId, itemId)));

    expect(mapping!.lastPrice).toBe("95.2500");
    expect(mapping!.lastPriceAt).toBeInstanceOf(Date);
  });

  it("refuses a user without receive.create", async () => {
    const saved = actor.permissions;
    actor.permissions = [PERMISSIONS.STOCK_VIEW];

    await expect(
      createGoodsReceipt({
        idempotencyKey: nextKey(),
        supplierId,
        locationId,
        lines: [
          { itemId, receivedQty: 1, receiptUnitId: kgUnitId, conversionToBase: 1, rejectedQty: 0, lineStatus: "ACCEPTED" },
        ],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    actor.permissions = saved;
    expect(await stockOf(itemId)).toBe(0);
  });
});

/**
 * The form posts strings (a number input's value is always a string) through the server
 * action. These cover that exact path, including the Thai field errors the form renders.
 */
describe("receiving server action", () => {
  it("accepts the string payload the form sends and coerces it", async () => {
    const { submitReceivingAction } = await import("@/features/receiving/actions");

    const result = await submitReceivingAction({
      idempotencyKey: nextKey(),
      supplierId,
      locationId,
      lines: [
        {
          itemId: eggId,
          receivedQty: "2",
          receiptUnitId: pangUnitId,
          conversionToBase: "30",
          rejectedQty: "0",
          unitPrice: "128",
          lineStatus: "ACCEPTED",
          expiryDate: "",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(await stockOf(eggId)).toBe(60);
  });

  it("returns a Thai field error instead of throwing when a line is empty", async () => {
    const { submitReceivingAction } = await import("@/features/receiving/actions");

    const result = await submitReceivingAction({
      idempotencyKey: nextKey(),
      supplierId,
      locationId,
      lines: [
        {
          itemId,
          receivedQty: "0",
          receiptUnitId: kgUnitId,
          conversionToBase: "1",
          rejectedQty: "0",
          lineStatus: "ACCEPTED",
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a validation failure");
    expect(result.code).toBe("VALIDATION");
    expect(result.fieldErrors?.["lines.0.receivedQty"]).toEqual(["จำนวนต้องมากกว่า 0"]);
  });

  it("rejects a refusal larger than the delivery", async () => {
    const { submitReceivingAction } = await import("@/features/receiving/actions");

    const result = await submitReceivingAction({
      idempotencyKey: nextKey(),
      supplierId,
      locationId,
      lines: [
        {
          itemId,
          receivedQty: "5",
          receiptUnitId: kgUnitId,
          conversionToBase: "1",
          rejectedQty: "9",
          lineStatus: "DAMAGED",
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a validation failure");
    expect(result.fieldErrors?.["lines.0.rejectedQty"]).toEqual([
      "จำนวนที่ปฏิเสธมากกว่าจำนวนที่ส่งมา",
    ]);
    expect(await stockOf(itemId)).toBe(0);
  });
});
