import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { PERMISSIONS, type PermissionCode, type RoleCode } from "@/lib/permissions";

/**
 * Gate 7: กะเพราไก่ with ไก่บด "30+20" must come back as เช้า 30 / ดึก 20 / รวม 50,
 * and a published version must never change afterwards.
 */
const actor = {
  id: "",
  organizationId: "",
  email: "integration-bom@canteen.local",
  fullName: "Integration BOM",
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
  items,
  mealPeriods,
  menus,
  organizations,
  recipeItemPeriodQuantities,
  recipeItems,
  recipeVersions,
  recipes,
  units,
  users,
} = await import("@/database/schema");
const { openDraftVersion, publishBomVersion, saveBomDraft, listMealPeriods } = await import(
  "@/services/bom-service"
);
const { getRecipeVersionDetail } = await import("@/repositories/bom-repository");

const MENU_CODE = "TEST-BOM-MENU";
const ITEM_CODE = "TEST-BOM-CHICKEN";
const ITEM_CODE_2 = "TEST-BOM-BASIL";

let menuId = "";
let chickenId = "";
let basilId = "";
let kgUnitId = "";

async function purge() {
  if (!menuId) return;

  const recipeRows = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.menuId, menuId));
  const recipeIds = recipeRows.map((row) => row.id);
  if (recipeIds.length === 0) return;

  const versionRows = await db
    .select({ id: recipeVersions.id })
    .from(recipeVersions)
    .where(inArray(recipeVersions.recipeId, recipeIds));
  const versionIds = versionRows.map((row) => row.id);

  if (versionIds.length > 0) {
    const itemRows = await db
      .select({ id: recipeItems.id })
      .from(recipeItems)
      .where(inArray(recipeItems.recipeVersionId, versionIds));
    const itemIds = itemRows.map((row) => row.id);

    if (itemIds.length > 0) {
      await db
        .delete(recipeItemPeriodQuantities)
        .where(inArray(recipeItemPeriodQuantities.recipeItemId, itemIds));
      await db.delete(recipeItems).where(inArray(recipeItems.id, itemIds));
    }
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, versionIds));
    await db.delete(recipeVersions).where(inArray(recipeVersions.id, versionIds));
  }

  await db.delete(recipes).where(inArray(recipes.id, recipeIds));
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

  const [menu] = await db
    .insert(menus)
    .values({ organizationId: organization.id, code: MENU_CODE, nameTh: "กะเพราไก่ (ทดสอบ)" })
    .onConflictDoUpdate({
      target: [menus.organizationId, menus.code],
      set: { nameTh: "กะเพราไก่ (ทดสอบ)" },
    })
    .returning();
  menuId = menu!.id;

  const [chicken] = await db
    .insert(items)
    .values({
      organizationId: organization.id,
      code: ITEM_CODE,
      nameTh: "ไก่บด (ทดสอบ BOM)",
      baseUnitId: kgUnitId,
      purchaseUnitId: kgUnitId,
      purchaseConversion: "1",
    })
    .onConflictDoUpdate({ target: [items.organizationId, items.code], set: { nameTh: "ไก่บด (ทดสอบ BOM)" } })
    .returning();
  chickenId = chicken!.id;

  const [basil] = await db
    .insert(items)
    .values({
      organizationId: organization.id,
      code: ITEM_CODE_2,
      nameTh: "ใบกะเพรา (ทดสอบ BOM)",
      baseUnitId: kgUnitId,
      purchaseUnitId: kgUnitId,
      purchaseConversion: "1",
    })
    .onConflictDoUpdate({ target: [items.organizationId, items.code], set: { nameTh: "ใบกะเพรา (ทดสอบ BOM)" } })
    .returning();
  basilId = basil!.id;
});

beforeEach(async () => {
  await purge();
});

afterAll(async () => {
  await purge();
  await db.delete(menus).where(eq(menus.id, menuId));
  await db.delete(items).where(inArray(items.id, [chickenId, basilId]));
  await db.delete(users).where(eq(users.email, actor.email));
});

