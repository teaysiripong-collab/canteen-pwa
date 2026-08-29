import { addDays } from "@/lib/date";
import type {
  CopilotTool,
  CopilotToolContext,
  CopilotToolResult,
} from "@/lib/copilot/tools";

export type LocalCopilotSource = {
  toolName: string;
  label: string;
  href?: string;
};

export type LocalCopilotAnswer = {
  text: string;
  sources: LocalCopilotSource[];
  toolCalls: number;
  refused: boolean;
};

type CappedRows<T> = {
  rows: T[];
  total: number;
  truncated: boolean;
};

type StockRow = {
  item: string;
  code: string;
  location: string;
  baseQty: string | number;
  unit: string | null;
  minimumStock?: string | number;
  reorderPoint?: string | number;
};

type ExpiryRow = {
  item: string;
  lot: string;
  expiryDate: string | null;
  location: string;
  baseQty: string | number;
  unit: string | null;
};

const TOOL_LABELS: Record<string, string> = {
  get_stock_on_hand: "สต็อกคงเหลือ",
  get_expiring_items: "ของใกล้หมดอายุ",
  get_daily_cost: "ต้นทุนรายวัน",
  get_menu_plan: "แผนเมนู",
  get_material_requirements: "ความต้องการวัตถุดิบ",
  get_purchase_plan: "แผนสั่งซื้อ",
  get_price_history: "ประวัติราคาซื้อ",
};

const TOOL_PERMISSION_NAMES: Record<string, string> = {
  get_stock_on_hand: "สต็อก",
  get_expiring_items: "สต็อก",
  get_daily_cost: "ต้นทุน",
  get_menu_plan: "เมนู",
  get_material_requirements: "เมนู",
  get_purchase_plan: "การจัดซื้อ",
  get_price_history: "ต้นทุน",
};

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantity(value: unknown): string {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 4 }).format(number(value));
}

function money(value: unknown): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 2,
  }).format(number(value));
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function cappedRows<T>(value: unknown): CappedRows<T> {
  const data = asObject(value);
  const rows = Array.isArray(data.rows) ? (data.rows as T[]) : [];
  return {
    rows,
    total: typeof data.total === "number" ? data.total : rows.length,
    truncated: data.truncated === true,
  };
}

function dateRange(question: string, today: string): { fromDate: string; toDate: string } {
  const explicit = question.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  if (explicit.length >= 2) return { fromDate: explicit[0]!, toDate: explicit[1]! };
  if (explicit.length === 1) return { fromDate: explicit[0]!, toDate: explicit[0]! };

  if (/พรุ่งนี้|tomorrow/i.test(question)) {
    const tomorrow = addDays(today, 1);
    return { fromDate: tomorrow, toDate: tomorrow };
  }

  if (/เดือนนี้|this month/i.test(question)) {
    const [year, month] = today.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
    return {
      fromDate: `${year}-${String(month).padStart(2, "0")}-01`,
      toDate: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    };
  }

  if (/สัปดาห์|อาทิตย์|week/i.test(question)) {
    return { fromDate: today, toDate: addDays(today, 6) };
  }

  return { fromDate: today, toDate: today };
}

function intentOf(question: string): string | null {
  if (/สต็อก.*(ต่ำ|น้อย|ใกล้หมด|จุดสั่งซื้อ)|จุดสั่งซื้อ.*สต็อก|low stock|reorder point/i.test(question)) {
    return "get_stock_on_hand";
  }
  if (/ราคา|price|ซื้อครั้งก่อน/i.test(question)) return "get_price_history";
  if (/ต้นทุน|ค่าใช้จ่าย|cost/i.test(question)) return "get_daily_cost";
  if (/หมดอายุ|ใกล้เสีย|expiry|expire/i.test(question)) return "get_expiring_items";
  if (/สั่งซื้อ|ต้องซื้อ|จัดซื้อ|purchase|order/i.test(question)) return "get_purchase_plan";
  if (/วัตถุดิบ.*(ต้องใช้|ความต้องการ)|ต้องใช้.*วัตถุดิบ|material requirement/i.test(question)) {
    return "get_material_requirements";
  }
  if (/เมนู|อาหาร|menu/i.test(question)) return "get_menu_plan";
  if (/สต็อก|คงเหลือ|เหลือ|ของมี|stock|วัตถุดิบ/i.test(question)) return "get_stock_on_hand";
  return null;
}

function toolInput(toolName: string, question: string, today: string): unknown {
  const range = dateRange(question, today);
  if (toolName === "get_expiring_items") {
    const days = question.match(/(\d+)\s*วัน/)?.[1];
    return days ? { withinDays: Math.min(60, Math.max(1, Number(days))) } : {};
  }
  if (toolName === "get_menu_plan") return { date: range.fromDate };
  if (
    toolName === "get_daily_cost" ||
    toolName === "get_material_requirements" ||
    toolName === "get_purchase_plan"
  ) {
    return range;
  }
  return {};
}

