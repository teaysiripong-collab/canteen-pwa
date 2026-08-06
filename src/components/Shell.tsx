"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type NavItem = { href: string; label: string; icon: string };

export default function Shell({
  nav,
  userName,
  roleLabel,
  unreadCount,
  children,
}: {
  nav: NavItem[];
  userName: string;
  roleLabel: string;
  unreadCount: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const pathname = usePathname();
  const router = useRouter();

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  const NavLinks = (
    <nav className="flex-1 overflow-y-auto py-2">
      {nav.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
              active ? "bg-white/15 text-white border-l-4 border-amber-400" : "text-blue-100 hover:bg-white/10 border-l-4 border-transparent"
            }`}
          >
            <span className="text-lg">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex">
      {/* Sidebar — desktop */}
      <aside className="no-print hidden lg:flex w-60 flex-col bg-[#1e3a5f] shrink-0 sticky top-0 h-screen">
        <div className="px-4 py-5 border-b border-white/10">
          <Link href="/" className="text-white font-bold text-lg leading-tight block">🍳 Canteen MS</Link>
          <div className="text-blue-200 text-xs mt-1">ระบบบริหารงานแคนทีน</div>
        </div>
        {NavLinks}
      </aside>

      {/* Sidebar — mobile drawer */}
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-[#1e3a5f] flex flex-col">
            <div className="px-4 py-5 border-b border-white/10 flex items-center justify-between">
              <span className="text-white font-bold">🍳 Canteen MS</span>
              <button onClick={() => setOpen(false)} className="text-white text-xl px-2" aria-label="ปิดเมนู">✕</button>
            </div>
            {NavLinks}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="no-print sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-3">
          <button onClick={() => setOpen(true)} className="lg:hidden text-2xl px-1" aria-label="เปิดเมนู">☰</button>
          <form onSubmit={search} className="flex-1 max-w-md">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="🔍 ค้นหา… เช่น หมูบด, กะเพรา"
              className="w-full rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
            />
          </form>
          <Link href="/notifications" className="relative text-xl px-1" aria-label="การแจ้งเตือน">
            🔔
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </Link>
          <div className="hidden sm:block text-right leading-tight">
            <div className="text-sm font-semibold">{userName}</div>
            <div className="text-xs text-gray-500">{roleLabel}</div>
          </div>
          <form action="/api/auth/logout" method="post">
            <button className="text-sm text-gray-500 hover:text-red-600 px-2" title="ออกจากระบบ">ออก ⎋</button>
          </form>
        </header>

        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
