import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/database/client";
import {
  inventoryLots,
  items,
  locations,
  stockBalances,
  stockCountItems,
  stockCountSessions,
  units,
  users,
} from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";
import { addQty, compareQty, mulQty, subQty, toNumericString } from "@/lib/quantity";
import { writeAuditLog } from "./audit-service";
import { nextDocumentNumber, retryOnDuplicateNumber } from "./document-number-service";
import { postMovement } from "./inventory-ledger-service";

/**
 * Counting the shelves and reconciling them with the ledger.
 *
 * The session snapshots the system quantity per lot the moment it opens, and variance is
 * measured against that snapshot rather than against live balances. Without the snapshot a
 * count taken over an hour would silently absorb every issue posted while people were
 * counting, and the resulting adjustment would move stock nobody miscounted.
 *
 * Approval posts the difference through the same ledger engine as everything else — a count
 * cannot set a balance directly, only add a movement that explains the change.
 */

export type CountSessionSummary = {
  id: string;
  countNumber: string;
  status: string;
  locationCode: string;
  locationNameTh: string;
  countedAt: Date;
  approvedAt: Date | null;
  createdByName: string | null;
  lineCount: number;
  countedLineCount: number;
};

export type CountLine = {
  id: string;
  itemId: string;
  itemCode: string;
  itemNameTh: string;
  unitCode: string | null;
  lotId: string | null;
  lotNumber: string | null;
  expiryDate: string | null;
  systemBaseQty: string;
  countedBaseQty: string | null;
  varianceBaseQty: string | null;
  unitCost: string;
  note: string | null;
};

export type CountSessionDetail = {
  session: CountSessionSummary & { note: string | null };
  lines: CountLine[];
  totals: { countedLines: number; varianceLines: number; varianceValue: string };
};

/**
 * Opens a session and freezes the current balance of every lot at the location.
 *
 * Lots with nothing on them are included deliberately: finding stock the system says is not
 * there is exactly what a count is for, and a sheet that omits the zeroes cannot record it.
 */
export async function openCountSession(input: {
  locationId: string;
  note?: string | null;
}): Promise<{ sessionId: string; countNumber: string; lineCount: number }> {
  const user = await requirePermission(PERMISSIONS.STOCK_COUNT_CREATE);

  const [location] = await db
    .select({ id: locations.id, holdsStock: locations.holdsStock })
    .from(locations)
    .where(
      and(eq(locations.id, input.locationId), eq(locations.organizationId, user.organizationId)),
    )
    .limit(1);

  if (!location) throw new AppError("NOT_FOUND", "ไม่พบสถานที่");
  if (!location.holdsStock) throw new AppError("VALIDATION", "สถานที่นี้ไม่รองรับการเก็บสต๊อก");

  const [open] = await db
    .select({ id: stockCountSessions.id, countNumber: stockCountSessions.countNumber })
    .from(stockCountSessions)
    .where(
      and(
        eq(stockCountSessions.organizationId, user.organizationId),
        eq(stockCountSessions.locationId, input.locationId),
        eq(stockCountSessions.status, "OPEN"),
      ),
    )
    .limit(1);

  // Two open sheets for one location would each snapshot a different moment and then both
  // try to post; one at a time keeps the arithmetic meaningful.
  if (open) {
    throw new AppError(
      "CONFLICT",
      `สถานที่นี้มีใบตรวจนับที่ยังเปิดอยู่ (${open.countNumber}) กรุณาปิดใบเดิมก่อน`,
    );
  }

  return retryOnDuplicateNumber(() =>
    db.transaction(async (tx) => {
      const countNumber = await nextDocumentNumber(tx, user.organizationId, "stockCount");

      const [session] = await tx
        .insert(stockCountSessions)
        .values({
          organizationId: user.organizationId,
          countNumber,
          locationId: input.locationId,
          status: "OPEN",
          note: input.note ?? null,
          createdBy: user.id,
        })
        .returning();

      const balances = await tx
        .select({
          itemId: stockBalances.itemId,
          lotId: stockBalances.lotId,
          baseQty: stockBalances.baseQty,
        })
        .from(stockBalances)
        .where(
          and(
            eq(stockBalances.organizationId, user.organizationId),
            eq(stockBalances.locationId, input.locationId),
            gt(stockBalances.baseQty, "0"),
          ),
        );

      if (balances.length > 0) {
        await tx.insert(stockCountItems).values(
          balances.map((balance) => ({
            stockCountSessionId: session!.id,
            itemId: balance.itemId,
            lotId: balance.lotId,
            systemBaseQty: balance.baseQty,
          })),
        );
      }

      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "CREATE",
        entityType: "stock_count_session",
        entityId: session!.id,
        afterData: { countNumber, lines: balances.length },
      });

      return { sessionId: session!.id, countNumber, lineCount: balances.length };
    }),
  );
}

