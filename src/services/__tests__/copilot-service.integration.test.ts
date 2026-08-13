import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray } from "drizzle-orm";
import { PERMISSIONS, type PermissionCode, type RoleCode } from "@/lib/permissions";

/**
 * Phase 13. The copilot's safety properties are structural, and these tests hold them down:
 * it cannot write, it cannot read past the asking user's permissions, and every figure in an
 * answer came from a tool rather than from the model. The model itself is stubbed — what is
 * under test is the loop and the tools, which is where those guarantees actually live.
 */
const actor = {
  id: "",
  organizationId: "",
  email: "integration-copilot@canteen.local",
  fullName: "Integration Asker",
  defaultLocationId: null as string | null,
  defaultLocationName: null,
  roleCodes: ["MANAGER"] as RoleCode[],
  permissions: Object.values(PERMISSIONS) as PermissionCode[],
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async (required: string | string[]) => {
    const list = Array.isArray(required) ? required : [required];
    if (!list.every((code) => (actor.permissions as string[]).includes(code))) {
      const { AppError } = await import("@/lib/errors");
      throw new AppError("FORBIDDEN");
    }
    return actor;
  }),
  requireUser: vi.fn(async () => actor),
  getCurrentUser: vi.fn(async () => actor),
  getRequestMetadata: vi.fn(async () => ({ ipAddress: "127.0.0.1", userAgent: "vitest" })),
}));

const { db } = await import("@/database/client");
const {
  auditLogs,
  inventoryLots,
  inventoryPostings,
  inventoryTransactions,
  items,
  locations,
  organizations,
  stockBalances,
  units,
  users,
} = await import("@/database/schema");
const { postMovementAs } = await import("@/services/inventory-ledger-service");
const { createLot } = await import("@/services/inventory-lot-service");
const { askCopilot } = await import("@/services/copilot-service");
const { COPILOT_TOOLS, toolsForUser } = await import("@/lib/copilot/tools");

const ITEM_CODE = "TEST-COPILOT-CHICKEN";

let itemId = "";
let locationId = "";
let kgUnitId = "";
let keyCounter = 0;

const TODAY = "2026-10-01";

/**
 * A stubbed model. Each entry is one turn: either tool calls to make, or the final text.
 * Replaces the network entirely, so the loop is tested without an API key.
 */
function stubClient(turns: Array<{ tools?: Array<{ name: string; input: unknown }>; text?: string }>) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let index = 0;

  const client = {
    createMessage: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
      calls.push(params);
      const turn = turns[index] ?? { text: "จบแล้ว" };
      index += 1;

      // Shaped by hand rather than with SDK constructors: the loop only reads `type`,
      // `id`, `name`, `input` and `text`, so the rest of the block surface is noise here.
      const content = turn.tools
        ? turn.tools.map((tool, position) => ({
            type: "tool_use",
            id: `toolu_${index}_${position}`,
            name: tool.name,
            input: tool.input,
          }))
        : [{ type: "text", text: turn.text ?? "" }];

      return {
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content,
        stop_reason: turn.tools ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      } as unknown as Anthropic.Message;
    },
  };

  return { client, calls };
}

/** The rows the model was handed back for a given tool call. */
function toolResultsIn(params: Anthropic.MessageCreateParamsNonStreaming) {
  const results: Anthropic.ToolResultBlockParam[] = [];
  for (const message of params.messages) {
    if (message.role !== "user" || typeof message.content === "string") continue;
    for (const block of message.content) {
      if (block.type === "tool_result") results.push(block);
    }
  }
  return results;
}

async function purge() {
  if (!itemId) return;

  const lots = await db
    .select({ id: inventoryLots.id })
    .from(inventoryLots)
    .where(eq(inventoryLots.itemId, itemId));
  const lotIds = lots.map((lot) => lot.id);
  if (lotIds.length === 0) return;

  const postingIds = [
    ...new Set(
      (
        await db
          .select({ postingId: inventoryTransactions.postingId })
          .from(inventoryTransactions)
          .where(inArray(inventoryTransactions.lotId, lotIds))
      ).map((row) => row.postingId),
    ),
  ];
  await db.delete(inventoryTransactions).where(inArray(inventoryTransactions.lotId, lotIds));
  await db.delete(stockBalances).where(inArray(stockBalances.lotId, lotIds));
  if (postingIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, postingIds));
    await db.delete(inventoryPostings).where(inArray(inventoryPostings.id, postingIds));
  }
  await db.delete(inventoryLots).where(inArray(inventoryLots.id, lotIds));
}

