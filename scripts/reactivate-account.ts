import "dotenv/config";

import { prisma } from "../src/lib/prisma";

async function main() {
  const deleted = await prisma.user.findMany({
    where: { deletedAt: { not: null } },
    select: { id: true, email: true, deletedAt: true },
  });

  if (deleted.length === 0) {
    console.log("No soft-deleted accounts found.");
    return;
  }

  console.log("Soft-deleted accounts:");
  for (const u of deleted) {
    console.log(`  - ${u.email} (deletedAt: ${u.deletedAt?.toISOString()})`);
  }

  const result = await prisma.user.updateMany({
    where: { deletedAt: { not: null } },
    data: { deletedAt: null },
  });

  console.log(`\nReactivated ${result.count} account(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
