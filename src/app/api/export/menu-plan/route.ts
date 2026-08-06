import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { mondayOf, ymd } from "@/lib/format";
import { getConfig, workingDatesOf } from "@/lib/config";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !can(session.role, "menu-plan")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const week = req.nextUrl.searchParams.get("week");
  const weekStart = mondayOf(week ? new Date(week + "T00:00:00Z") : new Date());
  const cfg = await getConfig();
  const days = workingDatesOf(weekStart, cfg.workingDays);

  const plan = await db.menuPlan.findFirst({
    where: { weekStart },
    orderBy: { version: "desc" },
    include: { entries: { include: { menu: true }, orderBy: { sortOrder: "asc" } } },
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Canteen Management System";
  const ws = wb.addWorksheet("แผนเมนู");
  ws.getCell("A1").value = `${cfg.org.name} — แผนเมนูสัปดาห์ ${ymd(days[0])} ถึง ${ymd(days[days.length - 1])}`;
  ws.getCell("A1").font = { bold: true, size: 14 };

  ["วัน", cfg.shifts.MORNING.label, cfg.shifts.NIGHT.label].forEach((h, i) => {
    const cell = ws.getCell(3, i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF4" } };
    ws.getColumn(i + 1).width = i === 0 ? 16 : 40;
  });

  days.forEach((day, i) => {
    const r = 4 + i;
    ws.getCell(r, 1).value = ymd(day);
    const pick = (shift: "MORNING" | "NIGHT") =>
      (plan?.entries.filter((e) => ymd(e.date) === ymd(day) && e.shift === shift) ?? [])
        .map((e) => e.menu.name).join("\n");
    ws.getCell(r, 2).value = pick("MORNING");
    ws.getCell(r, 3).value = pick("NIGHT");
    ws.getCell(r, 2).alignment = { wrapText: true, vertical: "top" };
    ws.getCell(r, 3).alignment = { wrapText: true, vertical: "top" };
  });

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="menu-plan-${ymd(weekStart)}.xlsx"`,
    },
  });
}
