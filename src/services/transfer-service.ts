import { and, eq, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/database/client";
import {
  inventoryPostings,
  items,
  locations,
  stockBalances,
  stockTransferItems,
  stockTransfers,
  units,
} from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";
import { addQty, formatQty, subQty, toNumericString } from "@/lib/quantity";
import type { TransferInput, TransferPreviewInput } from "@/schemas/transfer";
import { writeAuditLog } from "./audit-service";
import { nextDocumentNumber, retryOnDuplicateNumber } from "./document-number-service";
import { planFefoAllocation } from "./inventory-allocation-service";
import { postMovementAs, type MovementLine } from "./inventory-ledger-service";

export type TransferResult = {
  transferId: string;
  transferNumber: string;
  postingId: string;
  replayed: boolean;
};

export type TransferPreviewLine = {
  itemId: string;
  itemCode: string;
  itemNameTh: string;
  baseUnitCode: string | null;
  requestedBaseQty: string;
  /** Balances at both ends, before and after — what the confirm screen shows. */
  fromBefore: string;
  fromAfter: string;
  toBefore: string;
  toAfter: string;
  shortfallBaseQty: string;
  lots: Array<{ lotNumber: string; expiryDate: string | null; baseQty: string }>;
};

async function balanceAt(
  executor: DbExecutor,
  organizationId: string,
  itemId: string,
  locationId: string,
): Promise<string> {
  const [row] = await executor
    .select({ total: sql<string>`coalesce(sum(${stockBalances.baseQty}), 0)` })
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.organizationId, organizationId),
        eq(stockBalances.itemId, itemId),
        eq(stockBalances.locationId, locationId),
      ),
    );
  return row?.total ?? "0";
}

async function assertLocations(
  executor: DbExecutor,
  organizationId: string,
  fromLocationId: string,
  toLocationId: string,
) {
  if (fromLocationId === toLocationId) {
    throw new AppError("VALIDATION", "สถานที่ต้นทางและปลายทางต้องไม่ใช่ที่เดียวกัน");
  }

  for (const locationId of [fromLocationId, toLocationId]) {
    const [location] = await executor
      .select({ id: locations.id, holdsStock: locations.holdsStock, isActive: locations.isActive })
      .from(locations)
      .where(and(eq(locations.id, locationId), eq(locations.organizationId, organizationId)))
      .limit(1);

    if (!location) throw new AppError("NOT_FOUND", "ไม่พบสถานที่");
    if (!location.holdsStock || !location.isActive) {
      throw new AppError("VALIDATION", "สถานที่นี้ไม่รองรับการเก็บสต๊อก");
    }
  }
}

/**
 * What the transfer would do, without doing it: the lots FEFO would move and the balance
 * at both ends before and after. Read-only, so the frontline can check before committing.
 */
export async function previewTransfer(
  input: TransferPreviewInput,
): Promise<TransferPreviewLine[]> {
  const user = await requirePermission(PERMISSIONS.STOCK_VIEW);
  await assertLocations(db, user.organizationId, input.fromLocationId, input.toLocationId);

  const preview: TransferPreviewLine[] = [];

  for (const line of input.lines) {
    const [item] = await db
      .select({ id: items.id, code: items.code, nameTh: items.nameTh, baseUnitCode: units.code })
      .from(items)
      .leftJoin(units, eq(units.id, items.baseUnitId))
      .where(and(eq(items.id, line.itemId), eq(items.organizationId, user.organizationId)))
      .limit(1);
    if (!item) throw new AppError("NOT_FOUND", "ไม่พบรายการสินค้า");

    const plan = await planFefoAllocation({
      organizationId: user.organizationId,
      itemId: line.itemId,
      locationId: input.fromLocationId,
      baseQty: line.baseQty,
    });

    const [fromBefore, toBefore] = await Promise.all([
      balanceAt(db, user.organizationId, line.itemId, input.fromLocationId),
      balanceAt(db, user.organizationId, line.itemId, input.toLocationId),
    ]);

    // Only what can actually be allocated will move.
    const moving = subQty(toNumericString(line.baseQty), plan.shortfallBaseQty);

    preview.push({
      itemId: line.itemId,
      itemCode: item.code,
      itemNameTh: item.nameTh,
      baseUnitCode: item.baseUnitCode,
      requestedBaseQty: toNumericString(line.baseQty),
      fromBefore,
      fromAfter: subQty(fromBefore, moving),
      toBefore,
      toAfter: addQty(toBefore, moving),
      shortfallBaseQty: plan.shortfallBaseQty,
      lots: plan.lines.map((allocation) => ({
        lotNumber: allocation.lotNumber,
        expiryDate: allocation.expiryDate,
        baseQty: allocation.baseQty,
      })),
    });
  }

  return preview;
}

