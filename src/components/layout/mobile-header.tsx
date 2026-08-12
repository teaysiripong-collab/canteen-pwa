"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { SIDEBAR_GROUPS, visibleNavItems } from "@/config/navigation";
import { IconButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function MobileHeader({
  userName,
  locationName,
  permissions,
}: {
  userName: string;
  locationName: string | null;
  permissions: string[];
}) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface lg:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{userName}</p>
          <p className="truncate text-xs text-ink-subtle">{locationName ?? "ยังไม่ได้ตั้งสถานที่หลัก"}</p>
        </div>
        <IconButton
          label={open ? "ปิดเมนู" : "เปิดเมนู"}
          onClick={() => setOpen((previous) => !previous)}
        >
          {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
        </IconButton>
      </div>

      {open ? (
        <div className="max-h-[70vh] overflow-y-auto border-t border-border px-4 py-3">
          {SIDEBAR_GROUPS.map((group) => {
            const items = visibleNavItems(group.items, permissions).filter((item) => !item.phase);
            if (items.length === 0) return null;
            return (
              <div key={group.label} className="mb-3">
                <p className="pb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  {group.label}
                </p>
                <ul className="flex flex-col">
                  {items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          "block rounded-[var(--radius-control)] px-2 py-3 text-[0.95rem]",
                          pathname === item.href ? "bg-brand-soft text-brand" : "text-ink",
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}
    </header>
  );
}
