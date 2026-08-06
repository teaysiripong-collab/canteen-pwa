import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !can(session.role, "purchase")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: { vendor: true, items: { include: { ingredient: true, unit: true }, orderBy: { ingredient: { name: "asc" } } } },
  });
  if (!po) return NextResponse.json({ error: "not found" }, { status: 404 });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Canteen Management System";
  const ws = wb.addWorksheet(po.code);

  ws.getCell("A1").value = `ใบสั่งซื้อ ${po.code}`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = `Vendor: ${po.vendor.name}${po.vendor.phone ? ` · โทร ${po.vendor.phone}` : ""}`;
  ws.getCell("A3").value = `สำหรับช่วง: ${po.periodStart?.toISOString().slice(0, 10) ?? "-"} ถึง ${po.periodEnd?.toISOString().slice(0, 10) ?? "-"}`;

  const headers = ["รายการ", "BOM ต้องใช้", "Stock ล่าสุด", "แนะนำสั่ง", "จำนวนสั่งจริง", "หน่วย", "ราคา/หน่วย", "รวมเงิน", "รับแล้ว", "ค้างรับ"];
  const headerRow = 5;
  headers.forEach((h, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF4" } };
    cell.border = { bottom: { style: "thin" } };
    ws.getColumn(i + 1).width = i === 0 ? 26 : 14;
  });

  po.items.forEach((item, i) => {
    const r = headerRow + 1 + i;
    const order = Number(item.orderQty);
    const received = Number(item.receivedQty);
    ws.getCell(r, 1).value = item.ingredient.name;
    ws.getCell(r, 2).value = Number(item.bomQty);
    ws.getCell(r, 3).value = Number(item.stockQty);
    ws.getCell(r, 4).value = Number(item.suggestedQty);
    ws.getCell(r, 5).value = order;
    ws.getCell(r, 6).value = item.unit.code;
    ws.getCell(r, 7).value = item.price ? Number(item.price) : null;
    ws.getCell(r, 8).value = { formula: `E${r}*G${r}` };
    ws.getCell(r, 9).value = received;
    ws.getCell(r, 10).value = Math.max(0, order - received);
    [2, 3, 4, 5, 7, 8, 9, 10].forEach((c) => (ws.getCell(r, c).numFmt = "#,##0.00"));
  });

  const totalRow = headerRow + po.items.length + 1;
  ws.getCell(totalRow, 7).value = "รวม";
  ws.getCell(totalRow, 7).font = { bold: true };
  ws.getCell(totalRow, 8).value = { formula: `SUM(H${headerRow + 1}:H${totalRow - 1})` };
  ws.getCell(totalRow, 8).font = { bold: true };
  ws.getCell(totalRow, 8).numFmt = "#,##0.00";

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${po.code}.xlsx"`,
    },
  });
}
