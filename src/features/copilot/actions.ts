"use server";

import { actionSuccess, toActionError, type ActionResult } from "@/lib/errors";
import { askCopilot, type CopilotAnswer, type CopilotMessage } from "@/services/copilot-service";

/** Keeps one conversation from growing without bound across a long session. */
const MAX_HISTORY = 12;

export async function askCopilotAction(
  messages: CopilotMessage[],
): Promise<ActionResult<CopilotAnswer>> {
  try {
    const answer = await askCopilot({ messages: messages.slice(-MAX_HISTORY) });
    return actionSuccess(answer);
  } catch (error) {
    return toActionError(error);
  }
}
