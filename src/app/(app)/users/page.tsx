import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ItemCard } from "@/components/ui/cards";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { ActiveBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS, ROLE_LABELS_TH, type RoleCode } from "@/lib/permissions";
import { listUsers } from "@/repositories/user-repository";
import { listQuerySchema } from "@/schemas/common";

export const dynamic = "force-dynamic";

function roleSummary(roleCodes: RoleCode[]): string {
  if (roleCodes.length === 0) return "ยังไม่กำหนดบทบาท";
  return roleCodes.map((code) => ROLE_LABELS_TH[code] ?? code).join(", ");
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePagePermission(PERMISSIONS.USER_MANAGE);
  const query = listQuerySchema.parse(await searchParams);
  const rows = await listUsers(user.organizationId, query);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="ผู้ใช้งาน"
        description={`ทั้งหมด ${rows.length} บัญชี`}
        actions={
          <Button asChild>
            <Link href="/users/new">
              <Plus className="h-4 w-4" aria-hidden />
              เพิ่มผู้ใช้งาน
            </Link>
          </Button>
        }
      />

      <FilterBar
        searchPlaceholder="ค้นหาด้วยชื่อหรืออีเมล"
        selects={[
          {
            name: "status",
            label: "สถานะ",
            defaultValue: "active",
            options: [
              { value: "active", label: "ใช้งานอยู่" },
              { value: "inactive", label: "ปิดใช้งาน" },
              { value: "all", label: "ทั้งหมด" },
            ],
          },
        ]}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="ยังไม่มีผู้ใช้งาน"
            description="เพิ่มบัญชีและกำหนดบทบาทเพื่อให้พนักงานเข้าใช้ระบบได้"
          />
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <ItemCard
              key={row.id}
              href={`/users/${row.id}`}
              title={row.fullName}
              subtitle={row.email}
              badge={<ActiveBadge isActive={row.isActive} />}
              meta={
                <span>
                  {roleSummary(row.roleCodes)}
                  {row.defaultLocationName ? ` · ${row.defaultLocationName}` : ""}
                </span>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
