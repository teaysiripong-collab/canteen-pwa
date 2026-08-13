import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { PERMISSIONS, type PermissionCode, type RoleCode } from "@/lib/permissions";

/**
 * Phase 10. The numbers that matter are ordered / received / remaining, and the status is
 * derived from them rather than set by whoever received last. Order 100, receive 70,
 * remaining 30, status PARTIALLY_RECEIVED.
 */
const actor = {
  id: "",
  organizationId: "",
  email: "integration-po@canteen.local",
  fullName: "Integration Buyer",
  defaultLocationId: null,
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
  goodsReceiptItems,
  goodsReceipts,
  inventoryLots,
  inventoryPostings,
  inventoryTransactions,
  items,
  locations,
  organizations,
  purchaseOrderItems,
  purchaseOrders,
  stockBalances,
  supplierItems,
  suppliers,
  units,
  users,
} = await import("@/database/schema");
const {
  createPurchaseOrder,
  setPurchaseOrderStatus,
  remainingBaseQty,
  getPriceComparison,
} = await import("@/services/purchase-order-service");
const { createGoodsReceipt } = await import("@/services/receiving-service");
const { getPurchaseOrderById } = await import("@/repositories/purchase-order-repository");

let itemId = "";
let eggId = "";
let supplierId = "";
let locationId = "";
let kgUnitId = "";
let pangUnitId = "";
let fongUnitId = "";
let keyCounter = 0;

const nextKey = () => `test-po:${(keyCounter += 1)}:${Date.now()}`;
const TODAY = "2026-08-20";

async function purge() {
  const orderRows = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.organizationId, actor.organizationId));
  const orderIds = orderRows.map((row) => row.id);

  const receiptRows = await db
    .select({ id: goodsReceipts.id })
    .from(goodsReceipts)
    .where(eq(goodsReceipts.supplierId, supplierId || "00000000-0000-0000-0000-000000000000"));
  const receiptIds = receiptRows.map((row) => row.id);

  const testItemIds = [itemId, eggId].filter(Boolean);
  if (testItemIds.length > 0) {
    const lots = await db
      .select({ id: inventoryLots.id })
      .from(inventoryLots)
      .where(inArray(inventoryLots.itemId, testItemIds));
    const lotIds = lots.map((lot) => lot.id);

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
      await db.delete(inventoryLots).where(inArray(inventoryLots.id, lotIds));
    }
  }

  if (receiptIds.length > 0) {
    await db.delete(goodsReceiptItems).where(inArray(goodsReceiptItems.goodsReceiptId, receiptIds));
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, receiptIds));
    await db.delete(goodsReceipts).where(inArray(goodsReceipts.id, receiptIds));
  }

  if (orderIds.length > 0) {
    await db.delete(purchaseOrderItems).where(inArray(purchaseOrderItems.purchaseOrderId, orderIds));
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, orderIds));
    await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, orderIds));
  }
}

/** Creates an approved order ready to receive against. */
async function approvedOrder(orderedQty: number, unitPrice = 90) {
  const created = await createPurchaseOrder({
    supplierId,
    deliverToLocationId: locationId,
    orderDate: TODAY,
    lines: [
      {
        itemId,
        orderedQty,
        purchaseUnitId: kgUnitId,
        conversionToBase: 1,
        unitPrice,
      },
    ],
  });

  await setPurchaseOrderStatus(created.purchaseOrderId, "PENDING");
  await setPurchaseOrderStatus(created.purchaseOrderId, "APPROVED");
  return created;
}

