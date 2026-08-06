import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { NAV_ITEMS, ROLE_LABEL, can } from "@/lib/rbac";
import { db } from "@/lib/db";
import Shell from "@/components/Shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const nav = NAV_ITEMS.filter((item) => can(session.role, item.key));
  const unreadCount = await db.notification.count({
    where: { userId: session.userId, readAt: null },
  });

  return (
    <Shell
      nav={nav.map(({ href, label, icon }) => ({ href, label, icon }))}
      userName={session.name}
      roleLabel={ROLE_LABEL[session.role]}
      unreadCount={unreadCount}
    >
      {children}
    </Shell>
  );
}
