import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { ActiveBadge } from "@/components/ui/status-badge";
import { MenuForm } from "@/features/menu/menu-form";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { getMenuById, listMenuCategories } from "@/repositories/bom-repository";

export const dynamic = "force-dynamic";

export default async function EditMenuPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission(PERMISSIONS.MENU_MANAGE);
  const { id } = await params;

  const [menu, categories] = await Promise.all([
    getMenuById(user.organizationId, id),
    listMenuCategories(user.organizationId),
  ]);

  if (!menu) notFound();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={menu.nameTh}
        description={`รหัส ${menu.code}`}
        actions={<ActiveBadge isActive={menu.isActive} />}
      />
      <MenuForm
        categories={categories}
        values={{
          id: menu.id,
          code: menu.code,
          nameTh: menu.nameTh,
          nameEn: menu.nameEn,
          categoryId: menu.categoryId,
          isActive: menu.isActive,
          note: menu.note,
        }}
      />
    </div>
  );
}
