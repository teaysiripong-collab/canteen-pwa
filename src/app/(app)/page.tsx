import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getStockLevels, getExpiryAlerts } from "@/lib/stock";
import { PageHeader, Stat, Section, Badge, EmptyState } from "@/components/ui";
import { SHIFT_LABEL, fmtNum, fmtBaht, fmtDate, mondayOf, ymd } from "@/lib/format";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireSession();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const weekStart = mondayOf(today);

  const [todayEntries, tasks, pos, stockLevels, expiry, weekBom] = await Promise.all([
    db.menuPlanEntry.findMany({
      where: { date: today, plan: { status: "APPROVED" } },
      include: { menu: true },
      orderBy: [{ shift: "asc" }, { sortOrder: "asc" }],
    }),
    db.task.findMany({ where: { status: { not: "CANCELLED" } } }),
    db.purchaseOrder.findMany({ where: { status: { not: "CANCELLED" } } }),
    getStockLevels(),
    getExpiryAlerts(3),
    db.bomLine.findMany({
      where: { planEntry: { date: { gte: weekStart } } },
      include: { ingredient: true },
    }),
  ]);

  const now = new Date();
  const todayTasks = tasks.filter((t) => t.date && ymd(t.date) === ymd(today));
  const doneTasks = todayTasks.filter((t) => t.status === "COMPLETED").length;
  const overdue = tasks.filter((t) => t.status !== "COMPLETED" && t.dueAt && t.dueAt < now).length;

  const poCount = (s: string[]) => pos.filter((p) => s.includes(p.status)).length;
  const lowStock = stockLevels.filter((s) => s.total > 0 && s.total < s.minStock);
  const outStock = stockLevels.filter((s) => s.total <= 0);
  const negativeStock = stockLevels.filter((s) => s.total < 0);

  // Cost estimate: BOM qty × last price (per stock unit ≈ price/conversion)
  const ingredients = await db.ingredient.findMany();
  const priceMap = new Map(ingredients.map((i) => [i.id, i.lastPrice ? Number(i.lastPrice) / Number(i.conversionFactor) : 0]));
  const todayLines = await db.bomLine.findMany({ where: { planEntry: { date: today } } });
  const costToday = todayLines.reduce((s, l) => s + Number(l.qty) * (priceMap.get(l.ingredientId) ?? 0), 0);
  const costWeek = weekBom.reduce((s, l) => s + Number(l.qty) * (priceMap.get(l.ingredientId) ?? 0), 0);

  const morning = todayEntries.filter((e) => e.shift === "MORNING");
  const night = todayEntries.filter((e) => e.shift === "NIGHT");

  return (
    <>
      <PageHeader
        title="Canteen Command Center"
        subtitle={`วันนี้ ${fmtDate(today)} — เปิดมาแล้วรู้ทันทีว่าต้องทำอะไรต่อ`}
      />

      {/* วันนี้ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="เมนูวันนี้" value={todayEntries.length} sub={`เช้า ${morning.length} · ดึก ${night.length}`} href="/menu-plan" tone="blue" />
        <Stat label="งานวันนี้ (เสร็จ/ทั้งหมด)" value={`${doneTasks}/${todayTasks.length}`} href="/tasks" tone={doneTasks === todayTasks.length && todayTasks.length > 0 ? "green" : "default"} />
        <Stat label="งานค้าง" value={tasks.filter((t) => t.status !== "COMPLETED").length} href="/tasks" tone="amber" />
        <Stat label="งานเกินกำหนด" value={overdue} href="/tasks?view=overdue" tone={overdue > 0 ? "red" : "green"} />
      </div>

      {/* Purchase + Inventory + Cost */}
      <div className="grid md:grid-cols-3 gap-4 mb-4">
        <Section title="🛒 Purchase" action={<Link href="/purchase" className="text-xs text-sky-700 font-medium">ดูทั้งหมด →</Link>}>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Draft" value={poCount(["DRAFT"])} href="/purchase?status=DRAFT" />
            <Stat label="รอตรวจสอบ" value={poCount(["REVIEWED"])} href="/purchase?status=REVIEWED" tone="amber" />
            <Stat label="สั่งแล้ว/รอรับ" value={poCount(["ORDERED", "APPROVED"])} href="/purchase?status=ORDERED" tone="blue" />
            <Stat label="ส่งไม่ครบ" value={poCount(["PARTIAL"])} href="/purchase?status=PARTIAL" tone={poCount(["PARTIAL"]) > 0 ? "red" : "green"} />
          </div>
        </Section>

        <Section title="📦 Inventory Alert" action={<Link href="/stock" className="text-xs text-sky-700 font-medium">ดู Stock →</Link>}>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="ของใกล้หมด" value={lowStock.length} href="/stock?filter=low" tone={lowStock.length > 0 ? "amber" : "green"} />
            <Stat label="ใกล้หมดอายุ (3 วัน)" value={expiry.filter((e) => e.daysLeft >= 0).length} href="/stock/expiry" tone={expiry.length > 0 ? "amber" : "green"} />
            <Stat label="ของหมดแล้ว" value={outStock.filter((s) => s.total === 0).length} href="/stock?filter=out" tone={outStock.length > 0 ? "red" : "green"} />
            <Stat label="Stock ติดลบ (ผิดปกติ)" value={negativeStock.length} href="/stock?filter=out" tone={negativeStock.length > 0 ? "red" : "green"} />
          </div>
        </Section>

        <Section title="💰 Cost (ประมาณจาก BOM × ราคาล่าสุด)" action={<Link href="/cost" className="text-xs text-sky-700 font-medium">ดูต้นทุน →</Link>}>
          <div className="grid grid-cols-1 gap-2">
            <Stat label="Cost วันนี้ (แผน)" value={fmtBaht(costToday)} href="/cost" />
            <Stat label="Cost สัปดาห์นี้ (แผน)" value={fmtBaht(costWeek)} href="/cost" tone="blue" />
          </div>
        </Section>
      </div>

      {/* เมนูวันนี้ */}
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        {([["MORNING", morning], ["NIGHT", night]] as const).map(([shift, entries]) => (
          <Section key={shift} title={`🍚 เมนู${SHIFT_LABEL[shift]}`} action={<Link href="/menu-plan" className="text-xs text-sky-700 font-medium">แผนเมนู →</Link>}>
            {entries.length === 0 ? (
              <EmptyState text="ยังไม่มีเมนูที่อนุมัติสำหรับวันนี้" />
            ) : (
              <ul className="divide-y divide-gray-100">
                {entries.map((e) => (
                  <li key={e.id} className="py-2 flex items-center justify-between">
                    <Link href={`/recipes?menu=${e.menuId}`} className="font-medium hover:text-sky-700">{e.menu.name}</Link>
                    <Badge label="อนุมัติแล้ว" cls="bg-green-100 text-green-800" />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ))}
      </div>

      {/* Alerts รายละเอียด */}
      {(lowStock.length > 0 || expiry.length > 0) && (
        <div className="grid md:grid-cols-2 gap-4">
          {lowStock.length > 0 && (
            <Section title="🟡 ของใกล้หมด — ควรพิจารณาสั่งซื้อ">
              <ul className="divide-y divide-gray-100 text-sm">
                {lowStock.slice(0, 6).map((s) => (
                  <li key={s.ingredientId} className="py-2 flex justify-between">
                    <span>{s.name}</span>
                    <span className="text-amber-700 font-medium">เหลือ {fmtNum(s.total)} {s.unit} (ขั้นต่ำ {fmtNum(s.minStock)})</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {expiry.length > 0 && (
            <Section title="🔴 ใกล้หมดอายุ — ใช้ตามหลัก FEFO">
              <ul className="divide-y divide-gray-100 text-sm">
                {expiry.slice(0, 6).map((e, i) => (
                  <li key={i} className="py-2 flex justify-between">
                    <span>{e.ingredientName} <span className="text-gray-400">({e.lotCode})</span></span>
                    <span className={e.daysLeft < 0 ? "text-red-700 font-semibold" : "text-amber-700 font-medium"}>
                      {e.daysLeft < 0 ? `หมดอายุแล้ว` : `อีก ${e.daysLeft} วัน`} · {fmtNum(e.qty)}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </>
  );
}
