import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/database/client";
import {
  items,
  locations,
  purchaseOrderItems,
  purchaseOrders,
  stockBalances,
  supplierItems,
  suppliers,
  units,
} from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import { todayIso } from "@/lib/date";
import { AppError } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";
import {
  orderByDate,
  suggestOrderQuantity,
  type OrderSuggestion,
} from "@/lib/purchasing/order-quantity";
import { addQty, compareQty, mulQty, subQty, toNumericString } from "@/lib/quantity";
import { writeAuditLog } from "./audit-service";
import { nextDocumentNumber, retryOnDuplicateNumber } from "./document-number-service";
import { getMaterialRequirements } from "./menu-requirement-service";

/**
 * What to buy, worked out rather than guessed.
 *
 *     shortfall = requirement + safety stock − on hand − already on order
 *
 * Every term matters. Dropping "already on order" is how a canteen ends up with three
 * deliveries of the same thing; dropping safety stock is how it runs out on the day a
 * supplier is late. The result is a *suggestion* — nothing is ordered until a buyer looks
 * at it and says so.
 */

/** Orders that represent stock genuinely coming: a draft is not a commitment to anyone. */
const ON_ORDER_STATUSES = ["PENDING", "APPROVED", "SENT", "PARTIALLY_RECEIVED"] as const;

export type PlannerLine = {
  itemId: string;
  itemCode: string;
  itemNameTh: string;
  baseUnitCode: string | null;

  requiredBaseQty: string;
  safetyStockBaseQty: string;
  onHandBaseQty: string;
  onOrderBaseQty: string;
  shortfallBaseQty: string;

  supplierId: string | null;
  supplierNameTh: string | null;
  purchaseUnitId: string | null;
  purchaseUnitCode: string | null;
  conversionToBase: string;
  moq: string;
  packSize: string | null;

  suggestedPurchaseQty: string;
  suggestedBaseQty: string;
  /** How much more than needed the MOQ or pack size forced. */
  surplusBaseQty: string;

  unitPrice: string | null;
  estimatedCost: string;

  leadTimeDays: number;
  /** Earliest date the item is cooked in this window. */
  firstNeededDate: string | null;
  orderByDate: string | null;
  /** True when the order-by date has already passed. */
  isLate: boolean;
};

export type PlannerSupplierGroup = {
  supplierId: string;
  supplierNameTh: string;
  lines: PlannerLine[];
  estimatedTotal: string;
  /** Earliest order-by date across the group's lines. */
  orderByDate: string | null;
  isLate: boolean;
};

export type PurchasePlan = {
  fromDate: string;
  toDate: string;
  locationId: string;
  groups: PlannerSupplierGroup[];
  /** Short items with no active supplier — nobody can be asked for these yet. */
  unsourced: PlannerLine[];
  /** Items already covered by stock and orders; kept so the buyer can see they were checked. */
  coveredCount: number;
  unconfirmedPlans: number;
};

type SupplierChoice = {
  supplierId: string;
  supplierNameTh: string;
  purchaseUnitId: string | null;
  purchaseUnitCode: string | null;
  conversionToBase: string | null;
  moq: string;
  packSize: string | null;
  leadTimeDays: number;
  lastPrice: string | null;
  isPreferred: boolean;
};

/**
 * Preferred supplier wins; otherwise the cheapest known price; otherwise whoever is left.
 * Deliberately not "cheapest always" — a buyer who has marked a supplier preferred has a
 * reason the price column cannot see.
 */
function chooseSupplier(candidates: SupplierChoice[]): SupplierChoice | null {
  if (candidates.length === 0) return null;

  const preferred = candidates.find((candidate) => candidate.isPreferred);
  if (preferred) return preferred;

  const priced = candidates.filter((candidate) => candidate.lastPrice !== null);
  if (priced.length === 0) return candidates[0]!;

  return priced.reduce((cheapest, candidate) =>
    compareQty(candidate.lastPrice!, cheapest.lastPrice!) < 0 ? candidate : cheapest,
  );
}

