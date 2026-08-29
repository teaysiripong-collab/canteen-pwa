import { z } from "zod";
import type { SessionUser } from "@/lib/auth/session";
import { addDays, todayIso } from "@/lib/date";
import { PERMISSIONS, type PermissionCode } from "@/lib/permissions";

/**
 * What the copilot is allowed to do.
 *
 * Every tool here reads. None of them writes. That is a structural property of this file,
 * not a rule the model is asked to follow: there is no code path from a chat message to a
 * stock movement, so no amount of clever prompting can make the assistant post one. Moving
 * stock stays with the screens, where a person presses the button and the ledger records who.
 *
 * Each tool declares the permission it needs, and the executor checks it against the asking
 * user — so the copilot can never become a way to read figures a person is not cleared for.
 */

export type CopilotToolContext = {
  user: SessionUser;
  /** Today in Bangkok, injected so tests are not clock-dependent. */
  today: string;
};

export type CopilotToolResult = {
  /** Shown to the user under the answer, so a number can always be traced to a screen. */
  sourceLabel: string;
  href?: string;
  data: unknown;
};

export type CopilotTool = {
  name: string;
  description: string;
  permission: PermissionCode;
  schema: z.ZodType;
  inputSchema: Record<string, unknown>;
  run: (input: never, context: CopilotToolContext) => Promise<CopilotToolResult>;
};

/** Trims a result set so one broad question cannot flood the model's context. */
function cap<T>(rows: T[], limit: number): { rows: T[]; truncated: boolean; total: number } {
  return { rows: rows.slice(0, limit), truncated: rows.length > limit, total: rows.length };
}

const stockInput = z.object({
  itemQuery: z.string().trim().min(1).optional(),
  locationCode: z.string().trim().min(1).optional(),
});

const expiryInput = z.object({
  withinDays: z.number().int().min(1).max(60).optional(),
});

const dateRangeInput = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const dayInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const priceInput = z.object({
  itemQuery: z.string().trim().min(1).optional(),
});

/** Resolves a location code the user typed ("B16") to its id, or null for "everywhere". */
async function resolveLocationId(
  organizationId: string,
  code: string | undefined,
): Promise<string | undefined> {
  if (!code) return undefined;
  const { listStockLocations } = await import("@/repositories/inventory-repository");
  const locations = await listStockLocations(organizationId);
  return locations.find((location) => location.code.toLowerCase() === code.toLowerCase())?.id;
}

