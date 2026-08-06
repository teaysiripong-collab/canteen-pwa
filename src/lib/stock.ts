import { db } from "./db";

export type StockLevel = {
  ingredientId: string;
  code: string;
  name: string;
  unit: string;
  minStock: number;
  total: number;
  byLocation: { locationId: string; locationName: string; qty: number }[];
};

/** Current stock = SUM of ledger, grouped by ingredient (+ per-location breakdown). */
export async function getStockLevels(): Promise<StockLevel[]> {
  const grouped = await db.stockTransaction.groupBy({
    by: ["ingredientId", "locationId"],
    _sum: { qty: true },
  });
  const ingredients = await db.ingredient.findMany({
    where: { active: true },
    include: { stockUnit: true },
    orderBy: { code: "asc" },
  });
  const locations = await db.location.findMany();
  const locName = new Map(locations.map((l) => [l.id, l.name]));

  return ingredients.map((ing) => {
    const rows = grouped.filter((g) => g.ingredientId === ing.id);
    const byLocation = rows
      .map((r) => ({
        locationId: r.locationId,
        locationName: locName.get(r.locationId) ?? "?",
        qty: Number(r._sum.qty ?? 0),
      }))
      .filter((r) => Math.abs(r.qty) > 0.0001);
    return {
      ingredientId: ing.id,
      code: ing.code,
      name: ing.name,
      unit: ing.stockUnit.code,
      minStock: Number(ing.minStock),
      total: byLocation.reduce((s, r) => s + r.qty, 0),
      byLocation,
    };
  });
}

export type LotBalance = {
  lotId: string;
  lotCode: string;
  expiryDate: Date | null;
  qty: number;
  locationId: string | null;
};

/** FEFO — remaining balance per lot, earliest expiry first. */
export async function getLotBalances(ingredientId: string): Promise<LotBalance[]> {
  const lots = await db.lot.findMany({
    where: { ingredientId },
    include: { stockTxns: true },
    orderBy: [{ expiryDate: "asc" }],
  });
  return lots
    .map((lot) => ({
      lotId: lot.id,
      lotCode: lot.lotCode,
      expiryDate: lot.expiryDate,
      qty: lot.stockTxns.reduce((s, t) => s + Number(t.qty), 0),
      locationId: lot.stockTxns[0]?.locationId ?? null,
    }))
    .filter((l) => l.qty > 0.0001);
}

export type ExpiryAlert = {
  ingredientName: string;
  lotCode: string;
  expiryDate: Date;
  qty: number;
  daysLeft: number;
};

export async function getExpiryAlerts(withinDays = 3): Promise<ExpiryAlert[]> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const limit = new Date(today);
  limit.setUTCDate(limit.getUTCDate() + withinDays);

  const lots = await db.lot.findMany({
    where: { expiryDate: { not: null, lte: limit } },
    include: { stockTxns: true, ingredient: true },
    orderBy: { expiryDate: "asc" },
  });
  return lots
    .map((lot) => ({
      ingredientName: lot.ingredient.name,
      lotCode: lot.lotCode,
      expiryDate: lot.expiryDate!,
      qty: lot.stockTxns.reduce((s, t) => s + Number(t.qty), 0),
      daysLeft: Math.round((lot.expiryDate!.getTime() - today.getTime()) / 86400000),
    }))
    .filter((l) => l.qty > 0.0001);
}