function stockAnswer(result: CopilotToolResult, question: string): string {
  const data = cappedRows<StockRow>(result.data);
  const asksLow = /ต่ำ|น้อย|ใกล้หมด|จุดสั่งซื้อ|reorder|low/i.test(question);
  const matched = data.rows.filter((row) => {
    const needle = question.toLocaleLowerCase("th-TH");
    return needle.includes(row.item.toLocaleLowerCase("th-TH")) || needle.includes(row.code.toLowerCase());
  });
  let rows = matched.length > 0 ? matched : data.rows;
  if (asksLow) rows = rows.filter((row) => number(row.baseQty) <= number(row.reorderPoint));

  if (rows.length === 0) {
    return asksLow
      ? "ยังไม่พบรายการที่สต็อกต่ำกว่าหรือเท่ากับจุดสั่งซื้อครับ"
      : "ยังไม่พบสต็อกคงเหลือตามคำถามนี้ครับ";
  }

  const lines = rows.map((row) => {
    const base = `${row.item} (${row.code}) ที่ ${row.location}: ${quantity(row.baseQty)} ${row.unit ?? "หน่วย"}`;
    return asksLow ? `${base} — จุดสั่งซื้อ ${quantity(row.reorderPoint)} ${row.unit ?? "หน่วย"}` : base;
  });
  const suffix = data.truncated && matched.length === 0 ? `\nแสดง ${rows.length} จาก ${data.total} รายการ` : "";
  return `${asksLow ? "รายการสต็อกที่ควรตรวจสอบ:" : "สต็อกคงเหลือปัจจุบัน:"}\n${lines.map((line) => `- ${line}`).join("\n")}${suffix}`;
}

function expiryAnswer(result: CopilotToolResult): string {
  const data = cappedRows<ExpiryRow>(result.data);
  if (data.rows.length === 0) return "ยังไม่พบวัตถุดิบที่ใกล้หมดอายุในช่วงที่ถามครับ";
  return `วัตถุดิบที่ควรตรวจสอบวันหมดอายุ:\n${data.rows
    .map(
      (row) =>
        `- ${row.item} ล็อต ${row.lot} ที่ ${row.location}: ${quantity(row.baseQty)} ${row.unit ?? "หน่วย"} หมดอายุ ${row.expiryDate ?? "ไม่ระบุ"}`,
    )
    .join("\n")}`;
}

function costAnswer(result: CopilotToolResult): string {
  const data = cappedRows<Record<string, unknown>>(result.data);
  if (data.rows.length === 0) return "ยังไม่มีรายการเบิกใช้หรือของเสียในช่วงวันที่ถาม จึงยังไม่มีต้นทุนเกิดขึ้นครับ";
  const total = data.rows.reduce((sum, row) => sum + number(row.totalCost), 0);
  return `ต้นทุนรวมในช่วงที่ถาม ${money(total)}\n${data.rows
    .map((row) => `- ${String(row.costDate)}: ${money(row.totalCost)} (เบิกใช้ ${money(row.issueCost)}, ของเสีย ${money(row.wasteCost)})`)
    .join("\n")}`;
}

function menuAnswer(result: CopilotToolResult): string {
  const data = asObject(result.data);
  const plans = Array.isArray(data.plans) ? (data.plans as Array<Record<string, unknown>>) : [];
  if (plans.length === 0) return `ยังไม่มีแผนเมนูวันที่ ${String(data.date ?? "ที่ถาม")} ครับ`;
  const lines = plans.flatMap((plan) => {
    const items = Array.isArray(plan.items) ? (plan.items as Array<Record<string, unknown>>) : [];
    return items.map(
      (item) =>
        `- ${String(item.menuNameTh ?? item.menuCode ?? "เมนู")}: ${quantity(item.plannedServings)} ที่ (${String(plan.status ?? "DRAFT")})`,
    );
  });
  return lines.length > 0 ? `แผนเมนูวันที่ ${String(data.date)}:\n${lines.join("\n")}` : "พบแผนเมนูแล้ว แต่ยังไม่มีเมนูอยู่ในแผนครับ";
}

function requirementsAnswer(result: CopilotToolResult): string {
  const data = asObject(result.data);
  const rows = Array.isArray(data.rows) ? (data.rows as Array<Record<string, unknown>>) : [];
  if (rows.length === 0) return "ยังไม่มีความต้องการวัตถุดิบจากแผนเมนูที่ยืนยันแล้วในช่วงที่ถามครับ";
  const warning = number(data.unconfirmedPlans) > 0 ? `\nมีแผนที่ยังไม่ยืนยัน ${quantity(data.unconfirmedPlans)} แผน ซึ่งยังไม่รวมในยอดนี้` : "";
  return `วัตถุดิบที่ต้องใช้ตามแผนที่ยืนยันแล้ว:\n${rows
    .map((row) => `- ${String(row.item)} (${String(row.code)}): ${quantity(row.totalBaseQty)} ${String(row.unit ?? "หน่วย")}`)
    .join("\n")}${warning}`;
}

