import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/database/client";
import { requireUser } from "@/lib/auth/session";
import {
  COPILOT_EFFORT,
  COPILOT_MAX_ITERATIONS,
  COPILOT_MAX_TOKENS,
  COPILOT_MODEL,
  COPILOT_SYSTEM_PROMPT,
  copilotApiKey,
} from "@/lib/copilot/config";
import {
  COPILOT_TOOLS_BY_NAME,
  defaultToolContext,
  toolsForUser,
  type CopilotToolContext,
} from "@/lib/copilot/tools";
import { AppError } from "@/lib/errors";
import { writeAuditLog } from "./audit-service";

/**
 * The copilot answers questions about this canteen's own data.
 *
 * The model chooses which read-only tool to call; the server executes it against the real
 * database with the asking user's permissions and hands back the rows. Every figure in an
 * answer therefore came from a query someone could have run themselves — the model decides
 * what to look up and how to say it, never what the number is.
 */

export type CopilotMessage = {
  role: "user" | "assistant";
  content: string;
};

export type CopilotSource = {
  toolName: string;
  label: string;
  href?: string;
};

export type CopilotAnswer = {
  text: string;
  sources: CopilotSource[];
  /** Tool calls that ran; useful for the audit trail and for debugging a poor answer. */
  toolCalls: number;
  /** True when the model declined to answer rather than producing text. */
  refused: boolean;
};

/**
 * The one call this service makes to the model. Injected so the loop can be tested without
 * a network or an API key — the interesting logic is the loop, not the transport.
 */
export type CopilotClient = {
  createMessage: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
};

function liveClient(): CopilotClient {
  const apiKey = copilotApiKey();
  if (!apiKey) {
    throw new AppError(
      "VALIDATION",
      "ผู้ช่วยยังไม่ได้ตั้งค่า (ไม่มี ANTHROPIC_API_KEY) — ใช้งานส่วนอื่นของระบบได้ตามปกติ",
    );
  }

  const anthropic = new Anthropic({ apiKey });
  return { createMessage: (params) => anthropic.messages.create(params) };
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Runs one question to completion.
 *
 * The loop is deliberately bounded: a model that keeps asking for tools without settling on
 * an answer stops after `COPILOT_MAX_ITERATIONS` and says so, rather than looping until
 * something else times out.
 */
export async function askCopilot(
  input: { messages: CopilotMessage[] },
  deps: { client?: CopilotClient; context?: CopilotToolContext } = {},
): Promise<CopilotAnswer> {
  const user = await requireUser();

  const question = input.messages.at(-1);
  if (!question || question.role !== "user" || !question.content.trim()) {
    throw new AppError("VALIDATION", "กรุณาพิมพ์คำถาม");
  }

  const client = deps.client ?? liveClient();
  const context = deps.context ?? defaultToolContext(user);
  const available = toolsForUser(user);

  if (available.length === 0) {
    throw new AppError("FORBIDDEN", "บัญชีนี้ยังไม่มีสิทธิ์ดูข้อมูลที่ผู้ช่วยเรียกได้");
  }

  const tools: Anthropic.Tool[] = available.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  }));

  const messages: Anthropic.MessageParam[] = input.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  const sources: CopilotSource[] = [];
  let toolCalls = 0;

  for (let iteration = 0; iteration < COPILOT_MAX_ITERATIONS; iteration += 1) {
    const response = await client.createMessage({
      model: COPILOT_MODEL,
      max_tokens: COPILOT_MAX_TOKENS,
      output_config: { effort: COPILOT_EFFORT },
      system: COPILOT_SYSTEM_PROMPT,
      tools,
      messages,
    });

    // A refusal comes back as a normal response with empty or partial content.
    if (response.stop_reason === "refusal") {
      return {
        text: "ผู้ช่วยไม่สามารถตอบคำถามนี้ได้ กรุณาถามใหม่ในรูปแบบอื่น",
        sources,
        toolCalls,
        refused: true,
      };
    }

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (toolUses.length === 0) {
      const text = textOf(response);
      await recordQuery(user, question.content, sources, toolCalls);
      return {
        text: text || "ยังไม่มีข้อมูลพอจะตอบคำถามนี้",
        sources,
        toolCalls,
        refused: false,
      };
    }

    messages.push({ role: "assistant", content: response.content });

    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUses) {
      toolCalls += 1;
      const tool = COPILOT_TOOLS_BY_NAME.get(toolUse.name);

      // A tool the user is not cleared for is reported back as an error the model can
      // explain, rather than throwing — the rest of the answer may still be useful.
      if (!tool || !user.permissions.includes(tool.permission)) {
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: "ไม่มีสิทธิ์เข้าถึงข้อมูลส่วนนี้",
          is_error: true,
        });
        continue;
      }

      const parsed = tool.schema.safeParse(toolUse.input ?? {});
      if (!parsed.success) {
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: `พารามิเตอร์ไม่ถูกต้อง: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`,
          is_error: true,
        });
        continue;
      }

      try {
        const result = await tool.run(parsed.data as never, context);
        if (!sources.some((source) => source.toolName === tool.name)) {
          sources.push({ toolName: tool.name, label: result.sourceLabel, href: result.href });
        }
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result.data),
        });
      } catch (error) {
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: error instanceof AppError ? error.message : "อ่านข้อมูลไม่สำเร็จ",
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: results });
  }

  await recordQuery(user, question.content, sources, toolCalls);
  return {
    text: "ผู้ช่วยค้นข้อมูลหลายรอบแล้วแต่ยังสรุปไม่ได้ กรุณาถามให้เจาะจงขึ้น",
    sources,
    toolCalls,
    refused: false,
  };
}

/**
 * Records that a question was asked and which data it touched — not the answer text. The
 * point of the log is "who looked at what", which is the part that matters if a figure
 * leaves the building; storing the generated prose would add bulk without adding evidence.
 */
async function recordQuery(
  user: Awaited<ReturnType<typeof requireUser>>,
  question: string,
  sources: CopilotSource[],
  toolCalls: number,
): Promise<void> {
  await writeAuditLog(db, {
    organizationId: user.organizationId,
    userId: user.id,
    action: "VIEW",
    entityType: "copilot_query",
    entityId: user.id,
    afterData: {
      question: question.slice(0, 500),
      tools: sources.map((source) => source.toolName),
      toolCalls,
    },
  });
}
