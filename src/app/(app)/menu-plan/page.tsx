import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader, Card, Badge, btnPrimary, btnSecondary } from "@/components/ui";
import { fmtDateShort, mondayOf, ymd, PLAN_STATUS } from "@/lib/format";
import { getConfig, workingDatesOf } from "@/lib/config";
import { createPlan, addEntry, removeEntry, copyLastWeek, submitPlan, approvePlan, reopenPlan } from "./actions";
import type { Shift } from "@prisma/client";

export const metadata = { title: "แผนเมนู" };
export const dynamic = "force-dynamic";

export default async function MenuPlanPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const session = await requireSession();
  const editable = can(session.role, "menu-plan", "edit");
  const approvable = can(session.role, "menu-plan", "approve");

  const params = await searchParams;
  const base = params.week ? new Date(params.week + "T00:00:00Z") : new Date();
  const weekStart = mondayOf(base);
  const cfg = await getConfig();
  const days = workingDatesOf(weekStart, cfg.workingDays);
  const prevWeek = new Date(weekStart); prevWeek.setUTCDate(prevWeek.getUTCDate() - 7);
  const nextWeek = new Date(weekStart); nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);

  const plan = await db.menuPlan.findFirst({
    where: { weekStart },
    orderBy: { version: "desc" },
    include: { entries: { include: { menu: true }, orderBy: { sortOrder: "asc" } }, approvedBy: true, createdBy: true },
  });
  const menus = await db.menu.findMany({
    where: { active: true },
    orderBy: [{ favorite: "desc" }, { name: "asc" }],
  });

  const locked = !plan || plan.status === "APPROVED" || !editable;
  const st = plan ? PLAN_STATUS[plan.status] : null;

  return (
    <>
      <PageHeader
        title="แผนเมนูรายสัปดาห์"
        subtitle={`สัปดาห์ ${fmtDateShort(days[0])} – ${fmtDateShort(days[days.length - 1])} (${cfg.workingDays.length} วันทำการ)`}
        actions={
          <>
            <Link href={`/menu-plan?week=${ymd(prevWeek)}`} className={btnSecondary}>← สัปดาห์ก่อน</Link>
            <Link href={`/menu-plan?week=${ymd(nextWeek)}`} className={btnSecondary}>สัปดาห์ถัดไป →</Link>
            {plan && <Link href={`/menu-plan/print?week=${ymd(weekStart)}`} className={btnSecondary}>🖨️ Print / PDF</Link>}
          </>
        }
      />

      {/* Workflow bar */}
      <Card className="p-4 mb-4 flex flex-wrap items-center gap-3">
        {plan ? (
          <>
            <span className="text-sm text-gray-500">สถานะแผน:</span>
            {st && <Badge label={st.label} cls={st.cls} />}
            <span className="text-xs text-gray-400">v{plan.version} · สร้างโดย {plan.createdBy.name}</span>
            {plan.status === "APPROVED" && plan.approvedBy && (
              <span className="text-xs text-green-700">🟢 อนุมัติโดย {plan.approvedBy.name}</span>
            )}
            <span className="flex-1" />
            {editable && plan.status === "DRAFT" && plan.entries.length === 0 && (
              <form action={copyLastWeek.bind(null, plan.id, ymd(weekStart))}>
                <button className={btnSecondary}>📋 คัดลอกจากสัปดาห์ก่อน</button>
              </form>
            )}
            {editable && plan.status === "DRAFT" && plan.entries.length > 0 && (
              <form action={submitPlan.bind(null, plan.id)}>
                <button className={btnPrimary}>ส่งตรวจสอบ →</button>
              </form>
            )}
            {approvable && plan.status === "SUBMITTED" && (
              <form action={approvePlan.bind(null, plan.id)}>
                <button className={btnPrimary}>✓ อนุมัติแผน</button>
              </form>
            )}
            {approvable && plan.status !== "DRAFT" && (
              <form action={reopenPlan.bind(null, plan.id)}>
                <button className={btnSecondary}>ปลดล็อกแก้ไข</button>
              </form>
            )}
          </>
        ) : editable ? (
          <form action={createPlan.bind(null, ymd(weekStart))} className="flex items-center gap-3">
            <span className="text-sm text-gray-500">ยังไม่มีแผนเมนูสัปดาห์นี้</span>
            <button className={btnPrimary}>+ สร้างแผนเมนู</button>
          </form>
        ) : (
          <span className="text-sm text-gray-500">ยังไม่มีแผนเมนูสัปดาห์นี้</span>
        )}
      </Card>

      {/* Weekly grid */}
      <div className="grid gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {days.map((day) => (
          <Card key={ymd(day)} className={`p-3 ${ymd(day) === ymd(new Date()) ? "ring-2 ring-amber-400" : ""}`}>
            <div className="font-semibold text-sm mb-2 text-[#1e3a5f]">{fmtDateShort(day)}</div>
            {(["MORNING", "NIGHT"] as Shift[]).map((shift) => {
              const entries = plan?.entries.filter((e) => ymd(e.date) === ymd(day) && e.shift === shift) ?? [];
              return (
                <div key={shift} className="mb-3">
                  <div className={`text-xs font-medium mb-1 ${shift === "MORNING" ? "text-amber-600" : "text-indigo-600"}`}>
                    {shift === "MORNING" ? "☀️" : "🌙"} {cfg.shifts[shift].label}
                  </div>
                  <ul className="space-y-1">
                    {entries.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-1 bg-gray-50 rounded-lg px-2 py-1.5 text-sm">
                        <Link href={`/bom?entry=${e.id}`} className="hover:text-sky-700 truncate" title="ดู/แก้ BOM">
                          {e.menu.favorite ? "⭐ " : ""}{e.menu.name}
                        </Link>
                        {!locked && (
                          <form action={removeEntry.bind(null, e.id)}>
                            <button className="text-gray-400 hover:text-red-600 text-xs px-1" style={{ minHeight: "auto" }} title="ลบ">✕</button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                  {!locked && plan && (
                    <AddEntryForm planId={plan.id} date={ymd(day)} shift={shift}
                      menus={menus.map((m) => ({ id: m.id, name: m.name, favorite: m.favorite }))} />
                  )}
                </div>
              );
            })}
          </Card>
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-4">
        💡 เมื่อเพิ่มเมนู ระบบดึง BOM มาตรฐานให้อัตโนมัติ ({cfg.shifts.NIGHT.label}เริ่มต้นที่ {Math.round(cfg.nightFactor * 100)}% ของ{cfg.shifts.MORNING.label}) — แก้ไขปริมาณจริงได้ที่หน้า <Link href="/bom" className="text-sky-700">BOM</Link>
      </p>
    </>
  );
}

function AddEntryForm({ planId, date, shift, menus }: {
  planId: string; date: string; shift: Shift;
  menus: { id: string; name: string; favorite: boolean }[];
}) {
  async function add(formData: FormData) {
    "use server";
    const menuId = String(formData.get("menuId") ?? "");
    if (menuId) await addEntry(planId, date, shift, menuId);
  }
  return (
    <form action={add} className="mt-1 flex gap-1">
      <select name="menuId" required defaultValue=""
        className="flex-1 min-w-0 rounded-lg border border-gray-200 text-xs px-1 py-1.5 bg-white">
        <option value="" disabled>+ เลือกเมนู…</option>
        {menus.map((m) => (
          <option key={m.id} value={m.id}>{m.favorite ? "⭐ " : ""}{m.name}</option>
        ))}
      </select>
      <button className="rounded-lg bg-[#1e3a5f] text-white text-xs px-2" style={{ minHeight: "2rem" }}>เพิ่ม</button>
    </form>
  );
}
