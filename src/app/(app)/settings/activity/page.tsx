import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader, Section, EmptyState, btnSecondary } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "ประวัติการใช้งาน" };
export const dynamic = "force-dynamic";

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ user?: string }> }) {
  const session = await requireSession();
  if (!can(session.role, "settings", "admin")) notFound();
  const { user } = await searchParams;

  const [logs, users] = await Promise.all([
    db.auditLog.findMany({
      where: user ? { userId: user } : {},
      include: { user: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.user.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader title="ประวัติการใช้งาน (Activity Log)"
        subtitle="ใครแก้อะไร จากค่าเดิมเป็นค่าใหม่อะไร เมื่อไหร่ — 200 รายการล่าสุด"
        actions={<Link href="/settings" className={btnSecondary}>← ตั้งค่า</Link>} />

      <form method="get" className="flex flex-wrap gap-2 mb-4">
        <select name="user" defaultValue={user ?? ""} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
          <option value="">ทุกคน</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.employeeCode ? `${u.employeeCode} — ` : ""}{u.name}</option>
          ))}
        </select>
        <button className={btnSecondary}>กรอง</button>
        {user && <Link href="/settings/activity" className={btnSecondary}>ล้าง</Link>}
      </form>

      <Section title="🕘 Timeline">
        {logs.length === 0 ? <EmptyState text="ยังไม่มีประวัติ" /> : (
          <ul className="space-y-1">
            {logs.map((l) => (
              <li key={l.id} className="flex flex-wrap gap-x-2 gap-y-0.5 text-sm border-b border-gray-100 last:border-0 py-2">
                <span className="text-gray-400 whitespace-nowrap font-mono text-xs pt-0.5">{fmtDateTime(l.createdAt)}</span>
                <span className="font-medium">{l.user.name}</span>
                <span className="text-gray-600">
                  {l.detail ?? `${l.action} ${l.entity}`}
                  {l.oldValue != null && l.newValue != null && l.field && (
                    <span className="text-gray-500"> ({l.field}: {l.oldValue} → {l.newValue})</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
