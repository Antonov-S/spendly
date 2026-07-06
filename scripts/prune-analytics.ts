import "dotenv/config";

import { prisma } from "../src/lib/prisma";
import { ANALYTICS_RETENTION_DAYS } from "../src/lib/system-constants";

/**
 * Manual retention prune for the AnalyticsEvent table (POST-MVP §0, §6.1).
 *
 * Dry-run by default — mutates nothing, prints the target host, cutoff, and the
 * count of rows that WOULD be deleted. `--apply` performs the delete.
 *
 * Production safety (CLAUDE.md): the connection host is compared against the
 * known development endpoint. Any OTHER host is treated as production and
 * refuses to run — even with `--apply` — unless `--production` is also passed.
 * This encodes the "never touch production unless explicitly asked" rule into
 * the tool itself rather than relying on operator memory.
 *
 *   npx tsx scripts/prune-analytics.ts                 # dry run
 *   npx tsx scripts/prune-analytics.ts --apply         # delete (dev only)
 *   npx tsx scripts/prune-analytics.ts --apply --production   # delete (prod)
 */

// The development branch endpoint (from DATABASE_URL). Anything else is treated
// as production for safety.
const DEV_ENDPOINT_MARKER = "ep-nameless-resonance-aqvflbsf";

function parseHost(connectionString: string | undefined): string {
  if (!connectionString) return "(unknown — DATABASE_URL unset)";
  try {
    return new URL(connectionString).host;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const allowProduction = process.argv.includes("--production");

  const host = parseHost(process.env.DATABASE_URL);
  const looksProduction = !host.includes(DEV_ENDPOINT_MARKER);

  const cutoff = new Date(
    Date.now() - ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );

  console.log(`Target DB host:  ${host}`);
  console.log(
    `Environment:     ${looksProduction ? "PRODUCTION (or unknown)" : "development"}`
  );
  console.log(`Retention:       ${ANALYTICS_RETENTION_DAYS} days`);
  console.log(`Cutoff:          rows older than ${cutoff.toISOString()}`);

  if (looksProduction && apply && !allowProduction) {
    console.error(
      "\nRefusing to --apply against a non-development host without --production.\n" +
        "Re-run with --production only if you intend to prune the production branch."
    );
    process.exit(1);
  }

  const where = { createdAt: { lt: cutoff } };

  if (!apply) {
    const count = await prisma.analyticsEvent.count({ where });
    console.log(`\nDRY RUN — ${count} row(s) would be deleted.`);
    console.log("Re-run with --apply to delete them.");
    return;
  }

  const result = await prisma.analyticsEvent.deleteMany({ where });
  console.log(`\nDeleted ${result.count} analytics event row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
