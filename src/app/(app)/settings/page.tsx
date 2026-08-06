import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can, PERMISSIONS, NAV_ITEMS, ROLE_LABEL } from "@/lib/rbac";
import { PageHeader, Card, Section, EmptyState, btnPrimary, btnSecondary } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { createUser, updateUser } from "./actions";
import type { Role } from "@prisma/client";

export const metadata = { title: "ตั้งค่า" };
export const dynamic = "force-dynamic";

const ROLES: Role[] = ["ADMIN", "MANAGER", "SUPERVISOR", "PROCUREMENT", "STORE", "STAFF", "VIEWER"];
const ACCESS_ICON: Record<string, string> = { none: "—", view: "👁 ดู", edit: "✎ แก้ไข", approve: "✓ อนุมัติ", admin: "★ ทั้งหมด" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const session = await requireSession();
  if (!can(session.role, "settings", "admin")) notFound();
  const { edit } = await searchParams;

  const [users, logs] = await Promise.all([
    db.user.findMany({ orderBy: [{ role: "asc" }, { username: "asc" }] }),
    db.auditLog.findMany({ include: { user: true }, orderBy: { createdAt: "desc" }, take: 60 }),
  ]);
  const editUser = edit ? users.find((u) => u.id === edit) : null;
  const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

  return (
    <>
      <PageHeader title="ตั้งค่าระบบ" subtitle="ผู้ใช้งาน สิทธิ์ Excel Template และประวัติการแก้ไขข้อมูล"
        actions={
          <>
            <Link href="/settings/drive" className={btnSecondary}>📁 Google Drive</Link>
            <Link href="/settings/excel-template" className={btnSecondary}>📗 Excel Template Manager</Link>
            <Link href="/master/import" className={btnSecondary}>📥 นำเข้าข้อมูลหลัก</Link>
          </>
        } />

      {/* Users */}
      <div className="mb-4">
        <Section title="👥 ผู้ใช้งาน">
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2">Username</th><th className="py-2">ชื่อ</th>
                  <th className="py-2">บทบาท</th><th className="py-2">สถานะ</th><th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={`border-b border-gray-100 last:border-0 ${!u.active ? "opacity-50" : ""}`}>
                    <td className="py-2.5 font-mono text-xs">{u.username}</td>
                    <td className="py-2.5 font-medium">{u.name}</td>
                    <td className="py-2.5">{ROLE_LABEL[u.role]}</td>
                    <td className="py-2.5 text-xs">{u.active ? "🟢 ใช้งาน" : "⚪ ปิด"}</td>
                    <td className="py-2.5 text-right">
                      <Link href={`/settings?edit=${u.id}`} className="text-sky-700 text-xs font-medium">แก้ไข</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {editUser ? (
            <form action={updateUser.bind(null, editUser.id)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 border-t border-gray-100 pt-4">
              <div className="sm:col-span-2 lg:col-span-4 text-sm font-semibold">แก้ไขผู้ใช้: {editUser.username}</div>
              <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">ชื่อ *</span>
                <input name="name" required defaultValue={editUser.name} className={inputCls} /></label>
              <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">บทบาท *</span>
                <select name="role" defaultValue={editUser.role} className={inputCls + " bg-white"}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select></label>
              <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">รหัสผ่านใหม่ (เว้นว่าง = ไม่เปลี่ยน)</span>
                <input name="password" type="password" className={inputCls} /></label>
              <label className="text-sm flex items-center gap-2 pt-5">
                <input type="checkbox" name="active" defaultChecked={editUser.active} className="w-4 h-4" /><span>ใช้งาน</span>
              </label>
              <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
                <button className={btnPrimary}>💾 บันทึก</button>
                <Link href="/settings" className={btnSecondary}>ยกเลิก</Link>
              </div>
            </form>
          ) : (
            <form action={createUser} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 border-t border-gray-100 pt-4">
              <div className="sm:col-span-2 lg:col-span-4 text-sm font-semibold">+ เพิ่มผู้ใช้ใหม่</div>
              <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">Username *</span>
                <input name="username" required className={inputCls} /></label>
              <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">ชื่อ-นามสกุล *</span>
                <input name="name" required className={inputCls} /></label>
              <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">รหัสผ่าน *</span>
                <input name="password" type="password" required minLength={4} className={inputCls} /></label>
              <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">บทบาท *</span>
                <select name="role" defaultValue="STAFF" className={inputCls + " bg-white"}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select></label>
              <div className="sm:col-span-2 lg:col-span-4"><button className={btnPrimary}>+ เพิ่มผู้ใช้</button></div>
            </form>
          )}
        </Section>
      </div>

      {/* Permission matrix */}
      <div className="mb-4">
        <Section title="🔐 Permission Matrix">
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
          <p className="text-xs text-gray-400 mt-2">เมนูที่ผู้ใช้ไม่มีสิทธิ์จะไม่แสดงในแถบนำทางเลย</p>
        </Section>
      </div>

      {/* Activity log */}
      <Section title="🕘 Activity Log — ใครแก้อะไร จากค่าเดิมเป็นค่าใหม่อะไร เมื่อไหร่">
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

      <Card className="p-4 mt-4 text-sm text-gray-500">
        <div className="font-semibold text-gray-700 mb-2">ℹ️ เกี่ยวกับระบบ</div>
        <ul className="space-y-1 text-xs">
          <li>• ระบบเป็น PWA — ติดตั้งบนมือถือได้ และรองรับเครือข่ายไม่เสถียรระดับหนึ่ง</li>
          <li>• ข้อมูลธุรกรรม (Stock, Purchase, Usage) ใช้ Soft Delete / ปิดใช้งาน ไม่ลบถาวร</li>
          <li>• ทุกการแก้ไขสำคัญถูกบันทึกใน Audit Log ตรวจสอบย้อนหลังได้</li>
          <li>• Backup ฐานข้อมูล: ใช้ <code className="bg-gray-100 px-1 rounded">pg_dump</code> ตามรอบที่องค์กรกำหนด</li>
        </ul>
      </Card>
    </>
  );
}
