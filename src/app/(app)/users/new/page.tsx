import { PageHeader } from "@/components/ui/page-header";
import { UserForm } from "@/features/users/user-form";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { getMasterDataOptions } from "@/repositories/master-data-repository";
import { listAssignableRoles } from "@/repositories/user-repository";

export const dynamic = "force-dynamic";

export default async function NewUserPage() {
  const actor = await requirePermission(PERMISSIONS.USER_MANAGE);
  const [roles, options] = await Promise.all([
    listAssignableRoles(),
    getMasterDataOptions(actor.organizationId),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="เพิ่มผู้ใช้งาน"
        description="กำหนดบทบาทเพื่อให้สิทธิ์การใช้งาน ระบบตรวจสอบสิทธิ์ที่เซิร์ฟเวอร์เสมอ"
      />
      <UserForm roles={roles} locations={options.locations} />
    </div>
  );
}
