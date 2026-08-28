"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, Boxes, Home, PackageMinus, PackagePlus } from "lucide-react";
import { MOBILE_NAV_ITEMS, visibleNavItems } from "@/config/navigation";
import { cn } from "@/lib/utils";

const ICONS = {
  home: Home,
  receive: PackagePlus,
  issue: PackageMinus,
  transfer: ArrowLeftRight,
  stock: Boxes,
} as const;

export function BottomNavigation({ permissions }: { permissions: string[] }) {
  const pathname = usePathname();
  const items = visibleNavItems(MOBILE_NAV_ITEMS, permissions);

  return (
    <nav
      aria-label="เมนูด่วน"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="flex">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = pathname === item.href;

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 py-2",
                  active ? "text-brand" : "text-ink-muted",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                <span className="text-[0.7rem] leading-tight">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
