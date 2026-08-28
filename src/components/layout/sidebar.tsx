"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SIDEBAR_GROUPS, visibleNavItems } from "@/config/navigation";
import { cn } from "@/lib/utils";

export function Sidebar({ permissions }: { permissions: string[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="เมนูหลัก"
      className="hidden w-64 shrink-0 overflow-y-auto border-r border-border bg-surface px-3 py-4 lg:block"
    >
      <div className="px-2 pb-4">
        <p className="text-sm font-semibold text-brand">Canteen ERP</p>
        <p className="text-xs text-ink-subtle">ระบบบริหารโรงอาหาร</p>
      </div>

      {SIDEBAR_GROUPS.map((group) => {
        const items = visibleNavItems(group.items, permissions);
        if (items.length === 0) return null;

        return (
          <div key={group.label} className="mb-4">
            <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              {group.label}
            </p>
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block rounded-[var(--radius-control)] px-2.5 py-2 text-sm",
                        active
                          ? "bg-brand-soft font-medium text-brand"
                          : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
