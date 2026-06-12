import "server-only";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/auth";

/**
 * Return the authenticated session in a server component, or redirect to the
 * sign-in page when there is none. The returned session has a guaranteed
 * `user.id`.
 */
export async function getSessionOrRedirect(
  redirectTo = "/sign-in"
): Promise<Session> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(redirectTo);
  }
  return session;
}

/**
 * Guard public-only pages (sign-in, register) from signed-in users by
 * redirecting them to the dashboard.
 */
export async function redirectIfAuthenticated(
  redirectTo = "/dashboard"
): Promise<void> {
  const session = await auth();
  if (session?.user) {
    redirect(redirectTo);
  }
}