/**
 * Moves stock between two locations.
 *
 * Both legs are written into a single posting: the TRANSFER_OUT rows at the source and the
 * TRANSFER_IN rows at the destination share one reference, so the two halves can never
 * drift apart or be reconciled separately.
 *
 * Which lots move is decided by FEFO, computed inside the same transaction that posts it —
 * the source balance is read under the same lock that the posting takes, so a concurrent
 * issue cannot empty a lot between planning and posting.
 */
export async function createStockTransfer(input: TransferInput): Promise<TransferResult> {
  const user = await requirePermission(PERMISSIONS.TRANSFER_CREATE);

  const existing = await findTransferByIdempotencyKey(user.organizationId, input.idempotencyKey);
  if (existing) return existing;

  return retryOnDuplicateNumber(() =>
    db.transaction(async (tx) => {
      await assertLocations(tx, user.organizationId, input.fromLocationId, input.toLocationId);

      const transferNumber = await nextDocumentNumber(tx, user.organizationId, "stockTransfer");
      const transferredAt = new Date();

      const [transfer] = await tx
        .insert(stockTransfers)
        .values({
          organizationId: user.organizationId,
          transferNumber,
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          status: "CONFIRMED",
          transferredAt,
          note: input.note ?? null,
          createdBy: user.id,
          confirmedBy: user.id,
          confirmedAt: transferredAt,
        })
        .returning();

      const movementLines: MovementLine[] = [];

      for (const line of input.lines) {
        const [item] = await tx
          .select({ id: items.id, nameTh: items.nameTh })
          .from(items)
          .where(and(eq(items.id, line.itemId), eq(items.organizationId, user.organizationId)))
          .limit(1);
        if (!item) throw new AppError("NOT_FOUND", "ไม่พบรายการสินค้า");

        const plan = await planFefoAllocation({
          organizationId: user.organizationId,
          itemId: line.itemId,
          locationId: input.fromLocationId,
          baseQty: line.baseQty,
          executor: tx,
        });

        if (Number(plan.shortfallBaseQty) > 0) {
          const expiredNote =
            Number(plan.expiredBaseQty) > 0
              ? ` (มีของหมดอายุ ${formatQty(plan.expiredBaseQty)} ที่โอนไม่ได้)`
              : "";
          throw new AppError(
            "INSUFFICIENT_STOCK",
            `${item.nameTh} มีไม่พอสำหรับโอน: ต้องการ ${formatQty(line.baseQty)} แต่โอนได้ ${formatQty(plan.usableBaseQty)}${expiredNote}`,
          );
        }

        await tx.insert(stockTransferItems).values({
          stockTransferId: transfer!.id,
          itemId: line.itemId,
          transferBaseQty: toNumericString(line.baseQty),
          note: line.note ?? null,
        });

        // Both legs, lot by lot, so the destination keeps the same expiry dates.
        for (const allocation of plan.lines) {
          movementLines.push({
            type: "TRANSFER_OUT",
            itemId: line.itemId,
            lotId: allocation.lotId,
            locationId: input.fromLocationId,
            baseQty: allocation.baseQty,
            unitCost: allocation.unitCost,
          });
          movementLines.push({
            type: "TRANSFER_IN",
            itemId: line.itemId,
            lotId: allocation.lotId,
            locationId: input.toLocationId,
            baseQty: allocation.baseQty,
            unitCost: allocation.unitCost,
          });
        }
      }

      const posted = await postMovementAs(
        user,
        {
          idempotencyKey: input.idempotencyKey,
          referenceType: "STOCK_TRANSFER",
          referenceId: transfer!.id,
          referenceNumber: transferNumber,
          transactionAt: transferredAt,
          note: input.note ?? null,
          lines: movementLines,
        },
        tx,
      );

      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "CONFIRM",
        entityType: "stock_transfer",
        entityId: transfer!.id,
        afterData: {
          transferNumber,
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          lines: input.lines.length,
          lotMovements: movementLines.length,
        },
        note: input.note ?? null,
      });

      return {
        transferId: transfer!.id,
        transferNumber,
        postingId: posted.postingId,
        replayed: false,
      };
    }),
  );
}

async function findTransferByIdempotencyKey(
  organizationId: string,
  idempotencyKey: string,
): Promise<TransferResult | null> {
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
    transferId: posting.referenceId,
    transferNumber: posting.referenceNumber ?? "",
    postingId: posting.id,
    replayed: true,
  };
}