export async function getPurchasePlan(input: {
  organizationId: string;
  fromDate: string;
  toDate: string;
  locationId: string;
  today?: string;
}): Promise<PurchasePlan> {
  await requirePermission(PERMISSIONS.PO_VIEW);

  const today = input.today ?? todayIso();

  const [location] = await db
    .select({ id: locations.id, holdsStock: locations.holdsStock })
    .from(locations)
    .where(
      and(eq(locations.id, input.locationId), eq(locations.organizationId, input.organizationId)),
    )
    .limit(1);

  if (!location) throw new AppError("NOT_FOUND", "ไม่พบสถานที่");
  if (!location.holdsStock) throw new AppError("VALIDATION", "สถานที่นี้ไม่รองรับการเก็บสต๊อก");

  const requirements = await getMaterialRequirements({
    organizationId: input.organizationId,
    fromDate: input.fromDate,
    toDate: input.toDate,
    locationId: input.locationId,
  });

  if (requirements.rows.length === 0) {
    return {
      fromDate: input.fromDate,
      toDate: input.toDate,
      locationId: input.locationId,
      groups: [],
      unsourced: [],
      coveredCount: 0,
      unconfirmedPlans: requirements.unconfirmedPlans,
    };
  }

  const itemIds = requirements.rows.map((row) => row.itemId);

  const [itemRows, onHandRows, onOrderRows, supplierRows] = await Promise.all([
    db
      .select({
        id: items.id,
        safetyStock: items.safetyStock,
        purchaseUnitId: items.purchaseUnitId,
        purchaseUnitCode: units.code,
        purchaseConversion: items.purchaseConversion,
        baseUnitId: items.baseUnitId,
      })
      .from(items)
      .leftJoin(units, eq(units.id, items.purchaseUnitId))
      .where(and(eq(items.organizationId, input.organizationId), inArray(items.id, itemIds))),

    db
      .select({
        itemId: stockBalances.itemId,
        baseQty: sql<string>`sum(${stockBalances.baseQty})`,
      })
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.organizationId, input.organizationId),
          eq(stockBalances.locationId, input.locationId),
          inArray(stockBalances.itemId, itemIds),
        ),
      )
      .groupBy(stockBalances.itemId),

    // Only what is still outstanding counts; the received part is already in stock above.
    db
      .select({
        itemId: purchaseOrderItems.itemId,
        baseQty: sql<string>`sum(greatest(${purchaseOrderItems.orderedBaseQty} - ${purchaseOrderItems.receivedBaseQty}, 0))`,
      })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
      .where(
        and(
          eq(purchaseOrders.organizationId, input.organizationId),
          eq(purchaseOrders.deliverToLocationId, input.locationId),
          inArray(purchaseOrders.status, [...ON_ORDER_STATUSES]),
          inArray(purchaseOrderItems.itemId, itemIds),
        ),
      )
      .groupBy(purchaseOrderItems.itemId),

    db
      .select({
        itemId: supplierItems.itemId,
        supplierId: suppliers.id,
        supplierNameTh: suppliers.nameTh,
        purchaseUnitId: supplierItems.purchaseUnitId,
        purchaseUnitCode: units.code,
        purchaseConversion: supplierItems.purchaseConversion,
        moq: supplierItems.moq,
        packSize: supplierItems.packSize,
        itemLeadTimeDays: supplierItems.leadTimeDays,
        supplierLeadTimeDays: suppliers.leadTimeDays,
        lastPrice: supplierItems.lastPrice,
        isPreferred: supplierItems.isPreferred,
      })
      .from(supplierItems)
      .innerJoin(suppliers, eq(suppliers.id, supplierItems.supplierId))
      .leftJoin(units, eq(units.id, supplierItems.purchaseUnitId))
      .where(
        and(
          eq(suppliers.organizationId, input.organizationId),
          eq(suppliers.isActive, true),
          eq(supplierItems.isActive, true),
          inArray(supplierItems.itemId, itemIds),
        ),
      )
      .orderBy(asc(suppliers.code)),
  ]);

  const itemById = new Map(itemRows.map((row) => [row.id, row]));
  const onHandByItem = new Map(onHandRows.map((row) => [row.itemId, row.baseQty]));
  const onOrderByItem = new Map(onOrderRows.map((row) => [row.itemId, row.baseQty]));

  const candidatesByItem = new Map<string, SupplierChoice[]>();
  for (const row of supplierRows) {
    const list = candidatesByItem.get(row.itemId) ?? [];
    list.push({
      supplierId: row.supplierId,
      supplierNameTh: row.supplierNameTh,
      purchaseUnitId: row.purchaseUnitId,
      purchaseUnitCode: row.purchaseUnitCode,
      conversionToBase: row.purchaseConversion,
      moq: row.moq,
      packSize: row.packSize,
      leadTimeDays: row.itemLeadTimeDays ?? row.supplierLeadTimeDays,
      lastPrice: row.lastPrice,
      isPreferred: row.isPreferred,
    });
    candidatesByItem.set(row.itemId, list);
  }

  const groups = new Map<string, PlannerSupplierGroup>();
  const unsourced: PlannerLine[] = [];
  let coveredCount = 0;

  for (const requirement of requirements.rows) {
    const item = itemById.get(requirement.itemId);
    if (!item) continue;

    const onHand = onHandByItem.get(requirement.itemId) ?? "0";
    const onOrder = onOrderByItem.get(requirement.itemId) ?? "0";
    const need = addQty(requirement.totalBaseQty, item.safetyStock);
    const shortfall = subQty(subQty(need, onHand), onOrder);

    if (compareQty(shortfall, "0") <= 0) {
      coveredCount += 1;
      continue;
    }

    const choice = chooseSupplier(candidatesByItem.get(requirement.itemId) ?? []);

    // The supplier's own pack size wins when it has one; otherwise the item's own.
    const conversion = choice?.conversionToBase ?? item.purchaseConversion;
    const suggestion: OrderSuggestion = suggestOrderQuantity({
      shortfallBaseQty: shortfall,
      conversionToBase: conversion,
      rules: { moq: choice?.moq, packSize: choice?.packSize },
    });

    const firstNeededDate =
      requirement.contributions
        .map((contribution) => contribution.planDate)
        .sort((a, b) => a.localeCompare(b))[0] ?? null;
    const leadTimeDays = choice?.leadTimeDays ?? 0;
    const orderBy = firstNeededDate ? orderByDate(firstNeededDate, leadTimeDays) : null;

    const line: PlannerLine = {
      itemId: requirement.itemId,
      itemCode: requirement.itemCode,
      itemNameTh: requirement.itemNameTh,
      baseUnitCode: requirement.unitCode,

      requiredBaseQty: requirement.totalBaseQty,
      safetyStockBaseQty: toNumericString(item.safetyStock),
      onHandBaseQty: toNumericString(onHand),
      onOrderBaseQty: toNumericString(onOrder),
      shortfallBaseQty: shortfall,

      supplierId: choice?.supplierId ?? null,
      supplierNameTh: choice?.supplierNameTh ?? null,
      purchaseUnitId: choice?.purchaseUnitId ?? item.purchaseUnitId,
      purchaseUnitCode: choice?.purchaseUnitCode ?? item.purchaseUnitCode,
      conversionToBase: toNumericString(conversion),
      moq: toNumericString(choice?.moq ?? 0),
      packSize: choice?.packSize ?? null,

      suggestedPurchaseQty: suggestion.purchaseQty,
      suggestedBaseQty: suggestion.orderedBaseQty,
      surplusBaseQty: suggestion.surplusBaseQty,

      unitPrice: choice?.lastPrice ?? null,
      estimatedCost: choice?.lastPrice
        ? mulQty(suggestion.purchaseQty, choice.lastPrice)
        : "0.0000",

      leadTimeDays,
      firstNeededDate,
      orderByDate: orderBy,
      isLate: orderBy !== null && orderBy < today,
    };

    if (!choice) {
      unsourced.push(line);
      continue;
    }

    const group = groups.get(choice.supplierId) ?? {
      supplierId: choice.supplierId,
      supplierNameTh: choice.supplierNameTh,
      lines: [],
      estimatedTotal: "0.0000",
      orderByDate: null,
      isLate: false,
    };

    group.lines.push(line);
    group.estimatedTotal = addQty(group.estimatedTotal, line.estimatedCost);
    if (line.orderByDate && (!group.orderByDate || line.orderByDate < group.orderByDate)) {
      group.orderByDate = line.orderByDate;
    }
    group.isLate = group.isLate || line.isLate;
    groups.set(choice.supplierId, group);
  }

  return {
    fromDate: input.fromDate,
    toDate: input.toDate,
    locationId: input.locationId,
    groups: [...groups.values()].sort((a, b) => a.supplierNameTh.localeCompare(b.supplierNameTh)),
    unsourced,
    coveredCount,
    unconfirmedPlans: requirements.unconfirmedPlans,
  };
}

