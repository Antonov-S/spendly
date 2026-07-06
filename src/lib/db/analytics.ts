import "server-only";

import { prisma } from "@/lib/prisma";
import type { AnalyticsProps } from "@/lib/analytics/events";

export async function getAnalyticsOptOut(userId: string): Promise<boolean | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { analyticsOptOut: true },
  });
  return user?.analyticsOptOut ?? null;
}

export async function persistEvent(
  userId: string,
  name: string,
  props: AnalyticsProps
): Promise<void> {
  await prisma.analyticsEvent.create({
    data: {
      userId,
      name,
      props,
    },
  });
}
