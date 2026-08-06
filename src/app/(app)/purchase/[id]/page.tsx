import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader, Card, Section, Badge, btnPrimary, btnSecondary } from "@/components/ui";
import { PO_STATUS, fmtNum, fmtDate, fmtBaht } from "@/lib/format";
import { updatePoItem, setPoStatus, confirmOrderWithOverride, moveItemToVendor, receivePoItems } from "../actions";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

export default async function PoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      vendor: true, createdBy: true,
      items: { include: { ingredient: true, unit: true }, orderBy: { ingredient: { name: "asc" } } },
    },
  });
  if (!po) notFound();

  const editable = can(session.role, "purchase", "edit") && ["DRAFT", "REVIEWED", "APPROVED"].includes(po.status);
  const canApprove = can(session.role, "purchase", "approve");
  const canReceive = can(session.role, "stock", "edit") && ["ORDERED", "PARTIAL"].includes(po.status);
  const vendors = await db.vendor.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const locations = await db.location.findMany({ where: { active: true }, orderBy: { code: "asc" } });
  const st = PO_STATUS[po.status];

  // ── Validation (ไม่ Block — Override ได้พร้อมเหตุผล) ──
  const issues: string[] = [];
  // 1) Coverage: BOM ทั้งช่วงถูกสั่งครบทุกรายการหรือยัง (นับรวมทุก PO ในช่วงเดียวกัน)
  let missingNames: string[] = [];
  if (po.periodStart && po.periodEnd) {
    const bomLines = await db.bomLine.findMany({
      where: { planEntry: { date: { gte: po.periodStart, lte: po.periodEnd } } },
      include: { ingredient: true },
    });
    const bomIngIds = new Set(bomLines.map((l) => l.ingredientId));
    const periodItems = await db.purchaseOrderItem.findMany({
      where: { po: { status: { notIn: ["CANCELLED"] }, periodStart: po.periodStart, periodEnd: po.periodEnd } },
    });
    const orderedIds = new Set(periodItems.filter((i) => Number(i.orderQty) > 0).map((i) => i.ingredientId));
    missingNames = [...new Set(bomLines.filter((l) => !orderedIds.has(l.ingredientId)).map((l) => l.ingredient.name))];
    if (missingNames.length > 0) {
      issues.push(`ยังมี ${missingNames.length} รายการจาก BOM ที่ไม่ได้สั่ง: ${missingNames.join(", ")}`);
    }
    void bomIngIds;
  }
  // 2) Item-level checks
  for (const item of po.items) {
    const oq = Number(item.orderQty), bq = Number(item.bomQty);
    if (oq === 0) issues.push(`${item.ingredient.name}: จำนวนสั่งเป็น 0`);
    else if (bq > 0 && oq < bq - Number(item.stockQty)) issues.push(`${item.ingredient.name}: สั่ง ${fmtNum(oq)} น้อยกว่า BOM หลังหัก Stock (${fmtNum(bq - Number(item.stockQty))})`);
    else if (bq > 0 && oq > bq * 1.5) issues.push(`${item.ingredient.name}: สั่ง ${fmtNum(oq)} มากกว่า BOM (${fmtNum(bq)}) เกิน 50%`);
  }

  const totalAmount = po.items.reduce((s, i) => s + Number(i.orderQty) * Number(i.price ?? 0), 0);
  const outstanding = po.items.filter((i) => Number(i.orderQty) - Number(i.receivedQty) > 0.001);

  return (
    <>
      <PageHeader
        title={`${po.code} — ${po.vendor.name}`}
        subtitle={`สำหรับ ${fmtDate(po.periodStart)} – ${fmtDate(po.periodEnd)} · สร้างโดย ${po.createdBy.name}${po.vendor.phone ? ` · โทร ${po.vendor.phone}` : ""}`}
        actions={
          <>
            <Link href="/purchase" className={btnSecondary}>← กลับ</Link>
            <a href={`/api/export/po/${po.id}`} className={btnSecondary}>⬇ Excel</a>
            <PrintButton label="🖨️ พิมพ์ใบสั่งซื้อ" />
          </>
        }
      />

      <Card className="p-4 mb-4 flex flex-wrap items-center gap-3 no-print">
        <span className="text-sm text-gray-500">สถานะ:</span>
        <Badge label={st.label} cls={st.cls} />
        {po.overrideReason && <span className="text-xs text-amber-700">⚠️ Override: {po.overrideReason}</span>}
        <span className="flex-1" />
        {po.status === "DRAFT" && can(session.role, "purchase", "edit") && (
          <form action={setPoStatus.bind(null, po.id, "REVIEWED", undefined)}>
            <button className={btnPrimary}>ตรวจสอบแล้ว →</button>
          </form>
        )}
        {po.status === "REVIEWED" && canApprove && (
          <form action={setPoStatus.bind(null, po.id, "APPROVED", undefined)}>
            <button className={btnPrimary}>✓ อนุมัติ</button>
          </form>
        )}
        {po.status === "APPROVED" && can(session.role, "purchase", "edit") && issues.length === 0 && (
          <form action={setPoStatus.bind(null, po.id, "ORDERED", undefined)}>
            <button className={btnPrimary}>📞 ยืนยันสั่งซื้อ</button>
          </form>
        )}
        {po.status === "RECEIVED" && canApprove && (
          <form action={setPoStatus.bind(null, po.id, "COMPLETED", undefined)}>
            <button className={btnPrimary}>ปิดงาน (Completed)</button>
          </form>
        )}
      </Card>

      {/* Validation */}
      {issues.length > 0 && ["DRAFT", "REVIEWED", "APPROVED"].includes(po.status) && (
        <Card className="p-4 mb-4 border-red-300 bg-red-50 no-print">
          <div className="font-semibold text-red-800 mb-2">🔴 ตรวจพบ {issues.length} ประเด็นก่อนยืนยันสั่งซื้อ</div>
          <ul className="list-disc pl-5 text-sm text-red-700 space-y-1">
            {issues.map((msg, i) => <li key={i}>{msg}</li>)}
          </ul>
          {po.status === "APPROVED" && can(session.role, "purchase", "edit") && (
            <form action={confirmOrderWithOverride.bind(null, po.id)} className="mt-3 flex flex-wrap gap-2">
              <input name="reason" required placeholder="เหตุผลในการสั่งทั้งที่มีประเด็น (บังคับ)"
                className="flex-1 min-w-60 rounded-lg border border-red-300 px-3 py-2 text-sm bg-white" />
              <button className="btn rounded-lg bg-red-600 text-white px-4 py-2 text-sm font-semibold hover:bg-red-700">
                Override และยืนยันสั่งซื้อ
              </button>
            </form>
          )}
        </Card>
      )}

      {/* Items table */}
      <Card className="overflow-x-auto mb-4 print-area">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
              <th className="py-2.5 px-3">รายการ</th>
              <th className="py-2.5 px-2 text-right">BOM ต้องใช้</th>
              <th className="py-2.5 px-2 text-right">Stock*</th>
              <th className="py-2.5 px-2 text-right">แนะนำ</th>
              <th className="py-2.5 px-2 text-right font-semibold">สั่งจริง</th>
              <th className="py-2.5 px-2">หน่วย</th>
              <th className="py-2.5 px-2 text-right">ราคา/หน่วย</th>
              <th className="py-2.5 px-2 text-right">รับแล้ว</th>
              <th className="py-2.5 px-2 text-right">ค้างรับ</th>
              {editable && <th className="py-2.5 px-2 no-print">Vendor</th>}
            </tr>
          </thead>
          <tbody>
            {po.items.map((item) => {
              const out = Number(item.orderQty) - Number(item.receivedQty);
              return (
                <tr key={item.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 px-3 font-medium">{item.ingredient.name}</td>
                  <td className="py-2 px-2 text-right">{fmtNum(Number(item.bomQty))}</td>
                  <td className="py-2 px-2 text-right text-gray-400">{fmtNum(Number(item.stockQty))}</td>
                  <td className="py-2 px-2 text-right text-gray-500">{fmtNum(Number(item.suggestedQty))}</td>
                  <td className="py-2 px-2 text-right">
                    {editable ? (
                      <form action={updatePoItem.bind(null, item.id)} className="flex gap-1 justify-end items-center">
                        <input name="orderQty" type="number" step="0.01" min="0" defaultValue={Number(item.orderQty)}
                          className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-right text-sm" />
                        <input name="price" type="number" step="0.01" min="0" defaultValue={item.price ? Number(item.price) : ""}
                          placeholder="ราคา" className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-right text-sm no-print" />
                        <button className="text-xs text-sky-700 font-medium" style={{ minHeight: "auto" }}>💾</button>
                      </form>
                    ) : (
                      <b>{fmtNum(Number(item.orderQty))}</b>
                    )}
                  </td>
                  <td className="py-2 px-2 text-gray-500">{item.unit.code}</td>
                  <td className="py-2 px-2 text-right">{item.price ? fmtBaht(Number(item.price)) : "—"}</td>
                  <td className="py-2 px-2 text-right">{fmtNum(Number(item.receivedQty))}</td>
                  <td className={`py-2 px-2 text-right ${out > 0.001 && ["PARTIAL", "ORDERED"].includes(po.status) ? "text-red-700 font-semibold" : "text-gray-400"}`}>
                    {out > 0.001 ? fmtNum(out) : "—"}
                  </td>
                  {editable && (
                    <td className="py-2 px-2 no-print">
                      <form action={moveItemToVendor.bind(null, item.id)} className="flex gap-1">
                        <select name="vendorId" defaultValue="" className="rounded-lg border border-gray-200 text-xs px-1 py-1 bg-white" style={{ minHeight: "auto" }}>
                          <option value="" disabled>ย้าย…</option>
                          {vendors.filter((v) => v.id !== po.vendorId).map((v) => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                          ))}
                        </select>
                        <button className="text-xs text-sky-700" style={{ minHeight: "auto" }}>→</button>
                      </form>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-semibold">
              <td className="py-2.5 px-3" colSpan={6}>รวมมูลค่า (ตามราคาที่กรอก)</td>
              <td className="py-2.5 px-2 text-right" colSpan={3}>{fmtBaht(totalAmount)}</td>
              {editable && <td className="no-print" />}
            </tr>
          </tfoot>
        </table>
      </Card>
      <p className="text-xs text-gray-400 mb-5 no-print">* Stock คือ snapshot ณ ตอนวางแผน — เป็นข้อมูลประกอบเท่านั้น ผู้สั่งเป็นคนตัดสินใจจำนวนจริง</p>

      {/* Receive form */}
      {canReceive && outstanding.length > 0 && (
        <Section title="📦 รับของเข้า Stock">
          <form action={receivePoItems.bind(null, po.id)}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[600px] mb-3">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-3">รายการ (ค้างรับ)</th>
                    <th className="py-2 px-2 text-right">จำนวนรับครั้งนี้</th>
                    <th className="py-2 px-2">Lot</th>
                    <th className="py-2 px-2">วันหมดอายุ</th>
                  </tr>
                </thead>
                <tbody>
                  {outstanding.map((item) => (
                    <tr key={item.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pr-3">
                        {item.ingredient.name}
                        <span className="text-gray-400 text-xs ml-1">ค้าง {fmtNum(Number(item.orderQty) - Number(item.receivedQty))} {item.unit.code}</span>
                      </td>
                      <td className="py-2 px-2 text-right">
                        <input name={`qty_${item.id}`} type="number" step="0.01" min="0"
                          className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-right text-sm" />
                      </td>
                      <td className="py-2 px-2">
                        <input name={`lot_${item.id}`} placeholder="อัตโนมัติ" className="w-32 rounded-lg border border-gray-300 px-2 py-1 text-sm" />
                      </td>
                      <td className="py-2 px-2">
                        <input name={`exp_${item.id}`} type="date" className="rounded-lg border border-gray-300 px-2 py-1 text-sm" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2 items-end">
              <label className="text-sm">
                <span className="block text-xs text-gray-500 mb-1">เก็บเข้า Location</span>
                <select name="locationId" required defaultValue="" className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
                  <option value="" disabled>เลือก…</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
                </select>
              </label>
              <input name="note" placeholder="หมายเหตุ (ถ้ามี)" className="flex-1 min-w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <button className={btnPrimary}>✓ บันทึกรับของ (Stock เพิ่มอัตโนมัติ)</button>
            </div>
          </form>
        </Section>
      )}
    </>
  );
}
