import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { fmtDate, fmtDateShort, mondayOf, ymd } from "@/lib/format";
import { getConfig, workingDatesOf } from "@/lib/config";
import PrintButton from "@/components/PrintButton";
import { btnSecondary } from "@/components/ui";
import type { Shift } from "@prisma/client";

export const metadata = { title: "พิมพ์แผนเมนู" };
export const dynamic = "force-dynamic";

export default async function MenuPlanPrintPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  await requireSession();
  const params = await searchParams;
  const weekStart = mondayOf(params.week ? new Date(params.week + "T00:00:00Z") : new Date());
  const cfg = await getConfig();
  const days = workingDatesOf(weekStart, cfg.workingDays);

  const plan = await db.menuPlan.findFirst({
    where: { weekStart },
    orderBy: { version: "desc" },
    include: { entries: { include: { menu: true }, orderBy: { sortOrder: "asc" } }, approvedBy: true },
  });

  return (
    <div className="max-w-3xl mx-auto">
      <div className="no-print flex justify-between items-center mb-4">
        <Link href={`/menu-plan?week=${ymd(weekStart)}`} className={btnSecondary}>← กลับ</Link>
        <PrintButton label="🖨️ พิมพ์ / บันทึก PDF" />
      </div>

      <div className="print-area bg-white border border-gray-200 rounded-xl p-8">
        <div className="text-center mb-6">
          <div className="text-sm font-semibold">{cfg.org.name}{cfg.org.branch ? ` — ${cfg.org.branch}` : ""}</div>
          {(cfg.org.address || cfg.org.phone) && (
            <div className="text-xs text-gray-500">
              {cfg.org.address}{cfg.org.address && cfg.org.phone ? " · " : ""}{cfg.org.phone && `โทร ${cfg.org.phone}`}
            </div>
          )}
          <h1 className="text-xl font-bold mt-2">ใบเมนูประจำสัปดาห์</h1>
          <p className="text-sm text-gray-600 mt-1">
            {fmtDate(days[0])} – {fmtDate(days[days.length - 1])}
            {plan?.status === "APPROVED" && plan.approvedBy && ` · อนุมัติโดย ${plan.approvedBy.name}`}
          </p>
          {plan?.status !== "APPROVED" && (
            <p className="text-sm font-semibold mt-1">*** ฉบับร่าง — ยังไม่ได้รับอนุมัติ ***</p>
          )}
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-gray-400 px-3 py-2 text-left w-32">วัน</th>
              {(["MORNING", "NIGHT"] as Shift[]).map((s) => (
                <th key={s} className="border border-gray-400 px-3 py-2 text-left">{cfg.shifts[s].label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={ymd(day)}>
                <td className="border border-gray-400 px-3 py-2 font-medium align-top">{fmtDateShort(day)}</td>
                {(["MORNING", "NIGHT"] as Shift[]).map((shift) => {
                  const entries = plan?.entries.filter((e) => ymd(e.date) === ymd(day) && e.shift === shift) ?? [];
                  return (
                    <td key={shift} className="border border-gray-400 px-3 py-2 align-top">
                      {entries.length === 0 ? "—" : (
                        <ul className="list-disc pl-4 space-y-0.5">
                          {entries.map((e) => <li key={e.id}>{e.menu.name}</li>)}
                        </ul>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
          <div className="text-center">
            <div className="border-t border-gray-400 pt-2 mx-8">ผู้จัดทำ (Supervisor)</div>
          </div>
          <div className="text-center">
            <div className="border-t border-gray-400 pt-2 mx-8">ผู้อนุมัติ (Manager)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
