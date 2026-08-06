import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { buildImportTemplate } from "@/lib/import";

export async function GET() {
  const session = await getSession();
  if (!session || !can(session.role, "master")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const buf = await buildImportTemplate();
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="canteen-master-data-template.xlsx"',
    },
  });
}
