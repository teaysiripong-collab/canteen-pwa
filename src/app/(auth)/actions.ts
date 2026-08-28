"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/database/client";
import { users } from "@/database/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { actionSuccess, toActionError, AppError, type ActionResult } from "@/lib/errors";
import { DEV_AUTH_COOKIE, isDevAuthEnabled, isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/services/audit-service";

async function recordLogin(email: string) {
  const [account] = await db
    .select({ id: users.id, organizationId: users.organizationId })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!account) return;

  await writeAuditLog(db, {
    organizationId: account.organizationId,
    userId: account.id,
    action: "LOGIN",
    entityType: "user",
    entityId: account.id,
  });
}

export async function signInAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    const password = String(formData.get("password") ?? "");

    if (!email) {
      throw new AppError("VALIDATION", "กรุณากรอกอีเมล", {
        fieldErrors: { email: ["กรุณากรอกอีเมล"] },
      });
    }

    const supabase = await createSupabaseServerClient();

    if (supabase) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        throw new AppError("UNAUTHENTICATED", "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
      }
    } else if (isDevAuthEnabled()) {
      const [account] = await db
        .select({ id: users.id, isActive: users.isActive })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!account || !account.isActive) {
        throw new AppError("UNAUTHENTICATED", "ไม่พบผู้ใช้งานนี้ในระบบ");
      }

      const cookieStore = await cookies();
      cookieStore.set(DEV_AUTH_COOKIE, email, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 8,
      });
    } else {
      throw new AppError("INTERNAL", "ระบบยังไม่ได้ตั้งค่าการเข้าสู่ระบบ กรุณาติดต่อผู้ดูแลระบบ");
    }

    await recordLogin(email);
    return actionSuccess();
  } catch (error) {
    return toActionError(error);
  }
}

export async function signOutAction(): Promise<void> {
  const user = await getCurrentUser();

  if (user) {
    await writeAuditLog(db, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "LOGOUT",
      entityType: "user",
      entityId: user.id,
    });
  }

  if (isSupabaseAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase?.auth.signOut();
  }

  const cookieStore = await cookies();
  cookieStore.delete(DEV_AUTH_COOKIE);

  redirect("/login");
}