function purchaseAnswer(result: CopilotToolResult): string {
  const data = asObject(result.data);
  const groups = Array.isArray(data.groups) ? (data.groups as Array<Record<string, unknown>>) : [];
  const unsourced = Array.isArray(data.unsourced) ? data.unsourced.map(String) : [];
  if (groups.length === 0 && unsourced.length === 0) {
    return "ยังไม่มีรายการที่ระบบแนะนำให้สั่งซื้อในช่วงที่ถามครับ";
  }
  const lines = groups.flatMap((group) => {
    const entries = Array.isArray(group.lines) ? (group.lines as Array<Record<string, unknown>>) : [];
    return entries.map(
      (line) =>
        `- ${String(line.item)}: แนะนำ ${quantity(line.suggestedPurchaseQty)} ${String(line.purchaseUnit ?? "หน่วย")} จาก ${String(group.supplier ?? "ผู้ขายไม่ระบุ")} (ควรสั่งภายใน ${String(group.orderByDate ?? "ไม่ระบุ")})`,
    );
  });
  if (unsourced.length > 0) lines.push(`- ยังไม่มีผู้ขาย: ${unsourced.join(", ")}`);
  return `แผนสั่งซื้อจากข้อมูลปัจจุบัน:\n${lines.join("\n")}`;
}

function priceAnswer(result: CopilotToolResult): string {
  const data = cappedRows<Record<string, unknown>>(result.data);
  if (data.rows.length === 0) return "ยังไม่มีประวัติราคาซื้อที่ตรงกับคำถามครับ";
  return `ประวัติราคาซื้อล่าสุด:\n${data.rows
    .slice(0, 12)
    .map((row) => `- ${String(row.item)} วันที่ ${String(row.receivedDate)}: ${money(row.unitCost)} ต่อหน่วยฐาน`)
    .join("\n")}`;
}

function answerFor(toolName: string, result: CopilotToolResult, question: string): string {
  if (toolName === "get_stock_on_hand") return stockAnswer(result, question);
  if (toolName === "get_expiring_items") return expiryAnswer(result);
  if (toolName === "get_daily_cost") return costAnswer(result);
  if (toolName === "get_menu_plan") return menuAnswer(result);
  if (toolName === "get_material_requirements") return requirementsAnswer(result);
  if (toolName === "get_purchase_plan") return purchaseAnswer(result);
  if (toolName === "get_price_history") return priceAnswer(result);
  return "ยังไม่สามารถสรุปข้อมูลส่วนนี้ได้ครับ";
}

/**
 * Free, deterministic assistant used when no paid model key is configured. It routes a
 * useful set of Thai/English questions to the exact same permission-scoped read tools as
 * the model-backed assistant, so the figures still come from live data and it still cannot
 * create or change transactions.
 */
export async function askLocalCopilot(input: {
  question: string;
  context: CopilotToolContext;
  availableTools: CopilotTool[];
}): Promise<LocalCopilotAnswer> {
  const { question, context, availableTools } = input;

  if (/^(ช่วย)?\s*(รับของ|เบิก|โอน|ปรับสต็อก|สร้างคำสั่งซื้อ|สั่งซื้อ.*ให้)|ทำรายการ.*(ให้|แทน)/i.test(question)) {
    return {
      text: "ผมอ่านและสรุปข้อมูลให้ได้ แต่ทำรายการแทนไม่ได้ครับ กรุณาเปิดหน้ารับของ เบิกของ โอนของ หรือสั่งซื้อ แล้วกดยืนยันด้วยบัญชีของคุณเพื่อให้มีหลักฐานผู้ทำรายการ",
      sources: [],
      toolCalls: 0,
      refused: false,
    };
  }

  const toolName = intentOf(question);
  if (!toolName) {
    return {
      text: "ผมช่วยอ่านข้อมูลจริงให้ได้ เช่น “สต็อกเหลือเท่าไร”, “มีของใกล้หมดอายุไหม”, “พรุ่งนี้มีเมนูอะไร”, “สัปดาห์นี้ต้องซื้ออะไร” หรือ “เดือนนี้ต้นทุนเท่าไร” ครับ",
      sources: [],
      toolCalls: 0,
      refused: false,
    };
  }

  const tool = availableTools.find((entry) => entry.name === toolName);
  if (!tool) {
    return {
      text: `บัญชีนี้ยังไม่มีสิทธิ์ดูข้อมูล${TOOL_PERMISSION_NAMES[toolName] ?? "ส่วนนี้"}ครับ กรุณาติดต่อผู้ดูแลระบบเพื่อเพิ่มสิทธิ์`,
      sources: [],
      toolCalls: 0,
      refused: false,
    };
  }

  const rawInput = toolInput(toolName, question, context.today);
  const parsed = tool.schema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      text: "รูปแบบวันที่หรือรายละเอียดในคำถามยังไม่ถูกต้องครับ ลองใช้วันที่แบบ YYYY-MM-DD",
      sources: [],
      toolCalls: 0,
      refused: false,
    };
  }

  const result = await tool.run(parsed.data as never, context);
  return {
    text: answerFor(toolName, result, question),
    sources: [
      {
        toolName,
        label: TOOL_LABELS[toolName] ?? result.sourceLabel,
        href: result.href,
      },
    ],
    toolCalls: 1,
    refused: false,
  };
}
