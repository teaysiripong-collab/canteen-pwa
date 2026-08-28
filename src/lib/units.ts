import { divQty, mulQty, type Numeric } from "./quantity";

export type ConversionRule = {
  /** Null for a global rule (kg -> g); set for an item-specific rule (1 ลัง = 12 ขวด of this item). */
  itemId: string | null;
  fromUnitId: string;
  toUnitId: string;
  /** How many `toUnitId` fit in one `fromUnitId`. */
  factor: string;
};

export class UnitConversionError extends Error {
  constructor(
    readonly fromUnitId: string,
    readonly toUnitId: string,
  ) {
    super(`No conversion path from unit ${fromUnitId} to unit ${toUnitId}`);
    this.name = "UnitConversionError";
  }
}

type Edge = { to: string; factor: string; itemSpecific: boolean };

function buildGraph(rules: ConversionRule[], itemId?: string): Map<string, Edge[]> {
  const graph = new Map<string, Edge[]>();

  const addEdge = (from: string, edge: Edge) => {
    const edges = graph.get(from) ?? [];
    // An item-specific rule replaces the global rule for the same unit pair.
    const existingIndex = edges.findIndex((candidate) => candidate.to === edge.to);
    if (existingIndex >= 0) {
      const existing = edges[existingIndex]!;
      if (existing.itemSpecific && !edge.itemSpecific) return;
      edges[existingIndex] = edge;
    } else {
      edges.push(edge);
    }
    graph.set(from, edges);
  };

  const applicable = rules.filter(
    (rule) => rule.itemId === null || (itemId !== undefined && rule.itemId === itemId),
  );

  // Global rules first so item-specific ones overwrite them.
  const ordered = [...applicable].sort((a, b) => Number(a.itemId !== null) - Number(b.itemId !== null));

  for (const rule of ordered) {
    const itemSpecific = rule.itemId !== null;
    addEdge(rule.fromUnitId, { to: rule.toUnitId, factor: rule.factor, itemSpecific });
    addEdge(rule.toUnitId, {
      to: rule.fromUnitId,
      factor: divQty("1", rule.factor),
      itemSpecific,
    });
  }

  return graph;
}

/**
 * Resolves the multiplier that turns a quantity in `fromUnitId` into `toUnitId`,
 * walking the conversion graph so chained rules (ลัง -> แพ็ก -> ถุง) work too.
 */
export function resolveConversionFactor(
  fromUnitId: string,
  toUnitId: string,
  rules: ConversionRule[],
  itemId?: string,
): string {
  if (fromUnitId === toUnitId) return "1.0000";

  const graph = buildGraph(rules, itemId);
  const queue: Array<{ unitId: string; factor: string }> = [{ unitId: fromUnitId, factor: "1" }];
  const visited = new Set<string>([fromUnitId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of graph.get(current.unitId) ?? []) {
      if (visited.has(edge.to)) continue;
      const factor = mulQty(current.factor, edge.factor);
      if (edge.to === toUnitId) return factor;
      visited.add(edge.to);
      queue.push({ unitId: edge.to, factor });
    }
  }

  throw new UnitConversionError(fromUnitId, toUnitId);
}

export function convertQuantity(
  qty: Numeric,
  fromUnitId: string,
  toUnitId: string,
  rules: ConversionRule[],
  itemId?: string,
): string {
  return mulQty(qty, resolveConversionFactor(fromUnitId, toUnitId, rules, itemId));
}

/**
 * Purchase documents are entered in the purchase unit; stock is always kept in the base unit.
 * `conversionToBase` is base units per purchase unit (1 ลัง = 12 ขวด -> 12).
 */
export function toBaseQuantity(qty: Numeric, conversionToBase: Numeric): string {
  return mulQty(qty, conversionToBase);
}

export function fromBaseQuantity(baseQty: Numeric, conversionToBase: Numeric): string {
  return divQty(baseQty, conversionToBase);
}