/** Saves counted quantities. Variance is derived here and stored alongside for the report. */
export async function saveCountLines(
  sessionId: string,
  lines: Array<{ lineId: string; countedBaseQty: number | string | null; note?: string | null }>,
): Promise<{ saved: number }> {
  const user = await requirePermission(PERMISSIONS.STOCK_COUNT_CREATE);

  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(stockCountSessions)
      .where(
        and(
          eq(stockCountSessions.id, sessionId),
          eq(stockCountSessions.organizationId, user.organizationId),
        ),
      )
      .limit(1);

    if (!session) throw new AppError("NOT_FOUND", "ไม่พบใบตรวจนับ");
    if (session.status !== "OPEN") {
      throw new AppError("VALIDATION", "ใบตรวจนับนี้ปิดแล้ว แก้ไขไม่ได้");
    }

    const existing = await tx
      .select({ id: stockCountItems.id, systemBaseQty: stockCountItems.systemBaseQty })
      .from(stockCountItems)
      .where(eq(stockCountItems.stockCountSessionId, sessionId));
    const systemById = new Map(existing.map((row) => [row.id, row.systemBaseQty]));

    let saved = 0;

    for (const line of lines) {
      const systemQty = systemById.get(line.lineId);
      if (systemQty === undefined) continue;

      if (line.countedBaseQty === null || line.countedBaseQty === "") {
        await tx
          .update(stockCountItems)
          .set({ countedBaseQty: null, varianceBaseQty: null, countedBy: null, countedAt: null })
          .where(eq(stockCountItems.id, line.lineId));
        saved += 1;
        continue;
      }

      const counted = toNumericString(line.countedBaseQty);
      if (compareQty(counted, "0") < 0) {
        throw new AppError("VALIDATION", "จำนวนที่นับได้ต้องไม่ติดลบ");
      }

      await tx
        .update(stockCountItems)
        .set({
          countedBaseQty: counted,
          varianceBaseQty: subQty(counted, systemQty),
          countedBy: user.id,
          countedAt: new Date(),
          note: line.note ?? null,
        })
        .where(eq(stockCountItems.id, line.lineId));
      saved += 1;
    }

    return { saved };
  });
}

/**
 * Approves the count and posts the differences.
 *
 * Requires `stock_count.approve`, separate from the permission to do the counting: the person
 * who wrote the numbers down should not be the only one who can make them true.
 */
export async function approveCountSession(
  sessionId: string,
  idempotencyKey: string,
): Promise<{ postingId: string | null; adjustedLines: number; replayed: boolean }> {
  const user = await requirePermission(PERMISSIONS.STOCK_COUNT_APPROVE);

  const [session] = await db
    .select()
    .from(stockCountSessions)
    .where(
      and(
        eq(stockCountSessions.id, sessionId),
        eq(stockCountSessions.organizationId, user.organizationId),
      ),
    )
    .limit(1);

  if (!session) throw new AppError("NOT_FOUND", "ไม่พบใบตรวจนับ");
  if (session.status !== "OPEN") throw new AppError("VALIDATION", "ใบตรวจนับนี้ปิดไปแล้ว");

  const lines = await db
    .select({
      id: stockCountItems.id,
      itemId: stockCountItems.itemId,
      lotId: stockCountItems.lotId,
      countedBaseQty: stockCountItems.countedBaseQty,
      varianceBaseQty: stockCountItems.varianceBaseQty,
    })
    .from(stockCountItems)
    .where(eq(stockCountItems.stockCountSessionId, sessionId));

  const uncounted = lines.filter((line) => line.countedBaseQty === null);
  if (uncounted.length > 0) {
    throw new AppError(
      "VALIDATION",
      `ยังนับไม่ครบ เหลืออีก ${uncounted.length} รายการ — รายการที่ยังไม่นับจะทำให้ยอดผิด`,
    );
  }

  const adjustments = lines.filter(
    (line) => line.varianceBaseQty !== null && compareQty(line.varianceBaseQty, "0") !== 0,
  );

  let postingId: string | null = null;
  let replayed = false;

  if (adjustments.length > 0) {
    // Direction comes from the sign: counted more than the system knew is an increase.
    const posted = await postMovement({
      idempotencyKey,
      referenceType: "STOCK_COUNT",
      referenceId: sessionId,
      referenceNumber: session.countNumber,
      note: `ปรับยอดตามการตรวจนับ ${session.countNumber}`,
      lines: adjustments.map((line) => ({
        type: compareQty(line.varianceBaseQty!, "0") > 0
          ? ("ADJUSTMENT_IN" as const)
          : ("ADJUSTMENT_OUT" as const),
        itemId: line.itemId,
        lotId: line.lotId!,
        locationId: session.locationId,
        baseQty: compareQty(line.varianceBaseQty!, "0") > 0
          ? line.varianceBaseQty!
          : mulQty(line.varianceBaseQty!, "-1"),
        note: `ตรวจนับ ${session.countNumber}`,
      })),
    });

    postingId = posted.postingId;
    replayed = posted.replayed;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(stockCountSessions)
      .set({ status: "APPROVED", approvedBy: user.id, approvedAt: new Date() })
      .where(eq(stockCountSessions.id, sessionId));

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "APPROVE",
      entityType: "stock_count_session",
      entityId: sessionId,
      afterData: {
        countNumber: session.countNumber,
        adjustedLines: adjustments.length,
        postingId,
      },
    });
  });

  return { postingId, adjustedLines: adjustments.length, replayed };
}

