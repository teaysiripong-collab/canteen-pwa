import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { MovementList } from "@/features/inventory/movement-list";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { listStockLocations, listStockMovements } from "@/repositories/inventory-repository";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePagePermission(PERMISSIONS.STOCK_VIEW);
  const params = await searchParams;

  const locationId = typeof params.location === "string" ? params.location : undefined;
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const [locationOptions, { rows, total }] = await Promise.all([
    listStockLocations(user.organizationId),
    listStockMovements(user.organizationId, { locationId, page, pageSize: PAGE_SIZE }),
  ]);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="บัญชีเคลื่อนไหวสต๊อก"
        description={`${total} รายการ · บันทึกแบบ append-only แก้ไขไม่ได้ ถ้าผิดต้องกลับรายการ`}
      />

      <FilterBar
        searchPlaceholder="ค้นหาไม่รองรับในหน้านี้ ใช้ตัวกรองด้านขวา"
        selects={[
          {
            name: "location",
            label: "สถานที่",
            options: [
              { value: "", label: "ทุกสถานที่" },
              ...locationOptions.map((location) => ({
                value: location.id,
                label: `${location.code} · ${location.nameTh}`,
              })),
            ],
          },
        ]}
      />

      <Card>
        <CardContent>
          <MovementList rows={rows} />
        </CardContent>
      </Card>

      {lastPage > 1 ? (
        <nav className="flex items-center justify-between text-sm" aria-label="แบ่งหน้า">
          <PageLink
            href={`/inventory/movements?${new URLSearchParams({
              ...(locationId ? { location: locationId } : {}),
              page: String(page - 1),
            })}`}
            disabled={page <= 1}
          >
            ก่อนหน้า
          </PageLink>
          <span className="text-ink-muted">
            หน้า {page} จาก {lastPage}
          </span>
          <PageLink
            href={`/inventory/movements?${new URLSearchParams({
              ...(locationId ? { location: locationId } : {}),
              page: String(page + 1),
            })}`}
            disabled={page >= lastPage}
          >
            ถัดไป
          </PageLink>
        </nav>
      ) : null}
    </div>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="text-ink-subtle">{children}</span>;
  }
  return (
    <Link href={href} className="text-brand underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}
