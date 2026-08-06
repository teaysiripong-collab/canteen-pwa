import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can, ROLE_LABEL } from "@/lib/rbac";
import { PageHeader, Card, Section, EmptyState, btnSecondary } from "@/components/ui";
import { fmtDate, ymd } from "@/lib/format";
import { getConfig, DAY_NAMES } from "@/lib/config";
import { SettingsForm, EmployeeForm, inputCls } from "@/components/SettingsForms";
import {
  createEmployee, updateEmployee, saveOrgInfo, saveShiftConfig, saveCalendarConfig, saveDocConfig,
} from "./actions";
import type { Role } from "@prisma/client";

export const metadata = { title: "ตั้งค่า" };
export const dynamic = "force-dynamic";

const ROLES: Role[] = ["ADMIN", "MANAGER", "SUPERVISOR", "PROCUREMENT", "STORE", "STAFF", "VIEWER"];
const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }));

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const session = await requireSession();
  if (!can(session.role, "settings", "admin")) notFound();
  const { edit } = await searchParams;

  const [users, cfg] = await Promise.all([
    db.user.findMany({ orderBy: [{ active: "desc" }, { employeeCode: "asc" }, { name: "asc" }] }),
    getConfig(),
  ]);
  const editUser = edit ? users.find((u) => u.id === edit) : null;
  const activeCount = users.filter((u) => u.active).length;

  return (
    <>
      <PageHeader title="ตั้งค่าระบบ"
        subtitle="ข้อมูลพนักงาน ข้อมูลแคนทีน รอบการทำงาน วันทำการ และรูปแบบเลขที่เอกสาร"
        actions={
          <>
            <Link href="/settings/permissions" className={btnSecondary}>🔐 สิทธิ์การใช้งาน</Link>
            <Link href="/settings/activity" className={btnSecondary}>🕘 ประวัติการใช้งาน</Link>
            <Link href="/settings/integrations" className={btnSecondary}>🔌 การเชื่อมต่อ</Link>
          </>
        } />

      {/* ── พนักงาน ── */}
      <div className="mb-4">
        <Section title={`👥 พนักงาน (${activeCount} คนที่ยังทำงานอยู่ จากทั้งหมด ${users.length})`}>
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                  <th className="py-2.5 px-3">รหัสพนักงาน</th>
                  <th className="py-2.5 px-3">ชื่อ-นามสกุล</th>
                  <th className="py-2.5 px-3">ชื่อเล่น</th>
                  <th className="py-2.5 px-3">แผนก</th>
                  <th className="py-2.5 px-3">เบอร์โทร</th>
                  <th className="py-2.5 px-3">บทบาท</th>
                  <th className="py-2.5 px-3">เริ่มงาน</th>
                  <th className="py-2.5 px-3">สถานะ</th>
                  <th className="py-2.5 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 ${!u.active ? "opacity-50" : ""}`}>
                    <td className="py-2.5 px-3 font-mono text-xs font-semibold">{u.employeeCode ?? "—"}</td>
                    <td className="py-2.5 px-3 font-medium">{u.name}</td>
                    <td className="py-2.5 px-3 text-gray-600">{u.nickname ?? "—"}</td>
                    <td className="py-2.5 px-3 text-gray-600">{u.department ?? "—"}</td>
                    <td className="py-2.5 px-3 text-gray-600">{u.phone ?? "—"}</td>
                    <td className="py-2.5 px-3">{ROLE_LABEL[u.role]}</td>
                    <td className="py-2.5 px-3 text-gray-500 whitespace-nowrap">{u.startDate ? fmtDate(u.startDate) : "—"}</td>
                    <td className="py-2.5 px-3 text-xs whitespace-nowrap">{u.active ? "🟢 ทำงานอยู่" : "⚪ พ้นสภาพ"}</td>
                    <td className="py-2.5 px-3 text-right">
                      <Link href={`/settings?edit=${u.id}`} className="text-sky-700 text-xs font-medium">แก้ไข</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <div className="text-sm font-semibold mb-3">
              {editUser ? `แก้ไขพนักงาน: ${editUser.employeeCode ?? ""} ${editUser.name}` : "+ เพิ่มพนักงานใหม่"}
              {editUser && (
                <Link href="/settings" className="ml-3 text-xs font-normal text-gray-500 underline">ยกเลิก</Link>
              )}
            </div>
            {editUser ? (
              <EmployeeForm
                key={editUser.id}
                action={updateEmployee.bind(null, editUser.id)}
                label="💾 บันทึกการแก้ไข"
                roles={ROLE_OPTIONS}
                requireCredentials={false}
                defaults={{
                  employeeCode: editUser.employeeCode, username: editUser.username, name: editUser.name,
                  nickname: editUser.nickname, department: editUser.department, phone: editUser.phone,
                  startDate: editUser.startDate ? ymd(editUser.startDate) : "",
                  role: editUser.role, active: editUser.active,
                }}
              />
            ) : (
              <EmployeeForm
                action={createEmployee}
                label="+ เพิ่มพนักงาน"
                roles={ROLE_OPTIONS}
                requireCredentials
              />
            )}
            <p className="text-xs text-gray-400 mt-3">
              เว้นรหัสพนักงานว่างไว้ ระบบจะออกรหัสถัดไปให้เอง (รูปแบบปัจจุบัน: <b>{cfg.employeePrefix}001</b>, <b>{cfg.employeePrefix}002</b>, …)
            </p>
          </div>
        </Section>
      </div>

      {/* ── ข้อมูลแคนทีน ── */}
      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Section title="🏢 ข้อมูลแคนทีน (แสดงบนเอกสารที่พิมพ์)">
          <SettingsForm action={saveOrgInfo} label="💾 บันทึก" className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              <span className="block text-xs text-gray-500 mb-1">ชื่อแคนทีน / หน่วยงาน *</span>
              <input name="orgName" required defaultValue={cfg.org.name} className={inputCls} />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">สาขา / อาคาร</span>
              <input name="orgBranch" defaultValue={cfg.org.branch} className={inputCls} />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">เบอร์โทร</span>
              <input name="orgPhone" defaultValue={cfg.org.phone} className={inputCls} />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="block text-xs text-gray-500 mb-1">ที่อยู่</span>
              <input name="orgAddress" defaultValue={cfg.org.address} className={inputCls} />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">เลขประจำตัวผู้เสียภาษี</span>
              <input name="orgTaxId" defaultValue={cfg.org.taxId} className={inputCls} />
            </label>
          </SettingsForm>
        </Section>

        <Section title="🕐 รอบการทำงาน">
          <SettingsForm action={saveShiftConfig} label="💾 บันทึก" className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">ชื่อรอบที่ 1 *</span>
              <input name="morningLabel" required defaultValue={cfg.shifts.MORNING.label} className={inputCls} />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">เวลารอบที่ 1</span>
              <input name="morningTime" defaultValue={cfg.shifts.MORNING.time} placeholder="06:00-14:00" className={inputCls} />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">ชื่อรอบที่ 2 *</span>
              <input name="nightLabel" required defaultValue={cfg.shifts.NIGHT.label} className={inputCls} />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">เวลารอบที่ 2</span>
              <input name="nightTime" defaultValue={cfg.shifts.NIGHT.time} placeholder="18:00-02:00" className={inputCls} />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="block text-xs text-gray-500 mb-1">สัดส่วน BOM รอบที่ 2 เทียบรอบที่ 1</span>
              <input name="nightFactor" type="number" step="0.05" min="0.05" max="1"
                defaultValue={cfg.nightFactor} className={inputCls} />
              <span className="block text-xs text-gray-400 mt-1">
                เช่น 0.6 = เมื่อเพิ่มเมนูรอบที่ 2 ระบบเสนอ BOM ที่ 60% ของรอบที่ 1 (แก้รายเมนูได้เสมอ)
              </span>
            </label>
          </SettingsForm>
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Section title="📅 วันทำการ (ปฏิทินแผนเมนู)">
          <SettingsForm action={saveCalendarConfig} label="💾 บันทึก" className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <label key={d}
                className="flex items-center gap-2 text-sm rounded-lg border border-gray-300 px-3 py-2 cursor-pointer hover:bg-gray-50">
                <input type="checkbox" name="workingDays" value={d}
                  defaultChecked={cfg.workingDays.includes(d)} className="w-4 h-4" />
                <span>{DAY_NAMES[d]}</span>
              </label>
            ))}
          </SettingsForm>
          <p className="text-xs text-gray-400 mt-3">
            ตอนนี้ปฏิทินแสดง {cfg.workingDays.length} วัน: {cfg.workingDays.map((d) => DAY_NAMES[d]).join(" · ")}
          </p>
        </Section>

        <Section title="🔢 รูปแบบเลขที่เอกสาร">
          <SettingsForm action={saveDocConfig} label="💾 บันทึก" className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">คำนำหน้าใบสั่งซื้อ</span>
              <input name="poPrefix" defaultValue={cfg.poPrefix} className={inputCls} />
              <span className="block text-xs text-gray-400 mt-1">ตัวอย่าง: {cfg.poPrefix}-20260806-001</span>
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">คำนำหน้ารหัสพนักงาน</span>
              <input name="employeePrefix" defaultValue={cfg.employeePrefix} className={inputCls} />
              <span className="block text-xs text-gray-400 mt-1">ตัวอย่าง: {cfg.employeePrefix}001</span>
            </label>
          </SettingsForm>
        </Section>
      </div>

      {users.length === 0 && <Card className="p-4"><EmptyState text="ยังไม่มีพนักงานในระบบ" /></Card>}

      <Card className="p-4 text-sm text-gray-500">
        <div className="font-semibold text-gray-700 mb-2">ℹ️ เกี่ยวกับระบบ</div>
        <ul className="space-y-1 text-xs">
          <li>• ค่าที่ตั้งในหน้านี้มีผลกับระบบทันที ไม่ต้อง deploy ใหม่</li>
          <li>• ข้อมูลธุรกรรม (Stock, Purchase, Usage) ใช้ Soft Delete ไม่ลบถาวร</li>
          <li>• ทุกการแก้ไขสำคัญถูกบันทึกใน <Link href="/settings/activity" className="text-sky-700 underline">ประวัติการใช้งาน</Link></li>
          <li>• สำรองฐานข้อมูล: <code className="bg-gray-100 px-1 rounded">./scripts/backup.sh</code></li>
        </ul>
      </Card>
    </>
  );
}
