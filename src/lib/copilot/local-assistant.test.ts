import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { askLocalCopilot } from "./local-assistant";
import type { CopilotTool, CopilotToolContext } from "./tools";
import { PERMISSIONS } from "@/lib/permissions";

const context = {
  today: "2026-08-29",
  user: {
    id: "user-1",
    organizationId: "org-1",
    email: "admin@example.com",
    fullName: "Admin",
    defaultLocationId: "location-1",
    defaultLocationName: "คลังหลัก",
    roleCodes: ["ADMIN"],
    permissions: Object.values(PERMISSIONS),
  },
} as CopilotToolContext;

function tool(
  name: string,
  data: unknown,
  permission = PERMISSIONS.STOCK_VIEW,
): CopilotTool {
  return {
    name,
    description: "test",
    permission,
    schema: z.object({}).passthrough(),
    inputSchema: { type: "object" },
    run: vi.fn(async () => ({
      sourceLabel: "test source",
      href: "/inventory/stock",
      data,
    })),
  };
}

describe("free local copilot", () => {
  it("answers a Thai stock question from the supplied live-data tool", async () => {
    const stock = tool("get_stock_on_hand", {
      rows: [
        {
          item: "ข้าวสารหอมมะลิ",
          code: "RM-RICE-001",
          location: "B1",
          baseQty: "20.0000",
          unit: "KG",
          reorderPoint: "20.0000",
        },
        {
          item: "อกไก่",
          code: "RM-CHICKEN-001",
          location: "B1",
          baseQty: "10.0000",
          unit: "KG",
          reorderPoint: "10.0000",
        },
      ],
      total: 2,
      truncated: false,
    });

    const answer = await askLocalCopilot({
      question: "สต็อกคงเหลือเป็นอย่างไรบ้าง",
      context,
      availableTools: [stock],
    });

    expect(stock.run).toHaveBeenCalledOnce();
    expect(answer.text).toContain("ข้าวสารหอมมะลิ");
    expect(answer.text).toContain("20");
    expect(answer.text).toContain("อกไก่");
    expect(answer.sources).toEqual([
      { toolName: "get_stock_on_hand", label: "สต็อกคงเหลือ", href: "/inventory/stock" },
    ]);
    expect(answer.toolCalls).toBe(1);
  });

  it("reports missing permission without running another tool", async () => {
    const stock = tool("get_stock_on_hand", { rows: [], total: 0, truncated: false });

    const answer = await askLocalCopilot({
      question: "เดือนนี้ต้นทุนเท่าไร",
      context,
      availableTools: [stock],
    });

    expect(stock.run).not.toHaveBeenCalled();
    expect(answer.text).toContain("ไม่มีสิทธิ์ดูข้อมูลต้นทุน");
    expect(answer.toolCalls).toBe(0);
  });

  it("treats a reorder-point question as a stock check, not a purchase-plan request", async () => {
    const stock = tool("get_stock_on_hand", {
      rows: [
        {
          item: "อกไก่",
          code: "RM-CHICKEN-001",
          location: "B1",
          baseQty: "10",
          unit: "KG",
          reorderPoint: "10",
        },
      ],
      total: 1,
      truncated: false,
    });

    const answer = await askLocalCopilot({
      question: "มีรายการไหนสต็อกต่ำกว่าจุดสั่งซื้อ",
      context,
      availableTools: [stock],
    });

    expect(stock.run).toHaveBeenCalledOnce();
    expect(answer.text).toContain("อกไก่");
    expect(answer.text).toContain("จุดสั่งซื้อ 10 KG");
  });

  it("never turns an imperative chat message into a stock mutation", async () => {
    const stock = tool("get_stock_on_hand", { rows: [], total: 0, truncated: false });

    const answer = await askLocalCopilot({
      question: "ช่วยเบิกอกไก่ 2 กิโลให้หน่อย",
      context,
      availableTools: [stock],
    });

    expect(stock.run).not.toHaveBeenCalled();
    expect(answer.text).toContain("ทำรายการแทนไม่ได้");
    expect(answer.toolCalls).toBe(0);
  });

  it("explains the supported questions when no intent matches", async () => {
    const answer = await askLocalCopilot({
      question: "สวัสดีครับ",
      context,
      availableTools: [],
    });

    expect(answer.text).toContain("สต็อกเหลือเท่าไร");
    expect(answer.sources).toEqual([]);
  });
});
