import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/database/client";
import {
  inventoryLots,
  inventoryPostings,
  inventoryTransactions,
  items,
  locations,
  stockBalances,
} from "@/database/schema";
import { requireUser, type SessionUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import {
  directionOfType,
  oppositeDirection,
  type DirectionalTransactionType,
  type ReferenceType,
  type StockDirection,
  type WasteReason,
} from "@/lib/inventory/transaction-types";
import { hasPermission, PERMISSIONS, type PermissionCode } from "@/lib/permissions";
import { addQty, compareQty, formatQty, subQty, toNumericString, type Numeric } from "@/lib/quantity";
import { writeAuditLog } from "./audit-service";

/**
 * Which permission each kind of movement needs. Authorization lives here rather than only
 * in the calling workflow, so no future caller can move stock without being checked.
 */
const REQUIRED_PERMISSION: Record<DirectionalTransactionType, PermissionCode> = {
  OPENING_BALANCE: PERMISSIONS.ADJUSTMENT_CREATE,
  RECEIVE: PERMISSIONS.RECEIVE_CREATE,
  TRANSFER_IN: PERMISSIONS.TRANSFER_CREATE,
  TRANSFER_OUT: PERMISSIONS.TRANSFER_CREATE,
  ADJUSTMENT_IN: PERMISSIONS.ADJUSTMENT_CREATE,
  ADJUSTMENT_OUT: PERMISSIONS.ADJUSTMENT_CREATE,
  ISSUE: PERMISSIONS.ISSUE_CREATE,
  WASTE: PERMISSIONS.ADJUSTMENT_CREATE,
  RETURN_TO_SUPPLIER: PERMISSIONS.ADJUSTMENT_CREATE,
  RETURN_TO_STOCK: PERMISSIONS.ADJUSTMENT_CREATE,
};

export type MovementLine = {
  type: DirectionalTransactionType;
  itemId: string;
  lotId: string;
  locationId: string;
  /** Always positive and always in the item's base unit. */
  baseQty: Numeric;
  /** Defaults to the lot's unit cost, which is what costing reads back later. */
  unitCost?: Numeric;
  /** Only meaningful on a WASTE line; ignored elsewhere so a cause cannot be misfiled. */
  wasteReason?: WasteReason | null;
  note?: string | null;
};

export type PostMovementInput = {
  /**
   * Stable key for this user action. Re-submitting the same key returns the original
   * posting instead of moving stock a second time.
   */
  idempotencyKey: string;
  referenceType: ReferenceType;
  referenceId?: string | null;
  referenceNumber?: string | null;
  transactionAt?: Date;
  note?: string | null;
  lines: MovementLine[];
};

export type PostedMovement = {
  postingId: string;
  transactionIds: string[];
  /** True when the key had already been used and nothing new was written. */
  replayed: boolean;
};

type BalanceKey = string;

const balanceKey = (locationId: string, lotId: string): BalanceKey => `${locationId}:${lotId}`;

function assertLinesValid(lines: MovementLine[]): void {
  if (lines.length === 0) {
    throw new AppError("VALIDATION", "ไม่มีรายการสินค้าให้บันทึก");
  }

  for (const line of lines) {
    if (compareQty(line.baseQty, 0) <= 0) {
      throw new AppError("VALIDATION", "จำนวนต้องมากกว่า 0");
    }
  }
}

/** Every line must belong to the caller's organization, and every lot to its item. */
async function loadAndCheckReferences(
  tx: DbExecutor,
  organizationId: string,
  lines: MovementLine[],
) {
  const lotIds = [...new Set(lines.map((line) => line.lotId))];
  const locationIds = [...new Set(lines.map((line) => line.locationId))];

  const [lotRows, locationRows] = await Promise.all([
    tx
      .select({
        id: inventoryLots.id,
        itemId: inventoryLots.itemId,
        baseUnitId: inventoryLots.baseUnitId,
        unitCost: inventoryLots.unitCost,
        isActive: inventoryLots.isActive,
      })
      .from(inventoryLots)
      .where(
        and(eq(inventoryLots.organizationId, organizationId), inArray(inventoryLots.id, lotIds)),
      ),
    tx
      .select({ id: locations.id, holdsStock: locations.holdsStock, isActive: locations.isActive })
      .from(locations)
      .where(
        and(eq(locations.organizationId, organizationId), inArray(locations.id, locationIds)),
      ),
  ]);

  const lotById = new Map(lotRows.map((row) => [row.id, row]));
  const locationById = new Map(locationRows.map((row) => [row.id, row]));

  for (const line of lines) {
    const lot = lotById.get(line.lotId);
    if (!lot) throw new AppError("NOT_FOUND", "ไม่พบลอตสินค้าที่ต้องการ");
    if (lot.itemId !== line.itemId) {
      throw new AppError("VALIDATION", "ลอตนี้ไม่ใช่ของวัตถุดิบที่เลือก");
    }

    const location = locationById.get(line.locationId);
    if (!location) throw new AppError("NOT_FOUND", "ไม่พบสถานที่ที่ต้องการ");
    if (!location.holdsStock || !location.isActive) {
      throw new AppError("VALIDATION", "สถานที่นี้ไม่รองรับการเก็บสต๊อก");
    }
  }

  return lotById;
}

async function itemNameFor(tx: DbExecutor, itemId: string): Promise<string> {
  const [row] = await tx
    .select({ nameTh: items.nameTh })
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  return row?.nameTh ?? "สินค้า";
}

/**
 * Applies every line to the affected balances inside one database transaction.
 *
 * The rows that an outbound line touches are locked with SELECT ... FOR UPDATE in a
 * deterministic order, so two staff issuing the same lot at the same moment queue up
 * instead of both reading the same "before" quantity. Balances are then written with
 * relative arithmetic (`base_qty + delta`), which stays correct even for a lot whose
 * balance row is being created by a concurrent posting.
 */
async function applyLines(
  tx: DbExecutor,
  organizationId: string,
  lines: MovementLine[],
): Promise<void> {
  const keys = [...new Set(lines.map((line) => balanceKey(line.locationId, line.lotId)))].sort();

  const locked = await tx
    .select({
      locationId: stockBalances.locationId,
      lotId: stockBalances.lotId,
      baseQty: stockBalances.baseQty,
    })
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.organizationId, organizationId),
        inArray(
          stockBalances.lotId,
          lines.map((line) => line.lotId),
        ),
        inArray(
          stockBalances.locationId,
          lines.map((line) => line.locationId),
        ),
      ),
    )
    .orderBy(stockBalances.locationId, stockBalances.lotId)
    .for("update");

  const current = new Map<BalanceKey, string>();
  for (const row of locked) current.set(balanceKey(row.locationId, row.lotId), row.baseQty);

  const running = new Map(current);
  const changes = new Map<BalanceKey, { existed: boolean; delta: string; itemId: string }>();
  for (const key of keys) {
    changes.set(key, { existed: current.has(key), delta: "0", itemId: "" });
  }

  for (const line of lines) {
    const key = balanceKey(line.locationId, line.lotId);
    const direction = directionOfType(line.type);
    const before = running.get(key) ?? "0";
    const qty = toNumericString(line.baseQty);

    if (direction === "OUT" && compareQty(before, qty) < 0) {
      const name = await itemNameFor(tx, line.itemId);
      throw new AppError(
        "INSUFFICIENT_STOCK",
        `จำนวนที่ต้องการเบิกมากกว่าสต๊อกคงเหลือ: ${name} ต้องการ ${formatQty(qty)} แต่คงเหลือ ${formatQty(before)}`,
      );
    }

    const after = direction === "IN" ? addQty(before, qty) : subQty(before, qty);
    running.set(key, after);

    const change = changes.get(key)!;
    change.delta = direction === "IN" ? addQty(change.delta, qty) : subQty(change.delta, qty);
    change.itemId = line.itemId;
  }

  for (const [key, change] of changes) {
    const [locationId, lotId] = key.split(":") as [string, string];

    if (change.existed) {
      await tx
        .update(stockBalances)
        .set({
          baseQty: sql`${stockBalances.baseQty} + ${change.delta}`,
          updatedAt: new Date(),
        })
        .where(and(eq(stockBalances.locationId, locationId), eq(stockBalances.lotId, lotId)));
      continue;
    }

    await tx
      .insert(stockBalances)
      .values({
        organizationId,
        itemId: change.itemId,
        locationId,
        lotId,
        baseQty: change.delta,
      })
      .onConflictDoUpdate({
        target: [stockBalances.locationId, stockBalances.lotId],
        set: {
          baseQty: sql`${stockBalances.baseQty} + ${change.delta}`,
          updatedAt: new Date(),
        },
      });
  }

}

