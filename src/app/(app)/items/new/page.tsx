import { PageHeader } from "@/components/ui/page-header";
import { ItemForm } from "@/features/master-data/item-form";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { getMasterDataOptions } from "@/repositories/master-data-repository";

export const dynamic = "force-dynamic";

export default async function NewItemPage() {
  const user = await requirePermission(PERMISSIONS.ITEM_MANAGE);
  const options = await getMasterDataOptions(user.organizationId);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="เพิ่มวัตถุดิบ" description="กำหนดหน่วยหลักให้ถูกต้อง เพราะสต๊อกทั้งระบบใช้หน่วยนี้" />
      <ItemForm options={options} />
    </div>
  );
}
