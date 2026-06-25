import "server-only";
import { prisma } from "@/lib/prisma";

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
 * The `User` columns `/settings` renders — now the sole account-management
 * surface (`/profile` is a redirect). One projection keeps the page's cards
 * agreeing about "the user". Returns null when the row is missing (the caller
 * redirects to sign-in).
 *
 * Every column is used: `password` gates the Security change-password card
 * (null ⇒ OAuth), `image` drives the Preferences avatar, `createdAt` the
 * "Member since" line, and the `isPro`/`stripe*` columns drive Billing. Add a
 * column only when a card renders it.
 */
export async function getUserOverview(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true, //                 identity / display name
      email: true, //                identity
      image: true, //                Preferences avatar
      password: true, //             Security: gates the change-password card (null ⇒ OAuth)
      isPro: true, //                Billing plan badge (DB read, S4)
      stripeCustomerId: true, //     Billing: drives the Free/Pro action branch (§8)
      stripeSubscriptionId: true, // Billing "subscription active" affordance (§8)
      createdAt: true, //            Preferences "member since"
    },
  });
}
