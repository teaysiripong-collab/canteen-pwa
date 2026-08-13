import { and, eq } from "drizzle-orm";
import { db, type DbExecutor } from "@/database/client";
import {
  goodsReceiptItems,
  goodsReceipts,
  inventoryPostings,
  items,
  locations,
  supplierItems,
  suppliers,
} from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import { todayIso } from "@/lib/date";
import { AppError } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";
import { compareQty, divQty, mulQty, toNumericString } from "@/lib/quantity";
import type { ReceivingInput, ReceivingLineInput } from "@/schemas/receiving";
import { writeAuditLog } from "./audit-service";
import { nextDocumentNumber, retryOnDuplicateNumber } from "./document-number-service";
import { createLot } from "./inventory-lot-service";
import { postMovementAs, type MovementLine } from "./inventory-ledger-service";

export type ReceivingResult = {
  receiptId: string;
  receiptNumber: string;
  postingId: string | null;
  /** Lines that entered stock, for the success screen. */
  acceptedLines: number;
  replayed: boolean;
};

/** Quantities on the document are in the receipt unit; stock is always in the base unit. */
function convertLine(line: ReceivingLineInput) {
  const receivedBaseQty = mulQty(line.receivedQty, line.conversionToBase);
  const rejectedBaseQty = mulQty(line.rejectedQty, line.conversionToBase);
  const acceptedBaseQty = mulQty(line.receivedQty - line.rejectedQty, line.conversionToBase);

  // The invoice prices a purchase unit; the ledger and every cost report use base units.
  const unitCost =
    line.unitPrice === undefined ? "0.0000" : divQty(line.unitPrice, line.conversionToBase);

  return { receivedBaseQty, rejectedBaseQty, acceptedBaseQty, unitCost };
}

async function assertReferences(tx: DbExecutor, organizationId: string, input: ReceivingInput) {
  const [supplier] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(
      and(eq(suppliers.id, input.supplierId), eq(suppliers.organizationId, organizationId)),
    )
    .limit(1);
  if (!supplier) throw new AppError("NOT_FOUND", "ไม่พบผู้ขาย");

  const [location] = await tx
    .select({ id: locations.id, holdsStock: locations.holdsStock, isActive: locations.isActive })
    .from(locations)
    .where(
      and(eq(locations.id, input.locationId), eq(locations.organizationId, organizationId)),
    )
    .limit(1);
  if (!location) throw new AppError("NOT_FOUND", "ไม่พบสถานที่");
  if (!location.holdsStock || !location.isActive) {
    throw new AppError("VALIDATION", "สถานที่นี้ไม่รองรับการเก็บสต๊อก");
  }

  for (const line of input.lines) {
    const [item] = await tx
      .select({ id: items.id, isActive: items.isActive })
      .from(items)
      .where(and(eq(items.id, line.itemId), eq(items.organizationId, organizationId)))
      .limit(1);
    if (!item) throw new AppError("NOT_FOUND", "ไม่พบรายการสินค้า");
    if (!item.isActive) throw new AppError("VALIDATION", "วัตถุดิบนี้ถูกปิดใช้งานแล้ว");
  }
}

/**
 * Records what arrived at the door.
 *
 * Everything below happens in one database transaction: the receipt, its lines, a lot per
 * accepted line, and the RECEIVE rows in the ledger. A failure anywhere — a rejected
 * quantity larger than what was delivered, a lot number clash, a permission problem —
 * leaves no half-received delivery behind.
 *
 * Quantities refused at the door stay on the document but never enter stock, so the paper
 * trail matches what the supplier actually delivered while the balance matches the shelf.
 */