export type DraftOrderResult = {
  purchaseOrderId: string;
  poNumber: string;
  supplierId: string;
  supplierNameTh: string;
  lineCount: number;
  /** True when an earlier planning run had already made this draft and it was refreshed. */
  refreshed: boolean;
};

/**
 * A planning window plus a location plus a supplier identifies one draft order. Running the
 * planner twice therefore refreshes the draft it made rather than stacking up a second one —
 * the same reasoning as the ledger's idempotency key, applied to a document instead of a
 * movement. Once a draft has been approved or sent it is a promise to the supplier, so it is
 * left alone and a fresh order is written instead.
 */
function planKeyFor(input: {
  fromDate: string;
  toDate: string;
  locationId: string;
  supplierId: string;
}): string {
  return `plan:${input.fromDate}:${input.toDate}:${input.locationId}:${input.supplierId}`;
}

async function replaceDraftLines(
  tx: DbExecutor,
  purchaseOrderId: string,
  lines: PlannerLine[],
): Promise<void> {
  await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId));

  for (const line of lines) {
    if (!line.purchaseUnitId) {
      throw new AppError(
        "VALIDATION",
        `${line.itemNameTh} ยังไม่ได้ตั้งหน่วยสั่งซื้อ จึงออกใบสั่งซื้อไม่ได้`,
      );
    }

    await tx.insert(purchaseOrderItems).values({
      purchaseOrderId,
      itemId: line.itemId,
      orderedQty: line.suggestedPurchaseQty,
      purchaseUnitId: line.purchaseUnitId,
      conversionToBase: line.conversionToBase,
      orderedBaseQty: line.suggestedBaseQty,
      unitPrice: line.unitPrice ?? "0",
      note: `วางแผนจากเมนู ${line.firstNeededDate ?? ""}`.trim(),
    });
  }
}

