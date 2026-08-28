import { LogOut, MapPin } from "lucide-react";
import { signOutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ROLE_LABELS_TH, type RoleCode } from "@/lib/permissions";

export function DesktopHeader({
  userName,
  locationName,
  roleCodes,
}: {
  userName: string;
  locationName: string | null;
  roleCodes: RoleCode[];
}) {
  return (
    <header className="hidden h-16 shrink-0 items-center justify-between border-b border-border bg-surface px-6 lg:flex">
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <MapPin className="h-4 w-4" aria-hidden />
        <span>{locationName ?? "ทุกสถานที่"}</span>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-medium text-ink">{userName}</p>
          <div className="mt-0.5 flex justify-end gap-1">
            {roleCodes.map((role) => (
              <StatusBadge key={role} tone="info">
                {ROLE_LABELS_TH[role] ?? role}
              </StatusBadge>
            ))}
          </div>
        </div>
        <form action={signOutAction}>
          <Button type="submit" variant="ghost" size="sm">
            <LogOut className="h-4 w-4" aria-hidden />
            ออกจากระบบ
          </Button>
        </form>
      </div>
    </header>
  );
}