export async function createGoodsReceipt(input: ReceivingInput): Promise<ReceivingResult> {
  const user = await requirePermission(PERMISSIONS.RECEIVE_CREATE);

  // A replayed submission must not create a second receipt for the same delivery.
  const existing = await findReceiptByIdempotencyKey(user.organizationId, input.idempotencyKey);
  if (existing) return existing;

  return retryOnDuplicateNumber(() =>
    db.transaction(async (tx) => {
      await assertReferences(tx, user.organizationId, input);

      const receiptNumber = await nextDocumentNumber(tx, user.organizationId, "goodsReceipt");
      const receivedAt = new Date();

      const [receipt] = await tx
        .insert(goodsReceipts)
        .values({
          organizationId: user.organizationId,
          receiptNumber,
          purchaseOrderId: input.purchaseOrderId ?? null,
          supplierId: input.supplierId,
          locationId: input.locationId,
          status: "CONFIRMED",
          receivedAt,
          supplierDocNumber: input.supplierDocNumber ?? null,
          note: input.note ?? null,
          createdBy: user.id,
          confirmedBy: user.id,
          confirmedAt: receivedAt,
        })
        .returning();

      const movementLines: MovementLine[] = [];

      for (const line of input.lines) {
        const converted = convertLine(line);
        const entersStock = compareQty(converted.acceptedBaseQty, "0") > 0;

        // A lot only exists for stock that was actually accepted.
        const lot = entersStock
          ? await createLot(
              {
                organizationId: user.organizationId,
                itemId: line.itemId,
                lotNumber: line.lotNumber ?? null,
                supplierId: input.supplierId,
                goodsReceiptId: receipt!.id,
                receivedDate: todayIso(),
                manufactureDate: line.manufactureDate ?? null,
                expiryDate: line.expiryDate ?? null,
                receivedBaseQty: converted.acceptedBaseQty,
                unitCost: converted.unitCost,
                note: line.note ?? null,
              },
              tx,
            )
          : null;

        await tx.insert(goodsReceiptItems).values({
          goodsReceiptId: receipt!.id,
          itemId: line.itemId,
          receivedQty: toNumericString(line.receivedQty),
          receiptUnitId: line.receiptUnitId,
          conversionToBase: toNumericString(line.conversionToBase),
          receivedBaseQty: converted.receivedBaseQty,
          rejectedBaseQty: converted.rejectedBaseQty,
          lineStatus: line.lineStatus,
          unitCost: converted.unitCost,
          lotNumber: lot?.lotNumber ?? line.lotNumber ?? null,
          manufactureDate: line.manufactureDate ?? null,
          expiryDate: lot?.expiryDate ?? line.expiryDate ?? null,
          note: line.note ?? null,
        });

        if (lot) {
          movementLines.push({
            type: "RECEIVE",
            itemId: line.itemId,
            lotId: lot.id,
            locationId: input.locationId,
            baseQty: converted.acceptedBaseQty,
            unitCost: converted.unitCost,
          });
        }

        if (line.unitPrice !== undefined) {
          await rememberPurchasePrice(tx, input.supplierId, line.itemId, line.unitPrice);
        }
      }

      // Sharing the transaction is what keeps the document and the ledger in step.
      const posted =
        movementLines.length > 0
          ? await postMovementAs(
              user,
              {
                idempotencyKey: input.idempotencyKey,
                referenceType: "GOODS_RECEIPT",
                referenceId: receipt!.id,
                referenceNumber: receiptNumber,
                transactionAt: receivedAt,
                note: input.note ?? null,
                lines: movementLines,
              },
              tx,
            )
          : null;

      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "CONFIRM",
        entityType: "goods_receipt",
        entityId: receipt!.id,
        afterData: {
          receiptNumber,
          supplierId: input.supplierId,
          locationId: input.locationId,
          lines: input.lines.length,
          acceptedLines: movementLines.length,
        },
        note: input.supplierDocNumber ? `เอกสารผู้ขาย ${input.supplierDocNumber}` : null,
      });

      return {
        receiptId: receipt!.id,
        receiptNumber,
        postingId: posted?.postingId ?? null,
        acceptedLines: movementLines.length,
        replayed: false,
      };
    }),
  );
}

/**
 * Keeps the supplier's latest price on the mapping so purchasing can show what the item
 * last cost, and Phase 12 can compare it against the average.
 */
async function rememberPurchasePrice(
  tx: DbExecutor,
  supplierId: string,
  itemId: string,
  unitPrice: number,
): Promise<void> {
  await tx
    .update(supplierItems)
    .set({ lastPrice: toNumericString(unitPrice), lastPriceAt: new Date(), updatedAt: new Date() })
    .where(and(eq(supplierItems.supplierId, supplierId), eq(supplierItems.itemId, itemId)));
}

async function findReceiptByIdempotencyKey(
  organizationId: string,
  idempotencyKey: string,
): Promise<ReceivingResult | null> {
  const [posting] = await db
    .select({
      id: inventoryPostings.id,
      referenceId: inventoryPostings.referenceId,
      referenceNumber: inventoryPostings.referenceNumber,
    })
    .from(inventoryPostings)
    .where(
      and(
        eq(inventoryPostings.organizationId, organizationId),
        eq(inventoryPostings.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  if (!posting?.referenceId) return null;

  return {
    receiptId: posting.referenceId,
    receiptNumber: posting.referenceNumber ?? "",
    postingId: posting.id,
    acceptedLines: 0,
    replayed: true,
  };
}
