import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { buildCostRows, generateCostWorkbook, parseMapping } from "@/lib/excel";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !can(session.role, "cost")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const sp = req.nextUrl.searchParams;
  const templateId = sp.get("template");
  const from = sp.get("from");
  const to = sp.get("to");
  if (!templateId || !from || !to) {
    return NextResponse.json({ error: "template, from, to are required" }, { status: 400 });
  }

  const template = await db.excelTemplate.findUnique({ where: { id: templateId } });
  if (!template) return NextResponse.json({ error: "template not found" }, { status: 404 });

  const fromD = new Date(from + "T00:00:00Z");
  const toD = new Date(to + "T00:00:00Z");
  const rows = await buildCostRows(fromD, toD);
  const buf = await generateCostWorkbook({
    templateName: template.name,
    mapping: parseMapping(template.mappingJson),
    headerRow: template.headerRow,
    rows,
    periodLabel: `${from} ถึง ${to}`,
  });

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cost-${from}-${to}.xlsx"`,
    },
  });
}
