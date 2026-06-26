import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * AI-layer's own `{ isPro }` read — a near-clone of `getReportProfile`, kept
 * here so the AI surface owns its Pro gate (no cross-import into Reports). Read
 * fresh from the DB on every call; the gate must never trust the JWT.
 */
export async function getAiProfile(
  userId: string
): Promise<{ isPro: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPro: true },
  });
  return { isPro: user?.isPro ?? false };
}
