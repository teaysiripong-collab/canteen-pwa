import { NextResponse } from "next/server";
import { csvFilename } from "@/lib/csv";
import { AppError, httpStatusFor } from "@/lib/errors";
import { addDays, todayIso } from "@/lib/date";
import { exportReport, REPORTS_BY_KEY, type ReportKey } from "@/services/report-service";

/**
 * The download endpoint.
 *
 * A route rather than a server action because the browser has to receive a file: the
 * permission check still happens server-side inside `exportReport`, so the URL cannot be
 * shared with someone who lacks the right to the data behind it.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  const { key } = await context.params;

  if (!REPORTS_BY_KEY.has(key as ReportKey)) {
    return NextResponse.json({ error: "ไม่พบรายงานที่เลือก" }, { status: 404 });
  }

  const url = new URL(request.url);
  const today = todayIso();
  const toDate = url.searchParams.get("to") || today;
  const fromDate = url.searchParams.get("from") || addDays(toDate, -29);
  const locationId = url.searchParams.get("location") || undefined;

  try {
    const report = await exportReport(key as ReportKey, { fromDate, toDate, locationId });

    return new NextResponse(report.csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${csvFilename(report.filenamePrefix, fromDate, toDate)}"`,
        // An export is a point-in-time snapshot; caching it would hand back stale figures.
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: httpStatusFor(error) });
    }
    return NextResponse.json({ error: "ส่งออกรายงานไม่สำเร็จ" }, { status: 500 });
  }
}
