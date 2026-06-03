import "dotenv/config";

import { prisma } from "../src/lib/prisma";

/**
 * Quick connectivity + sanity check against the database.
 * Run with: npx tsx scripts/test-db.ts  (or: npm run db:test)
 */
async function main() {
  console.log("Connecting to the database...");

  // 1. Raw round-trip — confirms the connection itself works.
  await prisma.$queryRaw`SELECT 1`;
  console.log("✓ Connection OK");

  // 2. Read through the Prisma client — confirms the schema is migrated.
  const categoryCount = await prisma.category.count();
  const systemCategories = await prisma.category.findMany({
    where: { isSystem: true },
    select: { name: true },
    orderBy: { name: "asc" },
  });

  console.log(`✓ Categories in database: ${categoryCount}`);
  console.log(
    `✓ System categories (${systemCategories.length}): ${systemCategories
      .map((c) => c.name)
      .join(", ")}`
  );

  // 3. Count the core tables so a fresh database reads as expected.
  const [users, accounts, transactions] = await Promise.all([
    prisma.user.count(),
    prisma.financialAccount.count(),
    prisma.transaction.count(),
  ]);

  console.log(
    `✓ Users: ${users} · Financial accounts: ${accounts} · Transactions: ${transactions}`
  );
  console.log("Database test complete.");
}

main()
  .catch((error) => {
    console.error("✗ Database test failed:");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
