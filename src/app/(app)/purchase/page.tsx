import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { PageHeader, Card, Badge, EmptyState, btnPrimary } from "@/components/ui";
import { PO_STATUS, fmtDate, fmtNum } from "@/lib/format";
import type { PoStatus } from "@prisma/client";

export const metadata = { title: "จัดซื้อ" };
export const dynamic = "force-dynamic";

const FILTERS: { key: string; label: string; statuses: PoStatus[] }[] = [
  { key: "", label: "ทั้งหมด", statuses: [] },
  { key: "DRAFT", label: "Draft", statuses: ["DRAFT"] },
  { key: "REVIEWED", label: "รอตรวจสอบ/อนุมัติ", statuses: ["REVIEWED", "APPROVED"] },
  { key: "ORDERED", label: "สั่งแล้ว", statuses: ["ORDERED"] },
  { key: "PARTIAL", label: "ส่งไม่ครบ", statuses: ["PARTIAL"] },
  { key: "RECEIVED", label: "รับแล้ว/เสร็จ", statuses: ["RECEIVED", "COMPLETED"] },
];

export default async function PurchasePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireSession();
  const { status } = await searchParams;
  const filter = FILTERS.find((f) => f.key === (status ?? "")) ?? FILTERS[0];

  const pos = await db.purchaseOrder.findMany({
    where: filter.statuses.length ? { status: { in: filter.statuses } } : {},
    include: { vendor: true, items: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <PageHeader
        title="จัดซื้อ (Purchase)"
        subtitle="สร้างรายการสั่งซื้อจาก BOM · Group ตาม Vendor อัตโนมัติ · ตรวจของตกหล่นก่อนสั่ง"
        actions={<Link href="/purchase/plan" className={btnPrimary}>+ วางแผนสั่งซื้อจาก BOM</Link>}
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <Link key={f.key} href={f.key ? `/purchase?status=${f.key}` : "/purchase"}
            className={`rounded-full px-4 py-1.5 text-sm font-medium border ${filter.key === f.key ? "bg-[#1e3a5f] text-white border-[#1e3a5f]" : "bg-white border-gray-300 text-gray-600 hover:border-gray-400"}`}>
            {f.label}
          </Link>
        ))}
      </div>

      {pos.length === 0 ? (
        <Card className="p-4"><EmptyState text="ไม่มีใบสั่งซื้อในสถานะนี้" /></Card>
      ) : (
        <div className="grid gap-3">
          {pos.map((po) => {
            const st = PO_STATUS[po.status];
            const outstanding = po.items.reduce((s, i) => s + Math.max(0, Number(i.orderQty) - Number(i.receivedQty)), 0);
            return (
              <Link key={po.id} href={`/purchase/${po.id}`}>
                <Card className="p-4 hover:shadow-md transition-shadow flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-48">
                    <div className="font-semibold text-[#1e3a5f]">{po.code} · {po.vendor.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      สำหรับ {fmtDate(po.periodStart)} – {fmtDate(po.periodEnd)} · {po.items.length} รายการ
                    </div>
                  </div>
                  {po.status === "PARTIAL" && outstanding > 0 && (
                    <span className="text-xs text-red-700 font-medium">🔴 ค้างรับ {fmtNum(outstanding)} หน่วยรวม</span>
                  )}
                  <Badge label={st.label} cls={st.cls} />
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
