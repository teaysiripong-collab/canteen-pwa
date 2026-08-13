/**
 * The vocabulary of the stock ledger.
 *
 * Quantities are always stored positive; whether a row adds to or removes from a balance
 * is carried by `direction`. For most types the direction follows from the type itself and
 * `directionOfType` is the single source of that rule.
 */

export const STOCK_DIRECTIONS = ["IN", "OUT"] as const;
export type StockDirection = (typeof STOCK_DIRECTIONS)[number];

export const TRANSACTION_TYPES = [
  "OPENING_BALANCE",
  "RECEIVE",
  "ISSUE",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "WASTE",
  "RETURN_TO_SUPPLIER",
  "RETURN_TO_STOCK",
  "STOCK_COUNT_ADJUSTMENT",
  "REVERSAL",
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/**
 * Types whose direction is fixed. The two that are missing are deliberate:
 *
 * - `REVERSAL` mirrors whatever row it cancels, so its direction comes from that row.
 * - `STOCK_COUNT_ADJUSTMENT` can go either way; the count workflow decides from the
 *   variance and passes the direction explicitly.
 */
const FIXED_DIRECTIONS = {
  OPENING_BALANCE: "IN",
  RECEIVE: "IN",
  TRANSFER_IN: "IN",
  ADJUSTMENT_IN: "IN",
  RETURN_TO_STOCK: "IN",
  ISSUE: "OUT",
  TRANSFER_OUT: "OUT",
  ADJUSTMENT_OUT: "OUT",
  WASTE: "OUT",
  RETURN_TO_SUPPLIER: "OUT",
} as const satisfies Partial<Record<TransactionType, StockDirection>>;

/** Types a caller may post directly, i.e. every type with a fixed direction. */
export type DirectionalTransactionType = keyof typeof FIXED_DIRECTIONS;

export const DIRECTIONAL_TRANSACTION_TYPES = Object.keys(
  FIXED_DIRECTIONS,
) as DirectionalTransactionType[];

export function directionOfType(type: DirectionalTransactionType): StockDirection {
  return FIXED_DIRECTIONS[type];
}

export function isDirectionalType(type: string): type is DirectionalTransactionType {
  return type in FIXED_DIRECTIONS;
}

export function isInbound(direction: StockDirection): boolean {
  return direction === "IN";
}

/** The direction a reversing row must carry to cancel out the row it reverses. */
export function oppositeDirection(direction: StockDirection): StockDirection {
  return direction === "IN" ? "OUT" : "IN";
}

export const TRANSACTION_TYPE_LABELS_TH: Record<TransactionType, string> = {
  OPENING_BALANCE: "ยอดยกมา",
  RECEIVE: "รับเข้า",
  ISSUE: "เบิกออก",
  TRANSFER_IN: "รับโอนเข้า",
  TRANSFER_OUT: "โอนออก",
  ADJUSTMENT_IN: "ปรับเพิ่ม",
  ADJUSTMENT_OUT: "ปรับลด",
  WASTE: "ของเสีย",
  RETURN_TO_SUPPLIER: "คืนผู้ขาย",
  RETURN_TO_STOCK: "คืนเข้าคลัง",
  STOCK_COUNT_ADJUSTMENT: "ปรับตามผลตรวจนับ",
  REVERSAL: "กลับรายการ",
};

export const REFERENCE_TYPE_LABELS_TH = {
  GOODS_RECEIPT: "ใบรับสินค้า",
  STOCK_ISSUE: "ใบเบิก",
  STOCK_TRANSFER: "ใบโอน",
  STOCK_COUNT: "ใบตรวจนับ",
  MANUAL_ADJUSTMENT: "ปรับปรุงด้วยมือ",
  PURCHASE_ORDER: "ใบสั่งซื้อ",
} as const;

export type ReferenceType = keyof typeof REFERENCE_TYPE_LABELS_TH;
