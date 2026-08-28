import { Card, CardContent, KpiCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { AlertList } from "@/features/alerts/alert-list";
import { requirePageUser } from "@/lib/auth/page-guard";
import { getAlerts, type AlertSeverity } from "@/services/alert-service";

export const dynamic = "force-dynamic";

const SECTIONS: Array<{ severity: AlertSeverity; titleTh: string; descriptionTh: string }> = [
  {
    severity: "critical",
    titleTh: "ต้องแก้วันนี้",
    descriptionTh: "ปล่อยไว้แล้วเสียของหรือเสียเงิน",
  },
  {
    severity: "warning",
    titleTh: "ควรจัดการ",
    descriptionTh: "ยังไม่เสียหาย แต่จะกลายเป็นปัญหาถ้าไม่ทำ",
  },
  {
    severity: "info",
    titleTh: "รอดำเนินการ",
    descriptionTh: "งานปกติที่ค้างอยู่ในระบบ",
  },
];

export default async function AlertsPage() {
  await requirePageUser();
  const report = await getAlerts();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="เรื่องที่ต้องดูแล"
        description="คำนวณสดจากข้อมูลจริงทุกครั้งที่เปิดหน้า ไม่มีปุ่มปิดแจ้งเตือน — วิธีเดียวที่จะทำให้หายไปคือแก้ที่ต้นเหตุ"
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="ต้องแก้วันนี้"
          value={report.counts.critical}
          unit="เรื่อง"
          tone={report.counts.critical > 0 ? "critical" : "neutral"}
        />
        <KpiCard
          label="ควรจัดการ"
          value={report.counts.warning}
          unit="เรื่อง"
          tone={report.counts.warning > 0 ? "warning" : "neutral"}
        />
        <KpiCard label="รอดำเนินการ" value={report.counts.info} unit="เรื่อง" />
      </div>

      {report.alerts.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title="ไม่มีเรื่องค้างอยู่"
              description="ของไม่หมดอายุค้าง ใบสั่งซื้อไม่เลยกำหนด แผนเมนูยืนยันครบ และเบิกของครบตามแผนแล้ว"
            />
          </CardContent>
        </Card>
      ) : (
        SECTIONS.map((section) => {
          const alerts = report.alerts.filter((alert) => alert.severity === section.severity);
          if (alerts.length === 0) return null;

          return (
            <section key={section.severity} className="flex flex-col gap-2">
              <div>
                <h2 className="text-base font-semibold text-ink">{section.titleTh}</h2>
                <p className="text-sm text-ink-muted">{section.descriptionTh}</p>
              </div>
              <AlertList alerts={alerts} />
            </section>
          );
        })
      )}

      <p className="text-xs text-ink-subtle">
        รายการนี้แสดงเฉพาะเรื่องที่บัญชีของคุณมีสิทธิ์เข้าไปจัดการได้ —
        เรื่องที่คุณแก้ไม่ได้จะไม่ถูกนำมาแสดงให้กังวลเปล่าๆ
      </p>
    </div>
  );
}
