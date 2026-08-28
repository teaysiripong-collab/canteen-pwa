import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { CostFilters } from "@/features/cost/cost-filters";
import { SheetSyncButton } from "@/features/reports/sheet-sync-button";
import { SyncRunList } from "@/features/reports/sync-run-list";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { addDays, todayIso } from "@/lib/date";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { listStockLocations } from "@/repositories/inventory-repository";
import { previewReport, reportsForUser } from "@/services/report-service";
import { listSyncRuns, sheetsConfigured } from "@/services/sheet-sync-service";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePagePermission(PERMISSIONS.REPORT_VIEW);
  const params = await searchParams;

  const today = todayIso();
  const toDate = typeof params.to === "string" && params.to ? params.to : today;
  const fromDate =
    typeof params.from === "string" && params.from ? params.from : addDays(toDate, -29);
  const locationId =
    typeof params.location === "string" && params.location ? params.location : undefined;

  const canExport = hasPermission(user.permissions, PERMISSIONS.REPORT_EXPORT);
  const reports = reportsForUser(user.permissions);
  const locations = await listStockLocations(user.organizationId);
  const sheetsReady = sheetsConfigured();
  const syncRuns = canExport ? await listSyncRuns(user.organizationId) : [];

  const previews = await Promise.all(
    reports.map((report) =>
      previewReport(report.key, { fromDate, toDate, locationId }).catch(() => null),
    ),
  );

  const query = new URLSearchParams({ from: fromDate, to: toDate });
  if (locationId) query.set("location", locationId);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="รายงาน"
        description="ดูจำนวนแถวก่อนดาวน์โหลด ไฟล์เป็น CSV แบบ UTF-8 เปิดใน Excel ภาษาไทยได้ทันที"
      />

      <CostFilters
        dates={[
          { name: "from", label: "ตั้งแต่วันที่", value: fromDate },
          { name: "to", label: "ถึงวันที่", value: toDate },
        ]}
        selects={[
          {
            name: "location",
            label: "สถานที่",
            options: [
              { value: "", label: "ทุกสถานที่" },
              ...locations.map((location) => ({
                value: location.id,
                label: `${location.code} · ${location.nameTh}`,
              })),
            ],
          },
        ]}
      />

      {reports.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title="บัญชีนี้ยังไม่มีสิทธิ์ดูรายงานใด" />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {reports.map((report, index) => {
            const preview = previews[index];

            return (
              <Card key={report.key}>
                <CardHeader>
                  <CardTitle>{report.titleTh}</CardTitle>
                  <CardDescription>{report.descriptionTh}</CardDescription>
                </CardHeader>
                <CardContent className="flex items-end justify-between gap-3 pt-3">
                  <div className="min-w-0 text-sm text-ink-muted">
                    <p>
                      {preview ? (
                        <>
                          <strong className="text-ink">{preview.rowCount}</strong> แถว
                          {report.ranged ? " ในช่วงที่เลือก" : " ณ ตอนนี้"}
                        </>
                      ) : (
                        "อ่านข้อมูลไม่สำเร็จ"
                      )}
                    </p>
                    {preview?.sampleTh ? (
                      <p className="mt-0.5 truncate text-xs text-ink-subtle">
                        ตัวอย่าง: {preview.sampleTh}
                      </p>
                    ) : null}
                  </div>

                  {canExport ? (
                    <div className="flex shrink-0 items-start gap-2">
                      <Button
                        asChild
                        variant="secondary"
                        size="sm"
                        disabled={preview?.rowCount === 0}
                      >
                        <a href={`/api/reports/${report.key}?${query.toString()}`} download>
                          <Download className="h-4 w-4" aria-hidden />
                          CSV
                        </a>
                      </Button>
                      {sheetsReady ? (
                        <SheetSyncButton
                          reportKey={report.key}
                          fromDate={fromDate}
                          toDate={toDate}
                          locationId={locationId}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!canExport ? (
        <p className="text-sm text-ink-muted">
          บัญชีนี้ดูรายงานได้แต่ยังไม่มีสิทธิ์ส่งออกไฟล์ — การนำข้อมูลออกนอกระบบเป็นสิทธิ์แยกต่างหาก
        </p>
      ) : sheetsReady ? (
        <SyncRunList runs={syncRuns} />
      ) : (
        <p className="text-sm text-ink-muted">
          ยังไม่ได้ตั้งค่า Google Sheets — ตั้งค่า <code>GOOGLE_SERVICE_ACCOUNT_EMAIL</code>,{" "}
          <code>GOOGLE_PRIVATE_KEY</code> และ <code>GOOGLE_SHEET_ID</code> แล้วแชร์สเปรดชีตให้
          service account มีสิทธิ์แก้ไข ปุ่มส่งจึงจะขึ้น (ดาวน์โหลด CSV ใช้งานได้ตามปกติอยู่แล้ว)
        </p>
      )}

      <p className="text-xs text-ink-subtle">
        ทุกครั้งที่ดาวน์โหลด ระบบจะบันทึกใน Audit Log ว่าใครดึงรายงานอะไร ช่วงไหน และกี่แถว
      </p>
    </div>
  );
}
