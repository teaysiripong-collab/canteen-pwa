import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ActiveBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { SupplierForm } from "@/features/master-data/supplier-form";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney, formatQty } from "@/lib/quantity";
import { getSupplierById, listSupplierItems } from "@/repositories/master-data-repository";

export const dynamic = "force-dynamic";

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission(PERMISSIONS.SUPPLIER_MANAGE);
  const { id } = await params;

  const supplier = await getSupplierById(user.organizationId, id);
  if (!supplier) notFound();

  const mappings = await listSupplierItems(user.organizationId, supplier.id);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={supplier.nameTh}
        description={`รหัส ${supplier.code}`}
        actions={<ActiveBadge isActive={supplier.isActive} />}
      />

      <SupplierForm
        values={{
          id: supplier.id,
          code: supplier.code,
          nameTh: supplier.nameTh,
          nameEn: supplier.nameEn,
          contactName: supplier.contactName,
          phone: supplier.phone,
          email: supplier.email,
          address: supplier.address,
          leadTimeDays: supplier.leadTimeDays,
          paymentTerm: supplier.paymentTerm,
          remark: supplier.remark,
          isActive: supplier.isActive,
        }}
      />

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>วัตถุดิบที่สั่งจากผู้ขายรายนี้</CardTitle>
            <CardDescription>
              หน่วยสั่งซื้อ ตัวคูณ MOQ และขนาดแพ็ก ใช้ในการวางแผนจัดซื้อและการรับสินค้า
            </CardDescription>
          </div>
          <Button asChild size="sm" variant="secondary">
            <Link href={`/suppliers/${supplier.id}/items/new`}>
              <Plus className="h-4 w-4" aria-hidden />
              เพิ่มวัตถุดิบ
            </Link>
          </Button>
        </CardHeader>

        <CardContent>
          {mappings.length === 0 ? (
            <EmptyState
              title="ยังไม่มีวัตถุดิบของผู้ขายรายนี้"
              description="ผูกวัตถุดิบกับผู้ขายเพื่อเก็บราคา หน่วยสั่งซื้อ และเงื่อนไขการสั่ง"
            />
          ) : (
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-ink-muted">
                    <th className="py-2 pr-3 font-medium">วัตถุดิบ</th>
                    <th className="py-2 pr-3 font-medium">รหัสของผู้ขาย</th>
                    <th className="py-2 pr-3 text-right font-medium">ตัวคูณ</th>
                    <th className="py-2 pr-3 text-right font-medium">MOQ</th>
                    <th className="py-2 pr-3 text-right font-medium">แพ็ก</th>
                    <th className="py-2 pr-3 text-right font-medium">Lead Time</th>
                    <th className="py-2 pr-3 text-right font-medium">ราคาล่าสุด</th>
                    <th className="py-2 pr-3 font-medium">สถานะ</th>
                    <th className="py-2 font-medium">
                      <span className="sr-only">จัดการ</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((mapping) => (
                    <tr key={mapping.id} className="border-b border-border last:border-0">
                      <td className="py-2.5 pr-3">
                        <span className="font-medium text-ink">{mapping.itemNameTh}</span>
                        <span className="block text-xs text-ink-muted">
                          {mapping.itemCode}
                          {mapping.baseUnitCode ? ` · ${mapping.baseUnitCode}` : ""}
                          {mapping.isPreferred ? " · ผู้ขายหลัก" : ""}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-ink-muted">
                        {mapping.supplierItemCode ?? "-"}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {mapping.purchaseConversion ? formatQty(mapping.purchaseConversion) : "-"}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {formatQty(mapping.moq)}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {mapping.packSize ? formatQty(mapping.packSize) : "-"}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {mapping.leadTimeDays === null
                          ? `${supplier.leadTimeDays} วัน*`
                          : `${mapping.leadTimeDays} วัน`}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {mapping.lastPrice ? formatMoney(mapping.lastPrice) : "-"}
                      </td>
                      <td className="py-2.5 pr-3">
                        <ActiveBadge isActive={mapping.isActive} />
                      </td>
                      <td className="py-2.5 text-right">
                        <Button asChild size="sm" variant="link">
                          <Link href={`/suppliers/${supplier.id}/items/${mapping.id}`}>แก้ไข</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-ink-muted">* ใช้ค่า Lead Time จากผู้ขาย</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
