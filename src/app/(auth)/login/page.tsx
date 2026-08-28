import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { isDevAuthEnabled, isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-muted px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-brand">Canteen ERP</h1>
          <p className="mt-1 text-sm text-ink-muted">ระบบบริหารโรงอาหาร</p>
        </div>
        <LoginForm
          devMode={!isSupabaseAuthConfigured() && isDevAuthEnabled()}
          configured={isSupabaseAuthConfigured() || isDevAuthEnabled()}
        />
      </div>
    </main>
  );
}