/** Cancels an open sheet. Nothing was posted, so nothing needs reversing. */
export async function cancelCountSession(sessionId: string, reason: string): Promise<void> {
  const user = await requirePermission(PERMISSIONS.STOCK_COUNT_CREATE);

  await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(stockCountSessions)
      .where(
        and(
          eq(stockCountSessions.id, sessionId),
          eq(stockCountSessions.organizationId, user.organizationId),
        ),
      )
      .limit(1);

    if (!session) throw new AppError("NOT_FOUND", "ไม่พบใบตรวจนับ");
    if (session.status !== "OPEN") throw new AppError("VALIDATION", "ใบตรวจนับนี้ปิดไปแล้ว");

    await tx
      .update(stockCountSessions)
      .set({ status: "CANCELLED", note: reason })
      .where(eq(stockCountSessions.id, sessionId));

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "CANCEL",
      entityType: "stock_count_session",
      entityId: sessionId,
      note: reason,
    });
  });
}

export async function listCountSessions(organizationId: string): Promise<CountSessionSummary[]> {
  await requirePermission(PERMISSIONS.STOCK_VIEW);

  return db
    .select({
      id: stockCountSessions.id,
      countNumber: stockCountSessions.countNumber,
      status: stockCountSessions.status,
      locationCode: locations.code,
      locationNameTh: locations.nameTh,
      countedAt: stockCountSessions.countedAt,
      approvedAt: stockCountSessions.approvedAt,
      createdByName: users.fullName,
      lineCount: sql<number>`(
        select count(*) from ${stockCountItems}
        where ${stockCountItems.stockCountSessionId} = ${stockCountSessions.id}
      )`,
      countedLineCount: sql<number>`(
        select count(*) from ${stockCountItems}
        where ${stockCountItems.stockCountSessionId} = ${stockCountSessions.id}
          and ${stockCountItems.countedBaseQty} is not null
      )`,
    })
    .from(stockCountSessions)
    .innerJoin(locations, eq(locations.id, stockCountSessions.locationId))
    .leftJoin(users, eq(users.id, stockCountSessions.createdBy))
    .where(eq(stockCountSessions.organizationId, organizationId))
    .orderBy(desc(stockCountSessions.countedAt))
    .limit(50);
}

export async function getCountSession(
  organizationId: string,
  sessionId: string,
): Promise<CountSessionDetail | null> {
  await requirePermission(PERMISSIONS.STOCK_VIEW);

  const [session] = await db
    .select({
      id: stockCountSessions.id,
      countNumber: stockCountSessions.countNumber,
      status: stockCountSessions.status,
      locationCode: locations.code,
      locationNameTh: locations.nameTh,
      countedAt: stockCountSessions.countedAt,
      approvedAt: stockCountSessions.approvedAt,
      createdByName: users.fullName,
      note: stockCountSessions.note,
    })
    .from(stockCountSessions)
    .innerJoin(locations, eq(locations.id, stockCountSessions.locationId))
    .leftJoin(users, eq(users.id, stockCountSessions.createdBy))
    .where(
      and(
        eq(stockCountSessions.id, sessionId),
        eq(stockCountSessions.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!session) return null;

  const lines = await db
    .select({
      id: stockCountItems.id,
      itemId: stockCountItems.itemId,
      itemCode: items.code,
      itemNameTh: items.nameTh,
      unitCode: units.code,
      lotId: stockCountItems.lotId,
      lotNumber: inventoryLots.lotNumber,
      expiryDate: inventoryLots.expiryDate,
      systemBaseQty: stockCountItems.systemBaseQty,
      countedBaseQty: stockCountItems.countedBaseQty,
      varianceBaseQty: stockCountItems.varianceBaseQty,
      unitCost: inventoryLots.unitCost,
      note: stockCountItems.note,
    })
    .from(stockCountItems)
    .innerJoin(items, eq(items.id, stockCountItems.itemId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, stockCountItems.lotId))
    .leftJoin(units, eq(units.id, items.baseUnitId))
    .where(eq(stockCountItems.stockCountSessionId, sessionId))
    .orderBy(asc(items.code), asc(inventoryLots.expiryDate));

  const countedLines = lines.filter((line) => line.countedBaseQty !== null).length;
  const varianceLines = lines.filter(
    (line) => line.varianceBaseQty !== null && compareQty(line.varianceBaseQty, "0") !== 0,
  );

  const varianceValue = varianceLines.reduce(
    (total, line) => addQty(total, mulQty(line.varianceBaseQty!, line.unitCost ?? "0")),
    "0",
  );

  return {
    session: {
      ...session,
      lineCount: lines.length,
      countedLineCount: countedLines,
    },
    lines: lines.map((line) => ({ ...line, unitCost: line.unitCost ?? "0" })),
    totals: { countedLines, varianceLines: varianceLines.length, varianceValue },
  };
}
