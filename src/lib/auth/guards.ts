import "server-only";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { getActiveAccountCount } from "@/lib/db/accounts";

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

/**
 * Guard for data surfaces: require a session AND at least one active account.
 * A signed-in user with zero active accounts is redirected to /onboarding so
 * the first-run flow can guide them. Returns the session (with guaranteed
 * `user.id`) for the page to use.
 *
 * "Onboarded" is derived from the active-account count, not a stored flag, so
 * a user who archives their last account correctly re-enters the flow.
 */
export async function requireOnboarded(): Promise<Session> {
  const session = await getSessionOrRedirect();
  const count = await getActiveAccountCount(session.user.id);
  if (count === 0) {
    redirect("/onboarding");
  }
  return session;
}

/**
 * Reverse guard for /onboarding itself: a user who already has an active
 * account has finished onboarding — send them to the dashboard so the flow
 * can't re-run. The exact complement of `requireOnboarded` on the same signal.
 */
export async function redirectIfOnboarded(): Promise<Session> {
  const session = await getSessionOrRedirect();
  const count = await getActiveAccountCount(session.user.id);
  if (count > 0) {
    redirect("/dashboard");
  }
  return session;
}