beforeAll(async () => {
  const [organization] = await db.select().from(organizations).limit(1);
  if (!organization) throw new Error("Run `npm run db:seed` before the integration tests.");
  actor.organizationId = organization.id;

  await db.delete(users).where(eq(users.email, actor.email));
  const [userRow] = await db
    .insert(users)
    .values({ organizationId: organization.id, email: actor.email, fullName: actor.fullName })
    .returning();
  actor.id = userRow!.id;

  const [kg] = await db.select().from(units).where(eq(units.code, "KG")).limit(1);
  kgUnitId = kg!.id;

  const [b16] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.organizationId, organization.id), eq(locations.code, "B16")))
    .limit(1);
  locationId = b16!.id;
  actor.defaultLocationId = locationId;

  const [item] = await db
    .insert(items)
    .values({
      organizationId: organization.id,
      code: ITEM_CODE,
      nameTh: "ไก่บด (ทดสอบผู้ช่วย)",
      baseUnitId: kgUnitId,
      purchaseUnitId: kgUnitId,
      purchaseConversion: "1",
    })
    .onConflictDoUpdate({
      target: [items.organizationId, items.code],
      set: { nameTh: "ไก่บด (ทดสอบผู้ช่วย)" },
    })
    .returning();
  itemId = item!.id;
});

beforeEach(async () => {
  actor.permissions = Object.values(PERMISSIONS) as PermissionCode[];
  await purge();
  await db
    .delete(auditLogs)
    .where(and(eq(auditLogs.userId, actor.id), eq(auditLogs.entityType, "copilot_query")));

  const lot = await createLot({
    organizationId: actor.organizationId,
    itemId,
    lotNumber: `COPILOT-${(keyCounter += 1)}-${Date.now()}`,
    receivedBaseQty: 42,
    unitCost: 90,
    expiryDate: "2030-12-31",
  });
  await postMovementAs(actor, {
    idempotencyKey: `test-copilot:${(keyCounter += 1)}:${Date.now()}`,
    referenceType: "GOODS_RECEIPT",
    lines: [{ type: "RECEIVE", itemId, lotId: lot.id, locationId, baseQty: 42 }],
  });
});

afterAll(async () => {
  await purge();
  await db.delete(auditLogs).where(eq(auditLogs.userId, actor.id));
  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(eq(users.email, actor.email));
});

describe("the copilot cannot write", () => {
  it("exposes only read tools", () => {
    // A structural guarantee, asserted structurally: nothing in the catalogue can mutate.
    const writePermissions: string[] = [
      PERMISSIONS.RECEIVE_CREATE,
      PERMISSIONS.ISSUE_CREATE,
      PERMISSIONS.TRANSFER_CREATE,
      PERMISSIONS.ADJUSTMENT_CREATE,
      PERMISSIONS.PO_MANAGE,
      PERMISSIONS.PO_APPROVE,
      PERMISSIONS.ITEM_MANAGE,
      PERMISSIONS.MENU_MANAGE,
      PERMISSIONS.RECIPE_MANAGE,
      PERMISSIONS.USER_MANAGE,
      PERMISSIONS.SETTINGS_MANAGE,
    ];

    for (const tool of COPILOT_TOOLS) {
      expect(writePermissions).not.toContain(tool.permission);
    }
  });

  it("does not move stock even when the model asks for a tool that does not exist", async () => {
    const before = await db
      .select({ baseQty: stockBalances.baseQty })
      .from(stockBalances)
      .where(and(eq(stockBalances.itemId, itemId), eq(stockBalances.locationId, locationId)));

    const { client } = stubClient([
      { tools: [{ name: "issue_stock", input: { itemId, qty: 10 } }] },
      { text: "ทำรายการแทนไม่ได้ครับ ต้องไปที่หน้าเบิกสินค้า" },
    ]);

    const answer = await askCopilot(
      { messages: [{ role: "user", content: "เบิกไก่บด 10 กิโลให้หน่อย" }] },
      { client, context: { user: actor, today: TODAY } },
    );

    const after = await db
      .select({ baseQty: stockBalances.baseQty })
      .from(stockBalances)
      .where(and(eq(stockBalances.itemId, itemId), eq(stockBalances.locationId, locationId)));

    expect(after).toEqual(before);
    expect(answer.text).toContain("ไม่ได้");
  });
});

