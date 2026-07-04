import "dotenv/config";

import { prisma } from "../src/lib/prisma";

/**
 * Dev-only helper: give demo-pro an INCOME "Salary" recurring template so the
 * dashboard cash-flow forecast card shows the classic dip-then-recover shape
 * (subscriptions trickle the balance down, salary lands and jumps it back up).
 * Idempotent — reuses the template if it already exists.
 */
async function main() {
  const user = await prisma.user.findUnique({
    where: { email: "demo-pro@spendly.io" },
    select: { id: true },
  });
  if (!user) {
    console.log("demo-pro@spendly.io not found — run the seed first.");
    return;
  }

  const account = await prisma.financialAccount.findFirst({
    where: { userId: user.id, isArchived: false },
    orderBy: [{ type: "asc" }],
    select: { id: true, name: true, type: true },
  });
  if (!account) {
    console.log("demo-pro has no active financial account.");
    return;
  }

  // Land the salary ~3 weeks out so the line declines then jumps back up.
  const nextOccurrence = new Date(Date.UTC(2026, 6, 25)); // 2026-07-25

  const existing = await prisma.recurringTemplate.findFirst({
    where: { userId: user.id, name: "Salary", type: "INCOME" },
    select: { id: true },
  });

  if (existing) {
    await prisma.recurringTemplate.update({
      where: { id: existing.id },
      data: { isActive: true, nextOccurrence, amount: 2400, cadence: "MONTHLY" },
    });
    console.log(`Updated existing Salary template (${existing.id}).`);
    return;
  }

  const created = await prisma.recurringTemplate.create({
    data: {
      name: "Salary",
      type: "INCOME",
      amount: 2400,
      currency: "EUR",
      cadence: "MONTHLY",
      nextOccurrence,
      isActive: true,
      userId: user.id,
      financialAccountId: account.id,
    },
    select: { id: true },
  });

  console.log(
    `Created Salary template (${created.id}) on ${account.name} (${account.type}), ` +
      `+€2400 MONTHLY, next 2026-07-25.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
