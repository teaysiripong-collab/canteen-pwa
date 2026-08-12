import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { ActiveBadge } from "@/components/ui/status-badge";
import { UserActiveToggle } from "@/features/users/user-active-toggle";
import { UserForm } from "@/features/users/user-form";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { getMasterDataOptions } from "@/repositories/master-data-repository";
import { getUserById, listAssignableRoles } from "@/repositories/user-repository";

export const dynamic = "force-dynamic";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission(PERMISSIONS.USER_MANAGE);
  const { id } = await params;

  const [target, roles, options] = await Promise.all([
    getUserById(actor.organizationId, id),
    listAssignableRoles(),
    getMasterDataOptions(actor.organizationId),
  ]);

  if (!target) notFound();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={target.fullName}
        description={target.email}
        actions={
          <div className="flex items-center gap-3">
            <ActiveBadge isActive={target.isActive} />
            {actor.id === target.id ? null : (
              <UserActiveToggle userId={target.id} isActive={target.isActive} />
            )}
          </div>
        }
      />
      <UserForm
        roles={roles}
        locations={options.locations}
        values={{
          id: target.id,
          email: target.email,
          fullName: target.fullName,
          phone: target.phone,
          defaultLocationId: target.defaultLocationId,
          roleCodes: target.roleCodes,
          isActive: target.isActive,
        }}
      />
    </div>
  );
}