describe("answers come from real data", () => {
  it("hands the model the actual stock figure", async () => {
    const { client, calls } = stubClient([
      { tools: [{ name: "get_stock_on_hand", input: { itemQuery: "ทดสอบผู้ช่วย" } }] },
      { text: "ไก่บดเหลือ 42 กิโลกรัม" },
    ]);

    const answer = await askCopilot(
      { messages: [{ role: "user", content: "ไก่บดเหลือเท่าไร" }] },
      { client, context: { user: actor, today: TODAY } },
    );

    const results = toolResultsIn(calls.at(-1)!);
    expect(results).toHaveLength(1);
    expect(results[0]!.is_error).toBeFalsy();
    expect(String(results[0]!.content)).toContain("42.0000");
    expect(answer.toolCalls).toBe(1);
  });

  it("cites the screen the figure came from", async () => {
    const { client } = stubClient([
      { tools: [{ name: "get_stock_on_hand", input: {} }] },
      { text: "..." },
    ]);

    const answer = await askCopilot(
      { messages: [{ role: "user", content: "สต๊อกเป็นยังไงบ้าง" }] },
      { client, context: { user: actor, today: TODAY } },
    );

    expect(answer.sources).toEqual([
      { toolName: "get_stock_on_hand", label: "สต๊อกคงเหลือ", href: "/inventory/stock" },
    ]);
  });

  it("runs several tools in one turn and cites each once", async () => {
    const { client } = stubClient([
      {
        tools: [
          { name: "get_stock_on_hand", input: {} },
          { name: "get_expiring_items", input: { withinDays: 30 } },
        ],
      },
      { text: "สรุปแล้ว..." },
    ]);

    const answer = await askCopilot(
      { messages: [{ role: "user", content: "สต๊อกและของใกล้หมดอายุ" }] },
      { client, context: { user: actor, today: TODAY } },
    );

    expect(answer.toolCalls).toBe(2);
    expect(answer.sources.map((source) => source.toolName)).toEqual([
      "get_stock_on_hand",
      "get_expiring_items",
    ]);
  });

  it("reports an empty result rather than inventing one", async () => {
    const { client, calls } = stubClient([
      { tools: [{ name: "get_stock_on_hand", input: { itemQuery: "ไม่มีของแบบนี้แน่ๆ" } }] },
      { text: "ไม่พบวัตถุดิบนี้ในสต๊อก" },
    ]);

    await askCopilot(
      { messages: [{ role: "user", content: "ทุเรียนเหลือเท่าไร" }] },
      { client, context: { user: actor, today: TODAY } },
    );

    const results = toolResultsIn(calls.at(-1)!);
    expect(JSON.parse(String(results[0]!.content))).toMatchObject({ rows: [], total: 0 });
  });
});

