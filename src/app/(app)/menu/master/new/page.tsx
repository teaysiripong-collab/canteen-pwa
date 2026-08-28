import { PageHeader } from "@/components/ui/page-header";
import { MenuForm } from "@/features/menu/menu-form";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { listMenuCategories } from "@/repositories/bom-repository";

export const dynamic = "force-dynamic";

export default async function NewMenuPage() {
  const user = await requirePagePermission(PERMISSIONS.MENU_MANAGE);
  const categories = await listMenuCategories(user.organizationId);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="เพิ่มเมนู" description="สร้างเมนูก่อน แล้วจึงกำหนดสูตร (BOM)" />
      <MenuForm categories={categories} />
    </div>
  );
}
