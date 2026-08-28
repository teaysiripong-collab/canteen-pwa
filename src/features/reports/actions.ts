"use server";

import { revalidatePath } from "next/cache";
import { actionSuccess, toActionError, type ActionResult } from "@/lib/errors";
import type { ReportKey } from "@/services/report-service";
import { syncReportToSheet, type SyncResult } from "@/services/sheet-sync-service";

export async function syncReportToSheetAction(
  key: ReportKey,
  input: { fromDate: string; toDate: string; locationId?: string },
): Promise<ActionResult<SyncResult>> {
  try {
    const result = await syncReportToSheet(key, input);
    // The run list on this page is now one row out of date.
    revalidatePath("/reports");
    return actionSuccess(result);
  } catch (error) {
    return toActionError(error);
  }
}
