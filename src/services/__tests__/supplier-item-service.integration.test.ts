import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const actor = {
  id: "",
  organizationId: "",
  email: "integration-buyer@canteen.local",
  fullName: "Integration Buyer",
  defaultLocationId: null,
  defaultLocationName: null,
  roleCodes: ["ADMIN"],
  permissions: [] as string[],
};

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => actor),
  requireUser: vi.fn(async () => actor),
  getCurrentUser: vi.fn(async () => actor),
  getRequestMetadata: vi.fn(async () => ({ ipAddress: "127.0.0.1", userAgent: "vitest" })),
}));

const { db } = await import("@/database/client");
const { auditLogs, items, organizations, supplierItems, suppliers, units, users } = await import(
  "@/database/schema"
);
const { createSupplierItem, setSupplierItemActive, updateSupplierItem } = await import(
  "@/services/supplier-item-service"
);

let itemId = "";
let otherSupplierId = "";
let preferredSupplierId = "";
let unitId = "";
const createdMappingIds: string[] = [];

async function cleanUp() {
  for (const id of createdMappingIds) {
    await db.delete(auditLogs).where(eq(auditLogs.entityId, id));
    await db.delete(supplierItems).where(eq(supplierItems.id, id));
  }
  createdMappingIds.length = 0;
  await db.delete(users).where(eq(users.email, actor.email));
}

beforeAll(async () => {
  const [organization] = await db.select().from(organizations).limit(1);
  if (!organization) throw new Error("Run `npm run db:seed` before the integration tests.");
  actor.organizationId = organization.id;

  await db.delete(users).where(eq(users.email, actor.email));
  const [row] = await db
    .insert(users)
    .values({ organizationId: organization.id, email: actor.email, fullName: actor.fullName })
    .returning();
  actor.id = row!.id;

  // VEG-004 is seeded with a single supplier, so the preferred-flag assertions are unambiguous.
  const [item] = await db.select().from(items).where(eq(items.code, "VEG-004")).limit(1);
  itemId = item!.id;

  const [makro] = await db.select().from(suppliers).where(eq(suppliers.code, "MAKRO")).limit(1);
  const [puangploy] = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.code, "PUANGPLOY"))
    .limit(1);
  otherSupplierId = makro!.id;
  preferredSupplierId = puangploy!.id;

  const [kg] = await db.select().from(units).where(eq(units.code, "KG")).limit(1);
  unitId = kg!.id;

  // Remove any mapping left behind by an earlier run of this file.
  await db.delete(supplierItems).where(eq(supplierItems.supplierId, otherSupplierId));
});

afterAll(async () => {
  await cleanUp();
});

describe("supplier item service", () => {
  it("stores the purchasing terms the planner needs and stamps the price date", async () => {
    const created = await createSupplierItem({
      supplierId: otherSupplierId,
      itemId,
      supplierItemCode: "MK-0001",
      supplierItemName: undefined,
      purchaseUnitId: unitId,
      purchaseConversion: 1,
      moq: 4,
      packSize: 2,
      leadTimeDays: 3,
      lastPrice: 72.25,
      isPreferred: false,
      isActive: true,
    });
    createdMappingIds.push(created.id);

    expect(created.moq).toBe("4.0000");
    expect(created.packSize).toBe("2.0000");
    expect(created.leadTimeDays).toBe(3);
    expect(created.lastPrice).toBe("72.2500");
    expect(created.lastPriceAt).toBeInstanceOf(Date);
  });

  it("refuses a duplicate mapping for the same supplier and item", async () => {
    await expect(
      createSupplierItem({
        supplierId: otherSupplierId,
        itemId,
        supplierItemCode: undefined,
        supplierItemName: undefined,
        purchaseUnitId: null,
        purchaseConversion: undefined,
        moq: 0,
        packSize: undefined,
        leadTimeDays: undefined,
        lastPrice: undefined,
        isPreferred: false,
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("leaves the price date alone when the price did not change", async () => {
    const id = createdMappingIds[0]!;
    const [before] = await db.select().from(supplierItems).where(eq(supplierItems.id, id)).limit(1);

    const updated = await updateSupplierItem(id, {
      supplierId: otherSupplierId,
      itemId,
      supplierItemCode: "MK-0002",
      supplierItemName: undefined,
      purchaseUnitId: unitId,
      purchaseConversion: 1,
      moq: 4,
      packSize: 2,
      leadTimeDays: 3,
      lastPrice: 72.25,
      isPreferred: false,
      isActive: true,
    });

    expect(updated.supplierItemCode).toBe("MK-0002");
    expect(updated.lastPriceAt?.getTime()).toBe(before!.lastPriceAt?.getTime());
  });

  it("moves the price date when the price actually changes", async () => {
    const id = createdMappingIds[0]!;
    const [before] = await db.select().from(supplierItems).where(eq(supplierItems.id, id)).limit(1);

    const updated = await updateSupplierItem(id, {
      supplierId: otherSupplierId,
      itemId,
      supplierItemCode: "MK-0002",
      supplierItemName: undefined,
      purchaseUnitId: unitId,
      purchaseConversion: 1,
      moq: 4,
      packSize: 2,
      leadTimeDays: 3,
      lastPrice: 80,
      isPreferred: false,
      isActive: true,
    });

    expect(updated.lastPrice).toBe("80.0000");
    expect(updated.lastPriceAt!.getTime()).toBeGreaterThan(before!.lastPriceAt!.getTime());
  });

  it("keeps exactly one preferred supplier per item", async () => {
    const id = createdMappingIds[0]!;

    await updateSupplierItem(id, {
      supplierId: otherSupplierId,
      itemId,
      supplierItemCode: "MK-0002",
      supplierItemName: undefined,
      purchaseUnitId: unitId,
      purchaseConversion: 1,
      moq: 4,
      packSize: 2,
      leadTimeDays: 3,
      lastPrice: 80,
      isPreferred: true,
      isActive: true,
    });

    const mappings = await db.select().from(supplierItems).where(eq(supplierItems.itemId, itemId));
    const preferred = mappings.filter((mapping) => mapping.isPreferred);

    expect(preferred).toHaveLength(1);
    expect(preferred[0]!.supplierId).toBe(otherSupplierId);

    // The seeded Puangploy mapping must have been demoted rather than removed.
    expect(mappings.some((mapping) => mapping.supplierId === preferredSupplierId)).toBe(true);
  });

  it("deactivates a mapping instead of deleting it", async () => {
    const id = createdMappingIds[0]!;
    const updated = await setSupplierItemActive(id, false);

    expect(updated.isActive).toBe(false);

    const [stillThere] = await db.select().from(supplierItems).where(eq(supplierItems.id, id)).limit(1);
    expect(stillThere).toBeDefined();
  });
});