/**
 * Turns the plan into DRAFT purchase orders, one per supplier. Draft on purpose: the plan is
 * arithmetic, and somebody with `po.approve` still has to agree with it before anyone is
 * committed to buying anything.
 */
export async function createDraftOrdersFromPlan(input: {
  fromDate: string;
  toDate: string;
  locationId: string;
  /** Only these suppliers' groups are turned into orders. */
  supplierIds: string[];
  /** Items the buyer unticked; excluded from the orders. */
  excludedItemIds?: string[];
}): Promise<DraftOrderResult[]> {
  const user = await requirePermission(PERMISSIONS.PO_MANAGE);

  if (input.supplierIds.length === 0) {
    throw new AppError("VALIDATION", "กรุณาเลือกผู้ขายอย่างน้อย 1 ราย");
  }

  const plan = await getPurchasePlan({
    organizationId: user.organizationId,
    fromDate: input.fromDate,
    toDate: input.toDate,
    locationId: input.locationId,
  });

  const excluded = new Set(input.excludedItemIds ?? []);
  const wanted = new Set(input.supplierIds);
  const selected = plan.groups
    .filter((group) => wanted.has(group.supplierId))
    .map((group) => ({
      ...group,
      lines: group.lines.filter((line) => !excluded.has(line.itemId)),
    }))
    .filter((group) => group.lines.length > 0);

  if (selected.length === 0) {
    throw new AppError("VALIDATION", "ไม่มีรายการที่ต้องสั่งซื้อตามที่เลือกไว้");
  }

  const results: DraftOrderResult[] = [];

  for (const group of selected) {
    const planKey = planKeyFor({
      fromDate: input.fromDate,
      toDate: input.toDate,
      locationId: input.locationId,
      supplierId: group.supplierId,
    });

    const result = await retryOnDuplicateNumber(() =>
      db.transaction(async (tx) => {
        /**
         * Lock the existing draft before rewriting it, so two buyers pressing the button at
         * once cannot interleave a delete and an insert into the same document.
         */
        const [existing] = await tx
          .select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber })
          .from(purchaseOrders)
          .where(
            and(
              eq(purchaseOrders.organizationId, user.organizationId),
              eq(purchaseOrders.planKey, planKey),
              eq(purchaseOrders.status, "DRAFT"),
            ),
          )
          .for("update")
          .limit(1);

        if (existing) {
          await replaceDraftLines(tx, existing.id, group.lines);
          await writeAuditLog(tx, {
            organizationId: user.organizationId,
            userId: user.id,
            action: "UPDATE",
            entityType: "purchase_order",
            entityId: existing.id,
            afterData: { planKey, lines: group.lines.length, source: "purchase_planner" },
          });

          return {
            purchaseOrderId: existing.id,
            poNumber: existing.poNumber,
            supplierId: group.supplierId,
            supplierNameTh: group.supplierNameTh,
            lineCount: group.lines.length,
            refreshed: true,
          } satisfies DraftOrderResult;
        }

        const poNumber = await nextDocumentNumber(tx, user.organizationId, "purchaseOrder");

        const [order] = await tx
          .insert(purchaseOrders)
          .values({
            organizationId: user.organizationId,
            poNumber,
            supplierId: group.supplierId,
            deliverToLocationId: input.locationId,
            status: "DRAFT",
            orderDate: todayIso(),
            expectedDate: group.orderByDate,
            planKey,
            note: `วางแผนอัตโนมัติจากแผนเมนู ${input.fromDate} ถึง ${input.toDate}`,
            createdBy: user.id,
          })
          .returning();

        await replaceDraftLines(tx, order!.id, group.lines);

        await writeAuditLog(tx, {
          organizationId: user.organizationId,
          userId: user.id,
          action: "CREATE",
          entityType: "purchase_order",
          entityId: order!.id,
          afterData: { poNumber, planKey, lines: group.lines.length, source: "purchase_planner" },
        });

        return {
          purchaseOrderId: order!.id,
          poNumber,
          supplierId: group.supplierId,
          supplierNameTh: group.supplierNameTh,
          lineCount: group.lines.length,
          refreshed: false,
        } satisfies DraftOrderResult;
      }),
    );

    results.push(result);
  }

  return results;
}
