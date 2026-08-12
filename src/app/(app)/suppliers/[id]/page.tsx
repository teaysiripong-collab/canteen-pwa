import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { ActiveBadge } from "@/components/ui/status-badge";
import { SupplierForm } from "@/features/master-data/supplier-form";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { getSupplierById } from "@/repositories/master-data-repository";

export const dynamic = "force-dynamic";

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(PERMISSIONS.SUPPLIER_MANAGE);
  const { id } = await params;
  const supplier = await getSupplierById(user.organizationId, id);

  if (!supplier) notFound();

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
    </div>
  );
}
