import "server-only";
import { prisma } from "@/lib/prisma";
import type { ProfileStats } from "@/types/profile";

/** The minimal identity the app-shell sidebar renders. */
export interface SidebarUser {
  name: string | null;
  email: string | null;
  image: string | null;
}

/**
 * The sidebar identity, read fresh from the DB on every authenticated page.
 * The app uses a JWT session strategy, so `session.user.name` is frozen into the
 * token at sign-in — a later profile rename would not appear in the sidebar until
 * the next sign-in. Reading the row here keeps the sidebar always-current without
 * touching the token. Returns all-null when the row is missing (the page's auth
 * guard already redirects, so this is only a type-safety fallback).
 */
export async function getSidebarUser(userId: string): Promise<SidebarUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, image: true },
  });
  return {
    name: user?.name ?? null,
    email: user?.email ?? null,
    image: user?.image ?? null,
  };
}

/**
 * The `User` columns both `/profile` and `/settings` render. One projection so
 * the two surfaces can never silently disagree about "the user". Returns null
 * when the row is missing (each caller redirects to sign-in).
 *
 * The projection is a deliberate superset — `password`, `image`, and `createdAt`
 * exist only for `/profile` (change-password gating, avatar, member-since) and
 * `/settings` ignores them. Add a column only when one of the two pages renders
 * it; a third consumer with different needs is a signal to split, not widen.
 */
export async function getUserOverview(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true, //                 both: identity / display name
      email: true, //                both: identity
      image: true, //                /profile avatar
      password: true, //             /profile only: gates the change-password card (null ⇒ OAuth)
      isPro: true, //                /settings billing plan badge (DB read, S4)
      stripeCustomerId: true, //     /settings billing: drives the Free/Pro action branch (§8)
      stripeSubscriptionId: true, // /settings billing "subscription active" affordance (§8)
      preferredCurrency: true, //    /profile read-only row; /settings omits it
      createdAt: true, //            /profile "member since"
    },
  });
}

/**
 * Count the user's records by item type for the profile usage breakdown.
 * Transactions exclude soft-deleted rows to match what the user sees elsewhere.
 */
export async function getProfileStats(userId: string): Promise<ProfileStats> {
  const [financialAccounts, transactions, budgets, goals, recurringTemplates] =
    await Promise.all([
      prisma.financialAccount.count({ where: { userId } }),
      prisma.transaction.count({ where: { userId, deletedAt: null } }),
      prisma.budget.count({ where: { userId } }),
      prisma.goal.count({ where: { userId } }),
      prisma.recurringTemplate.count({ where: { userId } }),
    ]);

  return { financialAccounts, transactions, budgets, goals, recurringTemplates };
}