describe("BOM with day/night quantities", () => {
  it("splits 30+20 into เช้า 30, ดึก 20 and totals 50", async () => {
    const draft = await openDraftVersion(menuId);

    await saveBomDraft({
      recipeVersionId: draft.id,
      yieldQty: 1,
      yieldUnitId: null,
      lines: [
        { itemId: chickenId, unitId: kgUnitId, quantityInput: "30+20", wasteFactor: 0 },
      ],
    });

    const detail = await getRecipeVersionDetail(actor.organizationId, draft.id);
    const line = detail!.lines[0]!;

    expect(line.quantity).toBe("50.0000");

    const periods = await listMealPeriods(actor.organizationId);
    const day = line.periods.find((p) => p.mealPeriodId === periods[0]!.id);
    const night = line.periods.find((p) => p.mealPeriodId === periods[1]!.id);

    expect(periods[0]!.code).toBe("DAY");
    expect(periods[1]!.code).toBe("NIGHT");
    expect(day!.quantity).toBe("30.0000");
    expect(night!.quantity).toBe("20.0000");
  });

  it("keeps the stored total equal to the sum of the periods", async () => {
    const draft = await openDraftVersion(menuId);

    await saveBomDraft({
      recipeVersionId: draft.id,
      yieldQty: 1,
      yieldUnitId: null,
      lines: [
        { itemId: chickenId, unitId: kgUnitId, quantityInput: "18+12", wasteFactor: 0 },
        { itemId: basilId, unitId: kgUnitId, quantityInput: "2.5", wasteFactor: 0.05 },
      ],
    });

    const detail = await getRecipeVersionDetail(actor.organizationId, draft.id);

    for (const line of detail!.lines) {
      const sum = line.periods.reduce((total, period) => total + Number(period.quantity), 0);
      expect(Number(line.quantity)).toBeCloseTo(sum, 4);
    }

    const basil = detail!.lines.find((line) => line.itemId === basilId)!;
    expect(basil.quantity).toBe("2.5000");
    expect(basil.wasteFactor).toBe("0.0500");
  });

  it("rejects a malformed quantity with a Thai field error", async () => {
    const draft = await openDraftVersion(menuId);

    await expect(
      saveBomDraft({
        recipeVersionId: draft.id,
        yieldQty: 1,
        yieldUnitId: null,
        lines: [{ itemId: chickenId, unitId: kgUnitId, quantityInput: "30+", wasteFactor: 0 }],
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { "lines.0.quantityInput": ["กรอกได้เฉพาะตัวเลข เช่น 30+20"] },
    });
  });

  it("rejects the same ingredient twice", async () => {
    const draft = await openDraftVersion(menuId);

    await expect(
      saveBomDraft({
        recipeVersionId: draft.id,
        yieldQty: 1,
        yieldUnitId: null,
        lines: [
          { itemId: chickenId, unitId: kgUnitId, quantityInput: "10", wasteFactor: 0 },
          { itemId: chickenId, unitId: kgUnitId, quantityInput: "5", wasteFactor: 0 },
        ],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("BOM versioning", () => {
  it("reuses the open draft instead of stacking new versions", async () => {
    const first = await openDraftVersion(menuId);
    const second = await openDraftVersion(menuId);

    expect(second.id).toBe(first.id);
    expect(second.versionNo).toBe(1);
  });

  it("refuses to edit a published version", async () => {
    const draft = await openDraftVersion(menuId);
    await saveBomDraft({
      recipeVersionId: draft.id,
      yieldQty: 1,
      yieldUnitId: null,
      lines: [{ itemId: chickenId, unitId: kgUnitId, quantityInput: "30+20", wasteFactor: 0 }],
    });
    await publishBomVersion(draft.id);

    await expect(
      saveBomDraft({
        recipeVersionId: draft.id,
        yieldQty: 1,
        yieldUnitId: null,
        lines: [{ itemId: chickenId, unitId: kgUnitId, quantityInput: "99", wasteFactor: 0 }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("starts v2 from a copy of v1 and leaves v1 untouched", async () => {
    const v1 = await openDraftVersion(menuId);
    await saveBomDraft({
      recipeVersionId: v1.id,
      yieldQty: 1,
      yieldUnitId: null,
      lines: [
        { itemId: chickenId, unitId: kgUnitId, quantityInput: "20", wasteFactor: 0 },
        { itemId: basilId, unitId: kgUnitId, quantityInput: "2", wasteFactor: 0 },
      ],
    });
    await publishBomVersion(v1.id);

    const v2 = await openDraftVersion(menuId);
    expect(v2.versionNo).toBe(2);

    // The copy carries v1's lines across.
    const copied = await getRecipeVersionDetail(actor.organizationId, v2.id);
    expect(copied!.lines).toHaveLength(2);
    expect(copied!.lines.find((line) => line.itemId === chickenId)!.quantity).toBe("20.0000");

    await saveBomDraft({
      recipeVersionId: v2.id,
      yieldQty: 1,
      yieldUnitId: null,
      lines: [
        { itemId: chickenId, unitId: kgUnitId, quantityInput: "18", wasteFactor: 0 },
        { itemId: basilId, unitId: kgUnitId, quantityInput: "2.5", wasteFactor: 0 },
      ],
    });

    // v1 is history: it must read exactly as it was published.
    const original = await getRecipeVersionDetail(actor.organizationId, v1.id);
    expect(original!.lines.find((line) => line.itemId === chickenId)!.quantity).toBe("20.0000");
    expect(original!.lines.find((line) => line.itemId === basilId)!.quantity).toBe("2.0000");

    const next = await getRecipeVersionDetail(actor.organizationId, v2.id);
    expect(next!.lines.find((line) => line.itemId === chickenId)!.quantity).toBe("18.0000");
    expect(next!.lines.find((line) => line.itemId === basilId)!.quantity).toBe("2.5000");
  });

  it("carries the period split into the copied version", async () => {
    const v1 = await openDraftVersion(menuId);
    await saveBomDraft({
      recipeVersionId: v1.id,
      yieldQty: 1,
      yieldUnitId: null,
      lines: [{ itemId: chickenId, unitId: kgUnitId, quantityInput: "30+20", wasteFactor: 0 }],
    });
    await publishBomVersion(v1.id);

    const v2 = await openDraftVersion(menuId);
    const copied = await getRecipeVersionDetail(actor.organizationId, v2.id);
    const quantities = copied!.lines[0]!.periods.map((period) => period.quantity).sort();

    expect(quantities).toEqual(["20.0000", "30.0000"]);
  });

  it("refuses to publish an empty draft", async () => {
    const draft = await openDraftVersion(menuId);
    await expect(publishBomVersion(draft.id)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("requires recipe.manage to edit", async () => {
    const draft = await openDraftVersion(menuId);
    const saved = actor.permissions;
    actor.permissions = [PERMISSIONS.RECIPE_VIEW];

    await expect(
      saveBomDraft({
        recipeVersionId: draft.id,
        yieldQty: 1,
        yieldUnitId: null,
        lines: [{ itemId: chickenId, unitId: kgUnitId, quantityInput: "1", wasteFactor: 0 }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    actor.permissions = saved;
  });

  it("stamps the effective date when publishing", async () => {
    const draft = await openDraftVersion(menuId);
    await saveBomDraft({
      recipeVersionId: draft.id,
      yieldQty: 1,
      yieldUnitId: null,
      lines: [{ itemId: chickenId, unitId: kgUnitId, quantityInput: "5", wasteFactor: 0 }],
    });

    const published = await publishBomVersion(draft.id, "2026-09-01");
    expect(published.isPublished).toBe(true);
    expect(published.effectiveFrom).toBe("2026-09-01");
  });

  it("keeps meal periods as data, not hardcoded columns", async () => {
    const periods = await db
      .select()
      .from(mealPeriods)
      .where(eq(mealPeriods.organizationId, actor.organizationId));

    // The parser maps values positionally onto however many periods exist.
    expect(periods.length).toBeGreaterThanOrEqual(2);
  });
});
