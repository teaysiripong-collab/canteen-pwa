export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isSupabaseAuthConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

/**
 * Email-only sign-in used while Supabase Auth is not configured yet.
 * Hard-disabled in production builds so it can never ship as an authentication bypass.
 */
export function isDevAuthEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_AUTH === "true";
}

export const DEV_AUTH_COOKIE = "canteen_dev_user";
