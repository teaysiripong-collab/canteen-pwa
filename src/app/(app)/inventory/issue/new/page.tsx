import { PageHeader } from "@/components/ui/page-header";
import { IssueForm } from "@/features/issue/issue-form";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { listMenus } from "@/repositories/bom-repository";
import { listStockLocations } from "@/repositories/inventory-repository";
import { listQuerySchema } from "@/schemas/common";
import { listMealPeriods } from "@/services/bom-service";

export const dynamic = "force-dynamic";

export default async function NewIssuePage() {
  const user = await requirePermission(PERMISSIONS.ISSUE_CREATE);

  const [locations, periods, menuRows] = await Promise.all([
    listStockLocations(user.organizationId),
    listMealPeriods(user.organizationId),
    listMenus(user.organizationId, listQuerySchema.parse({})),
  ]);

  // Only menus with a published recipe can be issued against.
  const menus = menuRows
    .filter((menu) => menu.publishedVersion !== null)
    .map((menu) => ({ id: menu.id, code: menu.code, nameTh: menu.nameTh }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="เบิกสินค้า"
        description="เลือกมื้อและเมนู ระบบจะดึงวัตถุดิบตามสูตรมาให้ แก้เฉพาะที่ใช้จริงไม่ตรงสูตร"
      />
      <IssueForm
        locations={locations}
        periods={periods}
        menus={menus}
        defaultLocationId={user.defaultLocationId}
        canAdjust={hasPermission(user.permissions, PERMISSIONS.ISSUE_ADJUST_QTY)}
      />
    </div>
  );
}