async function receiveAgainst(purchaseOrderId: string, qty: number) {
  const detail = await getPurchaseOrderById(actor.organizationId, purchaseOrderId);
  const line = detail!.lines[0]!;

  return createGoodsReceipt({
    idempotencyKey: nextKey(),
    supplierId,
    locationId,
    purchaseOrderId,
    lines: [
      {
        itemId,
        purchaseOrderItemId: line.id,
        receivedQty: qty,
        receiptUnitId: kgUnitId,
        conversionToBase: 1,
        rejectedQty: 0,
        unitPrice: 90,
        lineStatus: "ACCEPTED",
      },
    ],
  });
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
    .values({ organizationId: organization.id, code: "TEST-PO-SUP", nameTh: "ผู้ขายทดสอบ PO" })
    .onConflictDoUpdate({
      target: [suppliers.organizationId, suppliers.code],
      set: { nameTh: "ผู้ขายทดสอบ PO" },
    })
    .returning();
  supplierId = supplier!.id;

  const [chicken] = await db
    .insert(items)
    .values({
      organizationId: organization.id,
      code: "TEST-PO-CHICKEN",
      nameTh: "ไก่บด (ทดสอบ PO)",
      baseUnitId: kgUnitId,
      purchaseUnitId: kgUnitId,
      purchaseConversion: "1",
    })
    .onConflictDoUpdate({
      target: [items.organizationId, items.code],
      set: { nameTh: "ไก่บด (ทดสอบ PO)" },
    })
    .returning();
  itemId = chicken!.id;

  const [egg] = await db
    .insert(items)
    .values({
      organizationId: organization.id,
      code: "TEST-PO-EGG",
      nameTh: "ไข่ไก่ (ทดสอบ PO)",
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

describe("purchase order workflow", () => {
  it("numbers the order and starts it as a draft", async () => {
    const created = await createPurchaseOrder({
      supplierId,
      deliverToLocationId: locationId,
      orderDate: TODAY,
      lines: [
        { itemId, orderedQty: 50, purchaseUnitId: kgUnitId, conversionToBase: 1, unitPrice: 88 },
      ],
    });

    expect(created.poNumber).toMatch(/^PO-\d{8}-\d{3}$/);

    const detail = await getPurchaseOrderById(actor.organizationId, created.purchaseOrderId);
    expect(detail!.order.status).toBe("DRAFT");
    expect(detail!.lines[0]!.orderedBaseQty).toBe("50.0000");
    expect(detail!.lines[0]!.remainingBaseQty).toBe("50.0000");
  });

  it("converts the purchase unit into base units on the order line", async () => {
    const created = await createPurchaseOrder({
      supplierId,
      deliverToLocationId: locationId,
      orderDate: TODAY,
      lines: [
        { itemId: eggId, orderedQty: 4, purchaseUnitId: pangUnitId, conversionToBase: 30, unitPrice: 128 },
      ],
    });

    const detail = await getPurchaseOrderById(actor.organizationId, created.purchaseOrderId);
    expect(detail!.lines[0]!.orderedQty).toBe("4.0000");
    expect(detail!.lines[0]!.orderedBaseQty).toBe("120.0000");
  });

  it("walks DRAFT to PENDING to APPROVED and refuses to skip", async () => {
    const created = await createPurchaseOrder({
      supplierId,
      deliverToLocationId: locationId,
      orderDate: TODAY,
      lines: [{ itemId, orderedQty: 10, purchaseUnitId: kgUnitId, conversionToBase: 1 }],
    });

    await expect(
      setPurchaseOrderStatus(created.purchaseOrderId, "APPROVED"),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await setPurchaseOrderStatus(created.purchaseOrderId, "PENDING");
    const approved = await setPurchaseOrderStatus(created.purchaseOrderId, "APPROVED");
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedAt).toBeInstanceOf(Date);
  });

  it("needs po.approve to approve, not just po.manage", async () => {
    const created = await createPurchaseOrder({
      supplierId,
      deliverToLocationId: locationId,
      orderDate: TODAY,
      lines: [{ itemId, orderedQty: 10, purchaseUnitId: kgUnitId, conversionToBase: 1 }],
    });
    await setPurchaseOrderStatus(created.purchaseOrderId, "PENDING");

    const saved = actor.permissions;
    actor.permissions = [PERMISSIONS.PO_MANAGE, PERMISSIONS.PO_VIEW];

    await expect(
      setPurchaseOrderStatus(created.purchaseOrderId, "APPROVED"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    actor.permissions = saved;
  });

  it("stops editing once the order is approved", async () => {
    const created = await approvedOrder(20);
    const { updatePurchaseOrder } = await import("@/services/purchase-order-service");

    await expect(
      updatePurchaseOrder(created.purchaseOrderId, {
        supplierId,
        deliverToLocationId: locationId,
        orderDate: TODAY,
        lines: [{ itemId, orderedQty: 99, purchaseUnitId: kgUnitId, conversionToBase: 1 }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("partial receiving", () => {
  it("order 100, receive 70: remaining 30 and status PARTIALLY_RECEIVED", async () => {
    const created = await approvedOrder(100);
    await receiveAgainst(created.purchaseOrderId, 70);

    const detail = await getPurchaseOrderById(actor.organizationId, created.purchaseOrderId);

    expect(detail!.lines[0]!.receivedBaseQty).toBe("70.0000");
    expect(detail!.lines[0]!.remainingBaseQty).toBe("30.0000");
    expect(detail!.order.status).toBe("PARTIALLY_RECEIVED");
  });

  it("completes the order when the rest arrives", async () => {
    const created = await approvedOrder(100);
    await receiveAgainst(created.purchaseOrderId, 70);
    await receiveAgainst(created.purchaseOrderId, 30);

    const detail = await getPurchaseOrderById(actor.organizationId, created.purchaseOrderId);

    expect(detail!.lines[0]!.receivedBaseQty).toBe("100.0000");
    expect(detail!.lines[0]!.remainingBaseQty).toBe("0.0000");
    expect(detail!.order.status).toBe("RECEIVED");
  });

  it("treats an over-delivery as complete and never negative remaining", async () => {
    const created = await approvedOrder(50);
    await receiveAgainst(created.purchaseOrderId, 60);

    const detail = await getPurchaseOrderById(actor.organizationId, created.purchaseOrderId);

    expect(detail!.lines[0]!.receivedBaseQty).toBe("60.0000");
    expect(detail!.lines[0]!.remainingBaseQty).toBe("0.0000");
    expect(detail!.order.status).toBe("RECEIVED");
  });

  it("refuses to receive against an order that is already complete", async () => {
    const created = await approvedOrder(20);
    await receiveAgainst(created.purchaseOrderId, 20);

    await expect(receiveAgainst(created.purchaseOrderId, 5)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("refuses to receive against an order that is not approved yet", async () => {
    const created = await createPurchaseOrder({
      supplierId,
      deliverToLocationId: locationId,
      orderDate: TODAY,
      lines: [{ itemId, orderedQty: 10, purchaseUnitId: kgUnitId, conversionToBase: 1 }],
    });

    await expect(receiveAgainst(created.purchaseOrderId, 5)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("moves stock and links the receipt to the order in one go", async () => {
    const created = await approvedOrder(40);
    const receipt = await receiveAgainst(created.purchaseOrderId, 40);

    const balances = await db
      .select({ baseQty: stockBalances.baseQty })
      .from(stockBalances)
      .where(and(eq(stockBalances.itemId, itemId), eq(stockBalances.locationId, locationId)));
    expect(balances.reduce((sum, row) => sum + Number(row.baseQty), 0)).toBe(40);

    const detail = await getPurchaseOrderById(actor.organizationId, created.purchaseOrderId);
    expect(detail!.receipts.map((row) => row.id)).toContain(receipt.receiptId);
  });

  it("leaves the order untouched when the receipt fails", async () => {
    const created = await approvedOrder(30);

    await expect(
      createGoodsReceipt({
        idempotencyKey: nextKey(),
        supplierId,
        locationId,
        purchaseOrderId: created.purchaseOrderId,
        lines: [
          {
            itemId,
            receivedQty: 10,
            receiptUnitId: kgUnitId,
            conversionToBase: 1,
            rejectedQty: 25,
            lineStatus: "DAMAGED",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const detail = await getPurchaseOrderById(actor.organizationId, created.purchaseOrderId);
    expect(detail!.lines[0]!.receivedBaseQty).toBe("0.0000");
    expect(detail!.order.status).toBe("APPROVED");
  });

  it("books only the accepted quantity when part of a delivery is refused", async () => {
    const created = await approvedOrder(50);
    const detail = await getPurchaseOrderById(actor.organizationId, created.purchaseOrderId);

    await createGoodsReceipt({
      idempotencyKey: nextKey(),
      supplierId,
      locationId,
      purchaseOrderId: created.purchaseOrderId,
      lines: [
        {
          itemId,
          purchaseOrderItemId: detail!.lines[0]!.id,
          receivedQty: 30,
          receiptUnitId: kgUnitId,
          conversionToBase: 1,
          rejectedQty: 5,
          unitPrice: 90,
          lineStatus: "DAMAGED",
        },
      ],
    });

    const after = await getPurchaseOrderById(actor.organizationId, created.purchaseOrderId);
    // 30 delivered, 5 refused -> 25 booked against the order.
    expect(after!.lines[0]!.receivedBaseQty).toBe("25.0000");
    expect(after!.lines[0]!.remainingBaseQty).toBe("25.0000");
    expect(after!.order.status).toBe("PARTIALLY_RECEIVED");
  });

  it("cannot cancel an order that has already received something", async () => {
    const created = await approvedOrder(40);
    await receiveAgainst(created.purchaseOrderId, 10);

    await expect(
      setPurchaseOrderStatus(created.purchaseOrderId, "CANCELLED", "ไม่ต้องการแล้ว"),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("remaining quantity and price comparison", () => {
  it("never reports a negative remaining", () => {
    expect(remainingBaseQty("100.0000", "70.0000")).toBe("30.0000");
    expect(remainingBaseQty("100.0000", "100.0000")).toBe("0.0000");
    expect(remainingBaseQty("100.0000", "120.0000")).toBe("0.0000");
  });

  it("reports the percentage change against the supplier's last price", async () => {
    await db
      .insert(supplierItems)
      .values({
        supplierId,
        itemId,
        purchaseUnitId: kgUnitId,
        purchaseConversion: "1",
        lastPrice: "100.0000",
      })
      .onConflictDoUpdate({
        target: [supplierItems.supplierId, supplierItems.itemId],
        set: { lastPrice: "100.0000" },
      });

    const comparison = await getPriceComparison(actor.organizationId, supplierId, [
      { itemId, unitPrice: "108.0000" },
    ]);

    expect(comparison.get(itemId)!.lastPrice).toBe("100.0000");
    expect(comparison.get(itemId)!.changePercent).toBeCloseTo(8, 6);
  });

  it("has no comparison to make for an item never bought from this supplier", async () => {
    await db.delete(supplierItems).where(eq(supplierItems.supplierId, supplierId));

    const comparison = await getPriceComparison(actor.organizationId, supplierId, [
      { itemId, unitPrice: "90.0000" },
    ]);

    expect(comparison.get(itemId)!.lastPrice).toBeNull();
    expect(comparison.get(itemId)!.changePercent).toBeNull();
  });
});
