import Link from "next/link";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { PageHeader, Card, EmptyState, btnSecondary } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "การแจ้งเตือน" };
export const dynamic = "force-dynamic";

const TYPE_ICON: Record<string, string> = {
  PO_INCOMPLETE: "🛒", STOCK_LOW: "📦", EXPIRY: "⏰", TASK_NEW: "✅",
  TASK_DUE: "⏳", TASK_DONE: "🟢", TASK_CANCELLED: "✖️",
  MENU_APPROVAL: "📅", BOM_REVIEW: "📋", COST_PENDING: "💰",
};

async function markRead(id: string) {
  "use server";
  const s = await requireSession();
  await db.notification.updateMany({ where: { id, userId: s.userId }, data: { readAt: new Date() } });
  revalidatePath("/notifications");
  revalidatePath("/");
}

async function markAllRead() {
  "use server";
  const s = await requireSession();
  await db.notification.updateMany({ where: { userId: s.userId, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/notifications");
  revalidatePath("/");
}

export default async function NotificationsPage() {
  const session = await requireSession();
  const notifications = await db.notification.findMany({
    where: { userId: session.userId },
    orderBy: [{ readAt: "asc" }, { createdAt: "desc" }],
    take: 50,
  });
  const unread = notifications.filter((n) => !n.readAt);

  return (
    <div className="max-w-2xl">
      <PageHeader title="การแจ้งเตือน" subtitle="แจ้งเฉพาะเรื่องที่ต้องลงมือทำ"
        actions={unread.length > 0 ? (
          <form action={markAllRead}><button className={btnSecondary}>อ่านทั้งหมด</button></form>
        ) : undefined} />

      {notifications.length === 0 ? (
        <Card className="p-4"><EmptyState text="ไม่มีการแจ้งเตือน — ทุกอย่างเรียบร้อย 🟢" /></Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <Card key={n.id} className={`p-4 flex items-start gap-3 ${n.readAt ? "opacity-60" : "border-sky-300"}`}>
              <div className="text-xl">{TYPE_ICON[n.type] ?? "🔵"}</div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{n.title}</div>
                {n.message && <p className="text-sm text-gray-600 mt-0.5">{n.message}</p>}
                <div className="text-xs text-gray-400 mt-1">{fmtDateTime(n.createdAt)}</div>
              </div>
              <div className="flex flex-col gap-1 items-end">
                {n.link && <Link href={n.link} className="text-xs text-sky-700 font-medium whitespace-nowrap">เปิดดู →</Link>}
                {!n.readAt && (
                  <form action={markRead.bind(null, n.id)}>
                    <button className="text-xs text-gray-400 hover:text-gray-600" style={{ minHeight: "auto" }}>อ่านแล้ว</button>
                  </form>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
