import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can, PERMISSIONS, NAV_ITEMS, ROLE_LABEL } from "@/lib/rbac";
import { PageHeader, Section, btnSecondary } from "@/components/ui";
import type { Role } from "@prisma/client";

export const metadata = { title: "สิทธิ์การใช้งาน" };
export const dynamic = "force-dynamic";

const ROLES: Role[] = ["ADMIN", "MANAGER", "SUPERVISOR", "PROCUREMENT", "STORE", "STAFF", "VIEWER"];
const ACCESS_ICON: Record<string, string> = {
  none: "—", view: "👁 ดู", edit: "✎ แก้ไข", approve: "✓ อนุมัติ", admin: "★ ทั้งหมด",
};

export default async function PermissionsPage() {
  const session = await requireSession();
  if (!can(session.role, "settings", "admin")) notFound();

  return (
    <>
      <PageHeader title="สิทธิ์การใช้งาน"
        subtitle="แต่ละบทบาททำอะไรได้บ้าง — เมนูที่ไม่มีสิทธิ์จะไม่แสดงในแถบนำทางเลย"
        actions={<Link href="/settings" className={btnSecondary}>← ตั้งค่า</Link>} />

      <Section title="🔐 ตารางสิทธิ์">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2 px-2">โมดูล</th>
                {ROLES.map((r) => <th key={r} className="py-2 px-2 text-center">{ROLE_LABEL[r]}</th>)}
              </tr>
            </thead>
            <tbody>
              {NAV_ITEMS.map((item) => (
                <tr key={item.key} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 px-2 font-medium whitespace-nowrap">{item.icon} {item.label}</td>
                  {ROLES.map((r) => {
                    const a = PERMISSIONS[item.key][r] ?? "none";
                    return (
                      <td key={r} className={`py-2 px-2 text-center ${a === "none" ? "text-gray-300" : "text-gray-700"}`}>
                        {ACCESS_ICON[a]}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          กำหนดบทบาทให้พนักงานแต่ละคนได้ที่ <Link href="/settings" className="text-sky-700 underline">ตั้งค่า → พนักงาน</Link>
        </p>
      </Section>
    </>
  );
}
