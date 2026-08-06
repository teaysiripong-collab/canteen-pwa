import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader, Card, Section, EmptyState, btnPrimary, btnSecondary } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/rbac";
import { saveIngredient, deactivateIngredient, saveVendor, saveMenu, saveLocation, saveUnit, saveCategory } from "./actions";

export const metadata = { title: "Master Data" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "ingredients", label: "วัตถุดิบ" },
  { key: "menus", label: "เมนู" },
  { key: "vendors", label: "Vendor" },
  { key: "locations", label: "สถานที่จัดเก็บ" },
  { key: "units", label: "หน่วยนับ" },
  { key: "categories", label: "หมวดหมู่" },
  { key: "users", label: "ผู้ใช้งาน" },
];

export default async function MasterPage({ searchParams }: { searchParams: Promise<{ tab?: string; edit?: string }> }) {
  const session = await requireSession();
  const isAdmin = can(session.role, "master", "admin");
  const { tab: tabRaw, edit } = await searchParams;
  const tab = TABS.find((t) => t.key === tabRaw)?.key ?? "ingredients";

  const [ingredients, menus, vendors, locations, units, categories, users] = await Promise.all([
    db.ingredient.findMany({ include: { category: true, stockUnit: true, purchaseUnit: true, defaultVendor: true, storage: true }, orderBy: { code: "asc" } }),
    db.menu.findMany({ include: { category: true, recipes: { where: { isCurrent: true } } }, orderBy: { code: "asc" } }),
    db.vendor.findMany({ include: { ingredients: true }, orderBy: { code: "asc" } }),
    db.location.findMany({ include: { parent: true }, orderBy: { code: "asc" } }),
    db.unit.findMany({ orderBy: { code: "asc" } }),
    db.category.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
    db.user.findMany({ orderBy: { username: "asc" } }),
  ]);

  const editIng = edit ? ingredients.find((i) => i.id === edit) : null;
  const editVendor = edit ? vendors.find((v) => v.id === edit) : null;
  const editMenu = edit ? menus.find((m) => m.id === edit) : null;

  const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  const selectCls = inputCls + " bg-white";

  return (
    <>
      <PageHeader title="Master Data"
        subtitle="ข้อมูลหลักของระบบ — แก้ที่นี่แล้วทุกโมดูลใช้ค่าใหม่ทันที ไม่มีการ Hardcode ใน Source Code"
        actions={isAdmin ? (
          <>
            <Link href="/master/import" className={btnPrimary}>📥 นำเข้าจาก Excel</Link>
            <a href="/api/import/template" className={btnSecondary}>⬇ แบบฟอร์มนำเข้า</a>
          </>
        ) : undefined} />

      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <Link key={t.key} href={`/master?tab=${t.key}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium border ${tab === t.key ? "bg-[#1e3a5f] text-white border-[#1e3a5f]" : "bg-white border-gray-300 text-gray-600 hover:border-gray-400"}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {/* ── Ingredients ── */}
      {tab === "ingredients" && (
        <>
          <Card className="overflow-x-auto mb-4">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                  <th className="py-2.5 px-3">รหัส</th>
                  <th className="py-2.5 px-3">ชื่อ</th>
                  <th className="py-2.5 px-3">หมวด</th>
                  <th className="py-2.5 px-3">หน่วยนับ</th>
                  <th className="py-2.5 px-3">หน่วยสั่งซื้อ</th>
                  <th className="py-2.5 px-3 text-right">Conversion</th>
                  <th className="py-2.5 px-3">Vendor หลัก</th>
                  <th className="py-2.5 px-3">ที่เก็บ</th>
                  <th className="py-2.5 px-3 text-right">ขั้นต่ำ</th>
                  <th className="py-2.5 px-3">สถานะ</th>
                  {isAdmin && <th className="py-2.5 px-3"></th>}
                </tr>
              </thead>
              <tbody>
                {ingredients.map((i) => (
                  <tr key={i.id} className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 ${!i.active ? "opacity-50" : ""}`}>
                    <td className="py-2.5 px-3 font-mono text-xs">{i.code}</td>
                    <td className="py-2.5 px-3 font-medium">{i.name}</td>
                    <td className="py-2.5 px-3 text-gray-500">{i.category?.name ?? "—"}</td>
                    <td className="py-2.5 px-3">{i.stockUnit.code}</td>
                    <td className="py-2.5 px-3 text-gray-500">{i.purchaseUnit?.code ?? "—"}</td>
                    <td className="py-2.5 px-3 text-right text-gray-500">{fmtNum(Number(i.conversionFactor))}</td>
                    <td className="py-2.5 px-3 text-gray-500">{i.defaultVendor?.name ?? <span className="text-red-600">⚠️ ยังไม่กำหนด</span>}</td>
                    <td className="py-2.5 px-3 text-gray-500 text-xs">{i.storage?.name ?? "—"}</td>
                    <td className="py-2.5 px-3 text-right">{fmtNum(Number(i.minStock))}</td>
                    <td className="py-2.5 px-3 text-xs">{i.active ? "🟢 ใช้งาน" : "⚪ ปิด"}</td>
                    {isAdmin && (
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <Link href={`/master?tab=ingredients&edit=${i.id}`} className="text-sky-700 text-xs font-medium">แก้ไข</Link>
                        {i.active && (
                          <form action={deactivateIngredient.bind(null, i.id)} className="inline-block ml-2">
                            <button className="text-gray-400 hover:text-red-600 text-xs" style={{ minHeight: "auto" }}>ปิดใช้งาน</button>
                          </form>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {isAdmin && (
            <Section title={editIng ? `แก้ไขวัตถุดิบ: ${editIng.name}` : "+ เพิ่มวัตถุดิบใหม่"}>
              <form action={saveIngredient.bind(null, editIng?.id ?? null)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">รหัส *</span>
                  <input name="code" required defaultValue={editIng?.code} className={inputCls} /></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">ชื่อ *</span>
                  <input name="name" required defaultValue={editIng?.name} className={inputCls} /></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">หมวด</span>
                  <select name="categoryId" defaultValue={editIng?.categoryId ?? ""} className={selectCls}>
                    <option value="">—</option>
                    {categories.filter((c) => c.type === "INGREDIENT").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">หน่วยนับ (Stock) *</span>
                  <select name="stockUnitId" required defaultValue={editIng?.stockUnitId ?? ""} className={selectCls}>
                    <option value="" disabled>เลือก…</option>
                    {units.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
                  </select></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">หน่วยสั่งซื้อ</span>
                  <select name="purchaseUnitId" defaultValue={editIng?.purchaseUnitId ?? ""} className={selectCls}>
                    <option value="">—</option>
                    {units.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                  </select></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">Conversion (1 หน่วยสั่ง = ? หน่วยนับ)</span>
                  <input name="conversionFactor" type="number" step="0.0001" min="0.0001" defaultValue={Number(editIng?.conversionFactor ?? 1)} className={inputCls} /></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">Vendor หลัก</span>
                  <select name="defaultVendorId" defaultValue={editIng?.defaultVendorId ?? ""} className={selectCls}>
                    <option value="">—</option>
                    {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">ที่จัดเก็บ</span>
                  <select name="storageId" defaultValue={editIng?.storageId ?? ""} className={selectCls}>
                    <option value="">—</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
                  </select></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">Stock ขั้นต่ำ</span>
                  <input name="minStock" type="number" step="0.01" min="0" defaultValue={Number(editIng?.minStock ?? 0)} className={inputCls} /></label>
                <label className="text-sm flex items-center gap-2 pt-5">
                  <input type="checkbox" name="active" defaultChecked={editIng?.active ?? true} className="w-4 h-4" />
                  <span>ใช้งาน</span>
                </label>
                <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
                  <button className={btnPrimary}>{editIng ? "💾 บันทึกการแก้ไข" : "+ เพิ่มวัตถุดิบ"}</button>
                  {editIng && <Link href="/master?tab=ingredients" className={btnSecondary}>ยกเลิก</Link>}
                </div>
              </form>
            </Section>
          )}
        </>
      )}

      {/* ── Menus ── */}
      {tab === "menus" && (
        <>
          <Card className="overflow-x-auto mb-4">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                  <th className="py-2.5 px-3">รหัส</th><th className="py-2.5 px-3">ชื่อเมนู</th>
                  <th className="py-2.5 px-3">หมวด</th><th className="py-2.5 px-3">สูตร</th>
                  <th className="py-2.5 px-3">สถานะ</th>{isAdmin && <th></th>}
                </tr>
              </thead>
              <tbody>
                {menus.map((m) => (
                  <tr key={m.id} className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 ${!m.active ? "opacity-50" : ""}`}>
                    <td className="py-2.5 px-3 font-mono text-xs">{m.code}</td>
                    <td className="py-2.5 px-3 font-medium">{m.favorite ? "⭐ " : ""}{m.name}</td>
                    <td className="py-2.5 px-3 text-gray-500">{m.category?.name ?? "—"}</td>
                    <td className="py-2.5 px-3">
                      {m.recipes[0] ? <Link href={`/recipes/${m.recipes[0].id}`} className="text-sky-700 text-xs">ดูสูตร v{m.recipes[0].version}</Link> : <span className="text-gray-400 text-xs">ยังไม่มีสูตร</span>}
                    </td>
                    <td className="py-2.5 px-3 text-xs">{m.active ? "🟢 ใช้งาน" : "⚪ ปิด"}</td>
                    {isAdmin && <td className="py-2.5 px-3"><Link href={`/master?tab=menus&edit=${m.id}`} className="text-sky-700 text-xs font-medium">แก้ไข</Link></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {isAdmin && (
            <Section title={editMenu ? `แก้ไขเมนู: ${editMenu.name}` : "+ เพิ่มเมนูใหม่"}>
              <form action={saveMenu.bind(null, editMenu?.id ?? null)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">รหัส *</span>
                  <input name="code" required defaultValue={editMenu?.code} className={inputCls} /></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">ชื่อเมนู *</span>
                  <input name="name" required defaultValue={editMenu?.name} className={inputCls} /></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">หมวด</span>
                  <select name="categoryId" defaultValue={editMenu?.categoryId ?? ""} className={selectCls}>
                    <option value="">—</option>
                    {categories.filter((c) => c.type === "MENU").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></label>
                <div className="flex gap-4 items-center pt-5">
                  <label className="text-sm flex items-center gap-2">
                    <input type="checkbox" name="favorite" defaultChecked={editMenu?.favorite ?? false} className="w-4 h-4" /><span>⭐ Favorite</span>
                  </label>
                  <label className="text-sm flex items-center gap-2">
                    <input type="checkbox" name="active" defaultChecked={editMenu?.active ?? true} className="w-4 h-4" /><span>ใช้งาน</span>
                  </label>
                </div>
                <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
                  <button className={btnPrimary}>{editMenu ? "💾 บันทึก" : "+ เพิ่มเมนู"}</button>
                  {editMenu && <Link href="/master?tab=menus" className={btnSecondary}>ยกเลิก</Link>}
                </div>
              </form>
            </Section>
          )}
        </>
      )}

      {/* ── Vendors ── */}
      {tab === "vendors" && (
        <>
          <Card className="overflow-x-auto mb-4">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                  <th className="py-2.5 px-3">รหัส</th><th className="py-2.5 px-3">ชื่อ</th>
                  <th className="py-2.5 px-3">ผู้ติดต่อ</th><th className="py-2.5 px-3">โทร</th>
                  <th className="py-2.5 px-3">Email</th><th className="py-2.5 px-3 text-right">Lead Time</th>
                  <th className="py-2.5 px-3">รอบส่ง</th><th className="py-2.5 px-3 text-right">รายการที่ขาย</th>
                  <th className="py-2.5 px-3">สถานะ</th>{isAdmin && <th></th>}
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id} className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 ${!v.active ? "opacity-50" : ""}`}>
                    <td className="py-2.5 px-3 font-mono text-xs">{v.code}</td>
                    <td className="py-2.5 px-3 font-medium">{v.name}</td>
                    <td className="py-2.5 px-3 text-gray-500">{v.contactName ?? "—"}</td>
                    <td className="py-2.5 px-3 text-gray-500">{v.phone ?? "—"}</td>
                    <td className="py-2.5 px-3 text-gray-500 text-xs">{v.email ?? "—"}</td>
                    <td className="py-2.5 px-3 text-right">{v.leadTimeDays} วัน</td>
                    <td className="py-2.5 px-3 text-gray-500 text-xs">{v.deliveryDays ?? "—"}</td>
                    <td className="py-2.5 px-3 text-right">{v.ingredients.length}</td>
                    <td className="py-2.5 px-3 text-xs">{v.active ? "🟢 ใช้งาน" : "⚪ ปิด"}</td>
                    {isAdmin && <td className="py-2.5 px-3"><Link href={`/master?tab=vendors&edit=${v.id}`} className="text-sky-700 text-xs font-medium">แก้ไข</Link></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {isAdmin && (
            <Section title={editVendor ? `แก้ไข Vendor: ${editVendor.name}` : "+ เพิ่ม Vendor ใหม่"}>
              <form action={saveVendor.bind(null, editVendor?.id ?? null)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">รหัส *</span>
                  <input name="code" required defaultValue={editVendor?.code} className={inputCls} /></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">ชื่อ *</span>
                  <input name="name" required defaultValue={editVendor?.name} className={inputCls} /></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">ผู้ติดต่อ</span>
                  <input name="contactName" defaultValue={editVendor?.contactName ?? ""} className={inputCls} /></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">เบอร์โทร</span>
                  <input name="phone" defaultValue={editVendor?.phone ?? ""} className={inputCls} /></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">Email</span>
                  <input name="email" type="email" defaultValue={editVendor?.email ?? ""} className={inputCls} /></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">Minimum Order (฿)</span>
                  <input name="minOrder" type="number" step="0.01" min="0" defaultValue={editVendor?.minOrder ? Number(editVendor.minOrder) : ""} className={inputCls} /></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">Lead Time (วัน)</span>
                  <input name="leadTimeDays" type="number" min="0" defaultValue={editVendor?.leadTimeDays ?? 1} className={inputCls} /></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">รอบส่ง</span>
                  <input name="deliveryDays" placeholder="เช่น จ,พ,ศ" defaultValue={editVendor?.deliveryDays ?? ""} className={inputCls} /></label>
                <label className="text-sm flex items-center gap-2 pt-5">
                  <input type="checkbox" name="active" defaultChecked={editVendor?.active ?? true} className="w-4 h-4" /><span>ใช้งาน</span>
                </label>
                <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
                  <button className={btnPrimary}>{editVendor ? "💾 บันทึก" : "+ เพิ่ม Vendor"}</button>
                  {editVendor && <Link href="/master?tab=vendors" className={btnSecondary}>ยกเลิก</Link>}
                </div>
              </form>
            </Section>
          )}
        </>
      )}

      {/* ── Locations ── */}
      {tab === "locations" && (
        <>
          <Card className="overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                  <th className="py-2.5 px-3">รหัส</th><th className="py-2.5 px-3">ชื่อ</th>
                  <th className="py-2.5 px-3">อยู่ภายใต้</th><th className="py-2.5 px-3">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((l) => (
                  <tr key={l.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="py-2.5 px-3 font-mono text-xs">{l.code}</td>
                    <td className="py-2.5 px-3 font-medium">{l.parent ? "↳ " : ""}{l.name}</td>
                    <td className="py-2.5 px-3 text-gray-500">{l.parent?.name ?? "— (ระดับบนสุด)"}</td>
                    <td className="py-2.5 px-3 text-xs">{l.active ? "🟢 ใช้งาน" : "⚪ ปิด"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {isAdmin && (
            <Section title="+ เพิ่มสถานที่จัดเก็บ">
              <form action={saveLocation} className="grid gap-3 sm:grid-cols-4">
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">รหัส *</span>
                  <input name="code" required className={inputCls} /></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">ชื่อ *</span>
                  <input name="name" required className={inputCls} /></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">อยู่ภายใต้</span>
                  <select name="parentId" defaultValue="" className={selectCls}>
                    <option value="">— ระดับบนสุด —</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select></label>
                <div className="pt-5"><button className={btnPrimary}>+ เพิ่ม</button></div>
              </form>
            </Section>
          )}
        </>
      )}

      {/* ── Units ── */}
      {tab === "units" && (
        <>
          <Card className="p-4 mb-4">
            <div className="flex flex-wrap gap-2">
              {units.map((u) => (
                <span key={u.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm">
                  <b>{u.code}</b> <span className="text-gray-500">— {u.name}</span>
                </span>
              ))}
            </div>
          </Card>
          {isAdmin && (
            <Section title="+ เพิ่มหน่วยนับ">
              <form action={saveUnit} className="flex flex-wrap gap-3 items-end">
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">รหัสหน่วย *</span>
                  <input name="code" required placeholder="เช่น kg" className={inputCls} /></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">ชื่อเต็ม *</span>
                  <input name="name" required placeholder="เช่น กิโลกรัม" className={inputCls} /></label>
                <button className={btnPrimary}>+ เพิ่ม</button>
              </form>
            </Section>
          )}
        </>
      )}

      {/* ── Categories ── */}
      {tab === "categories" && (
        <>
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            {["INGREDIENT", "MENU"].map((t) => (
              <Section key={t} title={t === "INGREDIENT" ? "หมวดวัตถุดิบ" : "หมวดเมนู"}>
                <div className="flex flex-wrap gap-2">
                  {categories.filter((c) => c.type === t).map((c) => (
                    <span key={c.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm">{c.name}</span>
                  ))}
                  {categories.filter((c) => c.type === t).length === 0 && <EmptyState text="ยังไม่มีหมวด" />}
                </div>
              </Section>
            ))}
          </div>
          {isAdmin && (
            <Section title="+ เพิ่มหมวดหมู่">
              <form action={saveCategory} className="flex flex-wrap gap-3 items-end">
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">ประเภท *</span>
                  <select name="type" defaultValue="INGREDIENT" className={selectCls}>
                    <option value="INGREDIENT">หมวดวัตถุดิบ</option>
                    <option value="MENU">หมวดเมนู</option>
                  </select></label>
                <label className="text-sm"><span className="block text-xs text-gray-500 mb-1">ชื่อหมวด *</span>
                  <input name="name" required className={inputCls} /></label>
                <button className={btnPrimary}>+ เพิ่ม</button>
              </form>
            </Section>
          )}
        </>
      )}

      {/* ── Users ── */}
      {tab === "users" && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                <th className="py-2.5 px-3">Username</th><th className="py-2.5 px-3">ชื่อ</th>
                <th className="py-2.5 px-3">บทบาท</th><th className="py-2.5 px-3">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={`border-b border-gray-100 last:border-0 ${!u.active ? "opacity-50" : ""}`}>
                  <td className="py-2.5 px-3 font-mono text-xs">{u.username}</td>
                  <td className="py-2.5 px-3 font-medium">{u.name}</td>
                  <td className="py-2.5 px-3">{ROLE_LABEL[u.role]}</td>
                  <td className="py-2.5 px-3 text-xs">{u.active ? "🟢 ใช้งาน" : "⚪ ปิด"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-3 text-xs text-gray-400 border-t border-gray-100">
            การเพิ่ม/แก้ไขผู้ใช้และรีเซ็ตรหัสผ่าน ทำได้ที่หน้า <Link href="/settings" className="text-sky-700">ตั้งค่า</Link> (เฉพาะ Admin)
          </div>
        </Card>
      )}
    </>
  );
}
