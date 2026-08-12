import { redirect } from "next/navigation";
import { BottomNavigation } from "@/components/layout/bottom-navigation";
import { DesktopHeader } from "@/components/layout/desktop-header";
import { MobileHeader } from "@/components/layout/mobile-header";
import { Sidebar } from "@/components/layout/sidebar";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-dvh">
      <Sidebar permissions={user.permissions} />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader
          userName={user.fullName}
          locationName={user.defaultLocationName}
          permissions={user.permissions}
        />
        <DesktopHeader
          userName={user.fullName}
          locationName={user.defaultLocationName}
          roleCodes={user.roleCodes}
        />

        <main className="flex-1 px-4 pb-24 pt-4 sm:px-6 sm:pb-8 lg:px-8 lg:pt-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>

        <BottomNavigation permissions={user.permissions} />
      </div>
    </div>
  );
}
