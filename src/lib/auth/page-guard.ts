import { forbidden, unauthorized } from "next/navigation";
import { getCurrentUser, type SessionUser } from "@/lib/auth/session";
import { hasPermission, type PermissionCode } from "@/lib/permissions";

/**
 * Page-level authorization.
 *
 * Services throw `AppError("FORBIDDEN")`, which is the right answer for a server action: the
 * action catches it and hands the client a typed result. A page is different — a thrown error
 * renders the error boundary with HTTP 500, so a browser, a crawler, a monitor and a load
 * balancer all read "the server is broken" when the truth is "you may not see this".
 *
 * `forbidden()` and `unauthorized()` are Next's control-flow signals: they render the matching
 * boundary with a 403 or 401 status. They throw internally and must never be caught, which is
 * why the check is written as a plain conditional rather than a try/catch around
 * `requirePermission`.
 *
 * The service call underneath still re-checks. This guard makes the answer honest; it is not
 * what makes it safe.
 */
export async function requirePageUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) unauthorized();
  return user;
}

export async function requirePagePermission(
  required: PermissionCode | PermissionCode[],
): Promise<SessionUser> {
  const user = await requirePageUser();
  if (!hasPermission(user.permissions, required)) forbidden();
  return user;
}
