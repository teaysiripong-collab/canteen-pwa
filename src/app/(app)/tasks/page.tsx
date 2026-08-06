import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader, Card, Section, Stat, btnPrimary } from "@/components/ui";
import { TASK_PRIORITY, fmtDateTime, ymd, SHIFT_LABEL } from "@/lib/format";
import { createTask, setTaskStatus, cancelTask } from "./actions";
import TaskBoard, { type BoardTask } from "@/components/TaskBoard";
import type { TaskStatus } from "@prisma/client";

export const metadata = { title: "งานที่มอบหมาย" };
export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "today", label: "วันนี้" },
  { key: "tomorrow", label: "พรุ่งนี้" },
  { key: "week", label: "สัปดาห์นี้" },
  { key: "overdue", label: "🔴 เกินกำหนด" },
  { key: "mine", label: "งานของฉัน" },
  { key: "all", label: "ทั้งหมด" },
];

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await requireSession();
  const canEdit = can(session.role, "tasks", "edit");
  const view = (await searchParams).view ?? "week";

  const now = new Date();
  const today = new Date(now); today.setUTCHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const weekEnd = new Date(today); weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const all = await db.task.findMany({
    where: { status: { not: "CANCELLED" } },
    include: { assignee: true, createdBy: true, location: true },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
  });

  const isOverdue = (t: (typeof all)[number]) => t.status !== "COMPLETED" && !!t.dueAt && t.dueAt < now;

  let tasks = all;
  if (view === "today") tasks = all.filter((t) => t.date && ymd(t.date) === ymd(today));
  else if (view === "tomorrow") tasks = all.filter((t) => t.date && ymd(t.date) === ymd(tomorrow));
  else if (view === "week") tasks = all.filter((t) => !t.date || (t.date >= today && t.date <= weekEnd) || isOverdue(t));
  else if (view === "overdue") tasks = all.filter(isOverdue);
  else if (view === "mine") tasks = all.filter((t) => t.assigneeId === session.userId);

  const boardTasks: BoardTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priorityLabel: TASK_PRIORITY[t.priority].label,
    priorityCls: TASK_PRIORITY[t.priority].cls,
    assigneeName: t.assignee?.name ?? "ยังไม่มอบหมาย",
    dueText: t.dueAt ? fmtDateTime(t.dueAt) : null,
    overdue: isOverdue(t),
    locationName: t.location?.name ?? null,
  }));

  // สรุปให้ Manager: ใครมีงานกี่งาน / ค้าง / เลยกำหนด
  const byUser = new Map<string, { name: string; total: number; done: number; overdue: number }>();
  for (const t of all) {
    const key = t.assignee?.name ?? "ยังไม่มอบหมาย";
    const r = byUser.get(key) ?? { name: key, total: 0, done: 0, overdue: 0 };
    r.total++;
    if (t.status === "COMPLETED") r.done++;
    if (isOverdue(t)) r.overdue++;
    byUser.set(key, r);
  }

  const [users, locations] = await Promise.all([
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.location.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
  ]);

  async function move(taskId: string, status: TaskStatus) {
    "use server";
    await setTaskStatus(taskId, status);
  }

  const overdueCount = all.filter(isOverdue).length;

  return (
    <>
      <PageHeader title="งานที่มอบหมาย" subtitle="ลดปัญหา “สั่งแล้วลืม” — ลากการ์ดเพื่อเปลี่ยนสถานะ" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="งานทั้งหมด (ยังไม่ยกเลิก)" value={all.length} />
        <Stat label="เสร็จแล้ว" value={all.filter((t) => t.status === "COMPLETED").length} tone="green" />
        <Stat label="ค้างอยู่" value={all.filter((t) => t.status !== "COMPLETED").length} tone="amber" />
        <Stat label="เกินกำหนด" value={overdueCount} tone={overdueCount > 0 ? "red" : "green"} href="/tasks?view=overdue" />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {VIEWS.map((v) => (
          <Link key={v.key} href={`/tasks?view=${v.key}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium border ${view === v.key ? "bg-[#1e3a5f] text-white border-[#1e3a5f]" : "bg-white border-gray-300 text-gray-600 hover:border-gray-400"}`}>
            {v.label}
          </Link>
        ))}
      </div>

      <div className="mb-5">
        <TaskBoard tasks={boardTasks} canEdit={canEdit} onMove={move} />
      </div>

      {canEdit && (
        <Section title="+ สั่งงานใหม่">
          <form action={createTask} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm sm:col-span-2 lg:col-span-3">
              <span className="block text-xs text-gray-500 mb-1">ชื่องาน *</span>
              <input name="title" required placeholder="เช่น ตรวจนับ Stock Freezer 2"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm sm:col-span-2 lg:col-span-3">
              <span className="block text-xs text-gray-500 mb-1">รายละเอียด</span>
              <textarea name="description" rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">ผู้รับผิดชอบ</span>
              <select name="assigneeId" defaultValue="" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
                <option value="">— ยังไม่ระบุ —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">วันที่</span>
              <input name="date" type="date" defaultValue={ymd(today)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">กำหนดเสร็จ</span>
              <input name="dueAt" type="datetime-local" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">กะ</span>
              <select name="shift" defaultValue="" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
                <option value="">— ไม่ระบุ —</option>
                <option value="MORNING">{SHIFT_LABEL.MORNING}</option>
                <option value="NIGHT">{SHIFT_LABEL.NIGHT}</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">สถานที่</span>
              <select name="locationId" defaultValue="" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
                <option value="">— ไม่ระบุ —</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">ความสำคัญ</span>
              <select name="priority" defaultValue="NORMAL" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
                {Object.entries(TASK_PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
            <div className="sm:col-span-2 lg:col-span-3">
              <button className={btnPrimary}>+ สั่งงาน (แจ้งเตือนผู้รับผิดชอบอัตโนมัติ)</button>
            </div>
          </form>
        </Section>
      )}

      <div className="mt-4">
        <Section title="👥 ภาระงานรายคน">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2">ผู้รับผิดชอบ</th>
                <th className="py-2 text-right">ทั้งหมด</th>
                <th className="py-2 text-right">เสร็จ</th>
                <th className="py-2 text-right">ค้าง</th>
                <th className="py-2 text-right">เกินกำหนด</th>
              </tr>
            </thead>
            <tbody>
              {[...byUser.values()].sort((a, b) => b.total - a.total).map((r) => (
                <tr key={r.name} className="border-b border-gray-100 last:border-0">
                  <td className="py-2.5 font-medium">{r.name}</td>
                  <td className="py-2.5 text-right">{r.total}</td>
                  <td className="py-2.5 text-right text-green-700">{r.done}</td>
                  <td className="py-2.5 text-right text-amber-700">{r.total - r.done}</td>
                  <td className={`py-2.5 text-right font-medium ${r.overdue > 0 ? "text-red-700" : "text-gray-400"}`}>{r.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>

      {canEdit && tasks.length > 0 && (
        <details className="mt-4">
          <summary className="text-sm text-gray-500 cursor-pointer">ยกเลิกงาน…</summary>
          <Card className="p-4 mt-2 flex flex-wrap gap-2">
            {tasks.filter((t) => t.status !== "COMPLETED").map((t) => (
              <form key={t.id} action={cancelTask.bind(null, t.id)}>
                <button className="text-xs rounded-lg border border-red-300 text-red-600 px-3 py-1.5 hover:bg-red-50" style={{ minHeight: "auto" }}>
                  ✕ {t.title}
                </button>
              </form>
            ))}
          </Card>
        </details>
      )}
    </>
  );
}