export const COPILOT_TOOLS: CopilotTool[] = [
  {
    name: "get_stock_on_hand",
    description:
      "ดูสต๊อกคงเหลือปัจจุบันของวัตถุดิบ ใช้เมื่อผู้ใช้ถามว่าของเหลือเท่าไร ยังมีของไหม หรือของหมดหรือยัง " +
      "ค้นด้วยชื่อไทยหรือรหัสวัตถุดิบบางส่วนได้ ถ้าไม่ระบุจะคืนรายการที่มีของทั้งหมด",
    permission: PERMISSIONS.STOCK_VIEW,
    schema: stockInput,
    inputSchema: {
      type: "object",
      properties: {
        itemQuery: { type: "string", description: "ชื่อหรือรหัสวัตถุดิบบางส่วน เช่น ไก่ หรือ MEAT" },
        locationCode: { type: "string", description: "รหัสสถานที่ เช่น B1 หรือ B16" },
      },
      additionalProperties: false,
    },
    run: async (input: z.infer<typeof stockInput>, { user }) => {
      const { listStockBalances } = await import("@/repositories/inventory-repository");
      const locationId = await resolveLocationId(user.organizationId, input.locationCode);
      const rows = await listStockBalances(user.organizationId, {
        q: input.itemQuery,
        locationId,
        onlyInStock: true,
      });

      return {
        sourceLabel: "สต๊อกคงเหลือ",
        href: "/inventory/stock",
        data: cap(
          rows.map((row) => ({
            item: row.itemNameTh,
            code: row.itemCode,
            location: row.locationCode,
            baseQty: row.baseQty,
            unit: row.baseUnitCode,
            minimumStock: row.minimumStock,
            reorderPoint: row.reorderPoint,
          })),
          40,
        ),
      };
    },
  },

  {
    name: "get_expiring_items",
    description:
      "ดูลอตที่ใกล้หมดอายุหรือหมดอายุแล้ว ใช้เมื่อผู้ใช้ถามว่ามีของใกล้เสียไหม ต้องรีบใช้อะไรก่อน",
    permission: PERMISSIONS.STOCK_VIEW,
    schema: expiryInput,
    inputSchema: {
      type: "object",
      properties: {
        withinDays: { type: "integer", description: "ภายในกี่วัน (ค่าเริ่มต้น 7)" },
      },
      additionalProperties: false,
    },
    run: async (input: z.infer<typeof expiryInput>, { user, today }) => {
      const { listExpiringLots } = await import("@/repositories/inventory-repository");
      const days = input.withinDays ?? 7;
      const rows = await listExpiringLots(user.organizationId, days, today);

      return {
        sourceLabel: `ของใกล้หมดอายุภายใน ${days} วัน`,
        href: "/inventory/expiry",
        data: cap(
          rows.map((row) => ({
            item: row.itemNameTh,
            lot: row.lotNumber,
            expiryDate: row.expiryDate,
            location: row.locationCode,
            baseQty: row.baseQty,
            unit: row.baseUnitCode,
          })),
          40,
        ),
      };
    },
  },

  {
    name: "get_daily_cost",
    description:
      "ดูต้นทุนที่ใช้ไปจริงต่อวัน (เบิกใช้ + ของเสีย) ในช่วงวันที่กำหนด ใช้เมื่อผู้ใช้ถามว่าใช้ต้นทุนไปเท่าไร",
    permission: PERMISSIONS.COST_VIEW,
    schema: dateRangeInput,
    inputSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "วันเริ่มต้น YYYY-MM-DD" },
        toDate: { type: "string", description: "วันสิ้นสุด YYYY-MM-DD" },
      },
      required: ["fromDate", "toDate"],
      additionalProperties: false,
    },
    run: async (input: z.infer<typeof dateRangeInput>, { user }) => {
      const { getDailyCosts } = await import("@/services/costing-service");
      const rows = await getDailyCosts(user.organizationId, {
        fromDate: input.fromDate,
        toDate: input.toDate,
      });

      return {
        sourceLabel: `ต้นทุนรายวัน ${input.fromDate} ถึง ${input.toDate}`,
        href: `/cost/daily?from=${input.fromDate}&to=${input.toDate}`,
        data: cap(rows, 62),
      };
    },
  },

  {
    name: "get_menu_plan",
    description: "ดูแผนเมนูของวันที่ระบุ ว่าวันนั้นทำเมนูอะไร กะไหน กี่ที่ และแผนยืนยันแล้วหรือยัง",
    permission: PERMISSIONS.MENU_VIEW,
    schema: dayInput,
    inputSchema: {
      type: "object",
      properties: { date: { type: "string", description: "วันที่ YYYY-MM-DD (ค่าเริ่มต้นคือวันนี้)" } },
      additionalProperties: false,
    },
    run: async (input: z.infer<typeof dayInput>, { user, today }) => {
      const { getDayPlan } = await import("@/services/menu-plan-service");
      const { listStockLocations } = await import("@/repositories/inventory-repository");
      const date = input.date ?? today;
      const locations = await listStockLocations(user.organizationId);
      const locationId = user.defaultLocationId ?? locations[0]?.id;

      if (!locationId) {
        return { sourceLabel: "แผนเมนู", href: "/menu/planner", data: { plans: [] } };
      }

      const plans = await getDayPlan(user.organizationId, date, locationId);

      return {
        sourceLabel: `แผนเมนูวันที่ ${date}`,
        href: `/menu/planner?date=${date}`,
        data: { date, plans },
      };
    },
  },

  {
    name: "get_material_requirements",
    description:
      "ดูว่าตามแผนเมนูที่ยืนยันแล้วในช่วงวันที่นี้ ต้องใช้วัตถุดิบอะไรบ้างรวมเท่าไร (ยังไม่หักของที่มีอยู่)",
    permission: PERMISSIONS.MENU_VIEW,
    schema: dateRangeInput,
    inputSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "วันเริ่มต้น YYYY-MM-DD" },
        toDate: { type: "string", description: "วันสิ้นสุด YYYY-MM-DD" },
      },
      required: ["fromDate", "toDate"],
      additionalProperties: false,
    },
    run: async (input: z.infer<typeof dateRangeInput>, { user }) => {
      const { getMaterialRequirements } = await import("@/services/menu-requirement-service");
      const report = await getMaterialRequirements({
        organizationId: user.organizationId,
        fromDate: input.fromDate,
        toDate: input.toDate,
      });

      return {
        sourceLabel: `ความต้องการวัตถุดิบ ${input.fromDate} ถึง ${input.toDate}`,
        href: "/menu/planner",
        data: {
          unconfirmedPlans: report.unconfirmedPlans,
          ...cap(
            report.rows.map((row) => ({
              item: row.itemNameTh,
              code: row.itemCode,
              totalBaseQty: row.totalBaseQty,
              unit: row.unitCode,
            })),
            40,
          ),
        },
      };
    },
  },

  {
    name: "get_purchase_plan",
    description:
      "ดูว่าต้องสั่งซื้ออะไรบ้าง คำนวณจากความต้องการตามแผนเมนู บวกสต๊อกสำรอง ลบของที่มีอยู่ ลบของที่สั่งไปแล้ว " +
      "ใช้เมื่อผู้ใช้ถามว่าต้องซื้ออะไร ต้องสั่งของเมื่อไร",
    permission: PERMISSIONS.PO_VIEW,
    schema: dateRangeInput,
    inputSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "วันเริ่มต้น YYYY-MM-DD" },
        toDate: { type: "string", description: "วันสิ้นสุด YYYY-MM-DD" },
      },
      required: ["fromDate", "toDate"],
      additionalProperties: false,
    },
    run: async (input: z.infer<typeof dateRangeInput>, { user }) => {
      const { getPurchasePlan } = await import("@/services/purchase-planner-service");
      const { listStockLocations } = await import("@/repositories/inventory-repository");
      const locations = await listStockLocations(user.organizationId);
      const locationId = user.defaultLocationId ?? locations[0]?.id;

      if (!locationId) {
        return { sourceLabel: "แผนสั่งซื้อ", href: "/purchasing/planner", data: { groups: [] } };
      }

      const plan = await getPurchasePlan({
        organizationId: user.organizationId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        locationId,
      });

      return {
        sourceLabel: `แผนสั่งซื้อ ${input.fromDate} ถึง ${input.toDate}`,
        href: `/purchasing/planner?from=${input.fromDate}&to=${input.toDate}`,
        data: {
          unconfirmedPlans: plan.unconfirmedPlans,
          unsourced: plan.unsourced.map((line) => line.itemNameTh),
          groups: plan.groups.map((group) => ({
            supplier: group.supplierNameTh,
            orderByDate: group.orderByDate,
            isLate: group.isLate,
            estimatedTotal: group.estimatedTotal,
            lines: group.lines.slice(0, 20).map((line) => ({
              item: line.itemNameTh,
              shortfallBaseQty: line.shortfallBaseQty,
              suggestedPurchaseQty: line.suggestedPurchaseQty,
              purchaseUnit: line.purchaseUnitCode,
            })),
          })),
        },
      };
    },
  },

  {
    name: "get_price_history",
    description: "ดูราคาที่รับของเข้ามาจริงในแต่ละครั้ง ใช้เมื่อผู้ใช้ถามว่าราคาขึ้นไหม ครั้งก่อนซื้อเท่าไร",
    permission: PERMISSIONS.COST_VIEW,
    schema: priceInput,
    inputSchema: {
      type: "object",
      properties: {
        itemQuery: { type: "string", description: "ชื่อหรือรหัสวัตถุดิบบางส่วน" },
      },
      additionalProperties: false,
    },
    run: async (input: z.infer<typeof priceInput>, { user, today }) => {
      const { getPriceHistory } = await import("@/services/costing-service");
      const rows = await getPriceHistory(user.organizationId, {
        fromDate: addDays(today, -180),
        toDate: today,
        limit: 200,
      });

      const query = input.itemQuery?.toLowerCase();
      const filtered = query
        ? rows.filter(
            (row) =>
              row.itemNameTh.toLowerCase().includes(query) ||
              row.itemCode.toLowerCase().includes(query),
          )
        : rows;

      return {
        sourceLabel: "ประวัติราคาซื้อ",
        href: "/cost/price-history",
        data: cap(
          filtered.map((row) => ({
            item: row.itemNameTh,
            receivedDate: row.receivedDate,
            unitCost: row.unitCost,
            baseQty: row.baseQty,
          })),
          30,
        ),
      };
    },
  },
];

export const COPILOT_TOOLS_BY_NAME = new Map(COPILOT_TOOLS.map((tool) => [tool.name, tool]));

/** Only the tools this user is cleared for; the rest are never shown to the model. */
export function toolsForUser(user: SessionUser): CopilotTool[] {
  return COPILOT_TOOLS.filter((tool) => user.permissions.includes(tool.permission));
}

export function defaultToolContext(user: SessionUser): CopilotToolContext {
  return { user, today: todayIso() };
}
