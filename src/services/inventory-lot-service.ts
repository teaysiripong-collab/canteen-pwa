import { and, eq } from "drizzle-orm";
import { db, type DbExecutor } from "@/database/client";
import { inventoryLots, items } from "@/database/schema";
import { AppError, isUniqueViolation } from "@/lib/errors";
import { toNumericString, type Numeric } from "@/lib/quantity";

export type CreateLotInput = {
  organizationId: string;
  itemId: string;
  receivedBaseQty: Numeric;
  /** Generated from the item code and the received date when the caller has no supplier lot. */
  lotNumber?: string | null;
  supplierId?: string | null;
  goodsReceiptId?: string | null;
  goodsReceiptItemId?: string | null;
  receivedDate?: string;
  manufactureDate?: string | null;
  expiryDate?: string | null;
  unitCost?: Numeric;
  note?: string | null;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

/**
 * Creates the batch a movement can then be posted against. Expiry is derived from the
 * item's shelf life when the receiver did not read one off the packaging.
 *
 * Lots are never created outside a receiving or opening-balance flow, so this stays an
 * internal service: it takes the organization from its caller, which has already
 * authorized the action.
 */
export async function createLot(input: CreateLotInput, executor: DbExecutor = db) {
  const [item] = await executor
    .select({ id: items.id, code: items.code, baseUnitId: items.baseUnitId, shelfLifeDays: items.shelfLifeDays })
    .from(items)
    .where(and(eq(items.id, input.itemId), eq(items.organizationId, input.organizationId)))
    .limit(1);

  if (!item) throw new AppError("NOT_FOUND", "ไม่พบรายการสินค้า");

  const receivedDate = input.receivedDate ?? todayIso();

  let expiryDate = input.expiryDate ?? null;
  if (!expiryDate && item.shelfLifeDays !== null) {
    const expiry = new Date(`${receivedDate}T00:00:00Z`);
    expiry.setUTCDate(expiry.getUTCDate() + item.shelfLifeDays);
    expiryDate = expiry.toISOString().slice(0, 10);
  }

  // A generated number can collide with an existing one on a busy day; retry with a new suffix.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const lotNumber =
      input.lotNumber?.trim() ||
      `${item.code}-${receivedDate.replaceAll("-", "")}-${randomSuffix()}`;

    try {
      const [lot] = await executor
        .insert(inventoryLots)
        .values({
          organizationId: input.organizationId,
          itemId: item.id,
          lotNumber,
          supplierId: input.supplierId ?? null,
          goodsReceiptId: input.goodsReceiptId ?? null,
          goodsReceiptItemId: input.goodsReceiptItemId ?? null,
          receivedDate,
          manufactureDate: input.manufactureDate ?? null,
          expiryDate,
          receivedBaseQty: toNumericString(input.receivedBaseQty),
          baseUnitId: item.baseUnitId,
          unitCost: toNumericString(input.unitCost ?? 0),
          note: input.note ?? null,
        })
        .returning();

      return lot!;
    } catch (error) {
      const callerSuppliedNumber = Boolean(input.lotNumber?.trim());
      if (isUniqueViolation(error) && !callerSuppliedNumber) continue;
      if (isUniqueViolation(error)) {
        throw new AppError("CONFLICT", "เลขที่ลอตนี้ถูกใช้กับวัตถุดิบนี้แล้ว", {
          fieldErrors: { lotNumber: ["เลขที่ลอตนี้ถูกใช้กับวัตถุดิบนี้แล้ว"] },
        });
      }
      throw error;
    }
  }

  throw new AppError("INTERNAL", "ไม่สามารถสร้างเลขที่ลอตได้ กรุณาลองใหม่");
}
