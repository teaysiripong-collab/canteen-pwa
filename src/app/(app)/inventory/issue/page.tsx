import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ItemCard } from "@/components/ui/cards";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { listStockIssues } from "@/repositories/issue-repository";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePagePermission(PERMISSIONS.STOCK_VIEW);
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const { rows, total } = await listStockIssues(user.organizationId, { page });
  const canIssue = hasPermission(user.permissions, PERMISSIONS.ISSUE_CREATE);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="เบิกสินค้า"
        description={`${total} ใบเบิก`}
        actions={
          canIssue ? (
            <Button asChild>
              <Link href="/inventory/issue/new">
                <Plus className="h-4 w-4" aria-hidden />
                เบิกของใหม่
              </Link>
            </Button>
          ) : null
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="ยังไม่มีใบเบิก"
            description="เมื่อเบิกของตามเมนู ระบบจะบันทึกทั้งจำนวนตามสูตรและจำนวนที่ใช้จริง"
          />
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <ItemCard
              key={row.id}
              href={`/inventory/issue/${row.id}`}
              title={row.issueNumber}
              subtitle={`${row.menuNameTh ?? "เบิกทั่วไป"}${row.periodNameTh ? ` · ${row.periodNameTh}` : ""}`}
              badge={<StatusBadge tone="success">เบิกแล้ว</StatusBadge>}
              meta={
                <span>
                  {dateFormatter.format(row.issuedAt)} · {row.locationCode} · {row.lineCount} รายการ
                  {row.userName ? ` · ${row.userName}` : ""}
                </span>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