/**
 * The single entry point that moves stock. Nothing else in the system may write to
 * `inventory_transactions` or `stock_balances`.
 */
export async function postMovement(
  input: PostMovementInput,
  executor?: DbExecutor,
): Promise<PostedMovement> {
  return postMovementAs(await requireUser(), input, executor);
}

/**
 * Same engine, for callers that already know who is acting and have no HTTP request to
 * resolve a session from — the development seed today, scheduled jobs later. The
 * permission check below still runs, so this is not a way around authorization.
 *
 * Pass `executor` when the caller is already inside a transaction (a goods receipt
 * writing its document, lots and ledger together). Opening a second `db.transaction`
 * from inside one would take a different connection from the pool, and the two halves
 * could commit independently.
 */
export async function postMovementAs(
  user: SessionUser,
  input: PostMovementInput,
  executor?: DbExecutor,
): Promise<PostedMovement> {
  assertLinesValid(input.lines);

  for (const line of input.lines) {
    const required = REQUIRED_PERMISSION[line.type];
    if (!hasPermission(user.permissions, required)) {
      throw new AppError("FORBIDDEN");
    }
  }

  return executor
    ? postMovementCore(executor, user, input)
    : db.transaction((tx) => postMovementCore(tx, user, input));
}

async function postMovementCore(
  tx: DbExecutor,
  user: SessionUser,
  input: PostMovementInput,
): Promise<PostedMovement> {
  {
    // Claiming the key first is what makes a double submit a no-op: the second attempt
    // finds the row already there and returns the original posting untouched.
    const [posting] = await tx
      .insert(inventoryPostings)
      .values({
        organizationId: user.organizationId,
        idempotencyKey: input.idempotencyKey,
        referenceType: input.referenceType,
        referenceId: input.referenceId ?? null,
        referenceNumber: input.referenceNumber ?? null,
        postedBy: user.id,
        postedAt: input.transactionAt ?? new Date(),
        note: input.note ?? null,
      })
      .onConflictDoNothing({
        target: [inventoryPostings.organizationId, inventoryPostings.idempotencyKey],
      })
      .returning();

    if (!posting) {
      const [existing] = await tx
        .select({ id: inventoryPostings.id })
        .from(inventoryPostings)
        .where(
          and(
            eq(inventoryPostings.organizationId, user.organizationId),
            eq(inventoryPostings.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (!existing) throw new AppError("INTERNAL");

      const rows = await tx
        .select({ id: inventoryTransactions.id })
        .from(inventoryTransactions)
        .where(eq(inventoryTransactions.postingId, existing.id));

      return {
        postingId: existing.id,
        transactionIds: rows.map((row) => row.id),
        replayed: true,
      };
    }

    const lotById = await loadAndCheckReferences(tx, user.organizationId, input.lines);
    await applyLines(tx, user.organizationId, input.lines);

    const transactionAt = input.transactionAt ?? new Date();
    const inserted = await tx
      .insert(inventoryTransactions)
      .values(
        input.lines.map((line) => {
          const lot = lotById.get(line.lotId)!;
          return {
            organizationId: user.organizationId,
            postingId: posting.id,
            transactionType: line.type,
            direction: directionOfType(line.type) as StockDirection,
            itemId: line.itemId,
            lotId: line.lotId,
            locationId: line.locationId,
            baseQty: toNumericString(line.baseQty),
            baseUnitId: lot.baseUnitId,
            unitCost: toNumericString(line.unitCost ?? lot.unitCost),
            referenceType: input.referenceType,
            referenceId: input.referenceId ?? null,
            referenceNumber: input.referenceNumber ?? null,
            userId: user.id,
            transactionAt,
            wasteReason: line.type === "WASTE" ? (line.wasteReason ?? "OTHER") : null,
            note: line.note ?? null,
          };
        }),
      )
      .returning({ id: inventoryTransactions.id });

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "CONFIRM",
      entityType: "inventory_posting",
      entityId: posting.id,
      afterData: {
        referenceType: input.referenceType,
        referenceNumber: input.referenceNumber,
        lines: input.lines.map((line) => ({
          type: line.type,
          itemId: line.itemId,
          lotId: line.lotId,
          locationId: line.locationId,
          baseQty: toNumericString(line.baseQty),
        })),
      },
      note: input.note ?? null,
    });

    return {
      postingId: posting.id,
      transactionIds: inserted.map((row) => row.id),
      replayed: false,
    };
  }
}

/**
 * Cancels a posting by writing the mirror image of every one of its rows. The original
 * posting and its rows are left exactly as they were — the ledger is append-only.
 */
export async function reversePosting(postingId: string, reason: string): Promise<PostedMovement> {
  const user = await requireUser();

  if (!hasPermission(user.permissions, PERMISSIONS.ADJUSTMENT_CREATE)) {
    throw new AppError("FORBIDDEN");
  }

  if (!reason.trim()) {
    throw new AppError("VALIDATION", "กรุณาระบุเหตุผลในการกลับรายการ");
  }

  return db.transaction(async (tx) => {
    const [original] = await tx
      .select()
      .from(inventoryPostings)
      .where(
        and(
          eq(inventoryPostings.id, postingId),
          eq(inventoryPostings.organizationId, user.organizationId),
        ),
      )
      .limit(1);

    if (!original) throw new AppError("NOT_FOUND", "ไม่พบรายการที่ต้องการกลับรายการ");
    if (original.reversalOfPostingId) {
      throw new AppError("VALIDATION", "ไม่สามารถกลับรายการของรายการกลับรายการได้");
    }

    const [alreadyReversed] = await tx
      .select({ id: inventoryPostings.id })
      .from(inventoryPostings)
      .where(eq(inventoryPostings.reversalOfPostingId, postingId))
      .limit(1);

    if (alreadyReversed) {
      throw new AppError("CONFLICT", "รายการนี้ถูกกลับรายการไปแล้ว");
    }

    const originalRows = await tx
      .select()
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.postingId, postingId));

    if (originalRows.length === 0) throw new AppError("NOT_FOUND", "ไม่พบรายการเคลื่อนไหว");

    const [reversal] = await tx
      .insert(inventoryPostings)
      .values({
        organizationId: user.organizationId,
        idempotencyKey: `reversal:${postingId}`,
        referenceType: original.referenceType,
        referenceId: original.referenceId,
        referenceNumber: original.referenceNumber,
        reversalOfPostingId: postingId,
        postedBy: user.id,
        note: reason,
      })
      .returning();

    /**
     * Reversing an inbound row takes stock back out, so the same non-negative rule applies
     * and a reversal can legitimately fail when the goods have already been consumed.
     * `applyLines` reads direction from the type, so the mirrored lines are expressed with
     * the adjustment type that carries the direction we need.
     */
    const mirroredLines: MovementLine[] = originalRows.map((row) => ({
      type: row.direction === "IN" ? "ADJUSTMENT_OUT" : "ADJUSTMENT_IN",
      itemId: row.itemId,
      lotId: row.lotId,
      locationId: row.locationId,
      baseQty: row.baseQty,
    }));

    await loadAndCheckReferences(tx, user.organizationId, mirroredLines);
    await applyLines(tx, user.organizationId, mirroredLines);

    const now = new Date();
    const inserted = await tx
      .insert(inventoryTransactions)
      .values(
        originalRows.map((row) => ({
          organizationId: user.organizationId,
          postingId: reversal!.id,
          transactionType: "REVERSAL" as const,
          direction: oppositeDirection(row.direction as StockDirection),
          reversalOfTransactionId: row.id,
          itemId: row.itemId,
          lotId: row.lotId,
          locationId: row.locationId,
          baseQty: row.baseQty,
          baseUnitId: row.baseUnitId,
          unitCost: row.unitCost,
          referenceType: row.referenceType,
          referenceId: row.referenceId,
          referenceNumber: row.referenceNumber,
          userId: user.id,
          transactionAt: now,
          note: reason,
        })),
      )
      .returning({ id: inventoryTransactions.id });

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "CANCEL",
      entityType: "inventory_posting",
      entityId: postingId,
      beforeData: { postingId, rows: originalRows.length },
      afterData: { reversalPostingId: reversal!.id },
      note: reason,
    });

    return {
      postingId: reversal!.id,
      transactionIds: inserted.map((row) => row.id),
      replayed: false,
    };
  });
}