describe("permissions", () => {
  it("hides tools the user is not cleared for", () => {
    actor.permissions = [PERMISSIONS.STOCK_VIEW];

    const names = toolsForUser(actor).map((tool) => tool.name);

    expect(names).toContain("get_stock_on_hand");
    expect(names).not.toContain("get_daily_cost");
    expect(names).not.toContain("get_purchase_plan");
  });

  it("refuses a tool the user lost access to, without failing the whole answer", async () => {
    actor.permissions = [PERMISSIONS.STOCK_VIEW];

    const { client, calls } = stubClient([
      {
        tools: [
          { name: "get_stock_on_hand", input: {} },
          { name: "get_daily_cost", input: { fromDate: "2026-09-01", toDate: "2026-09-30" } },
        ],
      },
      { text: "ดูสต๊อกได้ แต่ต้นทุนต้องขอสิทธิ์เพิ่ม" },
    ]);

    const answer = await askCopilot(
      { messages: [{ role: "user", content: "สต๊อกกับต้นทุน" }] },
      { client, context: { user: actor, today: TODAY } },
    );

    const results = toolResultsIn(calls.at(-1)!);
    const denied = results.find((result) => result.is_error);

    expect(denied).toBeDefined();
    expect(String(denied!.content)).toContain("ไม่มีสิทธิ์");
    // The permitted half still ran.
    expect(answer.sources.map((source) => source.toolName)).toEqual(["get_stock_on_hand"]);
  });

  it("does not offer the copilot at all to a user with no readable data", async () => {
    actor.permissions = [];

    await expect(
      askCopilot(
        { messages: [{ role: "user", content: "สวัสดี" }] },
        { client: stubClient([]).client, context: { user: actor, today: TODAY } },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("only sends the model the tools this user may call", async () => {
    actor.permissions = [PERMISSIONS.STOCK_VIEW];

    const { client, calls } = stubClient([{ text: "สวัสดีครับ" }]);
    await askCopilot(
      { messages: [{ role: "user", content: "สวัสดี" }] },
      { client, context: { user: actor, today: TODAY } },
    );

    const names = (calls[0]!.tools ?? []).map((tool) => tool.name);
    expect(names).toEqual(["get_stock_on_hand", "get_expiring_items"]);
  });
});

describe("loop safety", () => {
  it("stops after the iteration cap instead of looping forever", async () => {
    // A model that only ever asks for more tools and never answers.
    const { client, calls } = stubClient(
      Array.from({ length: 20 }, () => ({
        tools: [{ name: "get_stock_on_hand", input: {} }],
      })),
    );

    const answer = await askCopilot(
      { messages: [{ role: "user", content: "วนไปเรื่อยๆ" }] },
      { client, context: { user: actor, today: TODAY } },
    );

    expect(calls).toHaveLength(6);
    expect(answer.text).toContain("สรุปไม่ได้");
  });

  it("reports a refusal as a refusal rather than as an empty answer", async () => {
    const client = {
      createMessage: async () =>
        ({
          id: "msg_refusal",
          type: "message",
          role: "assistant",
          model: "claude-opus-5",
          content: [],
          stop_reason: "refusal",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        }) as unknown as Anthropic.Message,
    };

    const answer = await askCopilot(
      { messages: [{ role: "user", content: "คำถามที่ถูกปฏิเสธ" }] },
      { client, context: { user: actor, today: TODAY } },
    );

    expect(answer.refused).toBe(true);
    expect(answer.text).toContain("ไม่สามารถตอบ");
  });

  it("rejects a bad tool input instead of passing it through to the database", async () => {
    const { client, calls } = stubClient([
      { tools: [{ name: "get_daily_cost", input: { fromDate: "เมื่อวาน", toDate: "วันนี้" } }] },
      { text: "ขอวันที่แบบ YYYY-MM-DD ครับ" },
    ]);

    await askCopilot(
      { messages: [{ role: "user", content: "ต้นทุนเมื่อวาน" }] },
      { client, context: { user: actor, today: TODAY } },
    );

    const results = toolResultsIn(calls.at(-1)!);
    expect(results[0]!.is_error).toBe(true);
  });

  it("refuses an empty question", async () => {
    await expect(
      askCopilot(
        { messages: [{ role: "user", content: "   " }] },
        { client: stubClient([]).client, context: { user: actor, today: TODAY } },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("audit trail", () => {
  it("records who asked what and which data it touched", async () => {
    const { client } = stubClient([
      { tools: [{ name: "get_stock_on_hand", input: {} }] },
      { text: "เหลือ 42 กิโล" },
    ]);

    await askCopilot(
      { messages: [{ role: "user", content: "ไก่บดเหลือเท่าไร" }] },
      { client, context: { user: actor, today: TODAY } },
    );

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, actor.id), eq(auditLogs.entityType, "copilot_query")))
      .limit(1);

    expect(log).toBeDefined();
    expect(log!.action).toBe("VIEW");
    expect(log!.afterData).toMatchObject({
      question: "ไก่บดเหลือเท่าไร",
      tools: ["get_stock_on_hand"],
    });
  });
});
