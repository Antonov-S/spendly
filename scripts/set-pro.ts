import "dotenv/config";

import { prisma } from "../src/lib/prisma";
import { looksProduction, parseHost } from "./db-env";

function argValue(name: string): string | null {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function parseEmail(): string {
  const email = argValue("email")?.trim().toLowerCase();
  if (!email) {
    throw new Error("--email is required");
  }
  return email;
}

function parseProFlag(): boolean {
  const raw = argValue("pro");
  if (raw === "on") return true;
  if (raw === "off") return false;
  throw new Error("--pro must be exactly 'on' or 'off'");
}

async function printLostPrecondition(userId: string) {
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { deletedAt: true, stripeSubscriptionId: true },
  });

  if (!current) {
    console.error("Refusing: user no longer exists.");
    return;
  }
  if (current.deletedAt) {
    console.error(
      `Refusing: user was soft-deleted at ${current.deletedAt.toISOString()}.`
    );
  }
  if (current.stripeSubscriptionId) {
    console.error("Refusing: user now has a live Stripe subscription link.");
  }
}

async function main() {
  const email = parseEmail();
  const isPro = parseProFlag();
  const apply = process.argv.includes("--apply");
  const allowProduction = process.argv.includes("--production");

  const host = parseHost(process.env.DATABASE_URL);
  const isProductionLike = looksProduction(host);

  console.log(`Target DB host:  ${host}`);
  console.log(
    `Environment:     ${isProductionLike ? "PRODUCTION (or unknown)" : "development"}`
  );
  console.log(`Mode:            ${apply ? "apply" : "dry run"}`);
  console.log(`Target email:    ${email}`);

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      isPro: true,
      deletedAt: true,
      stripeSubscriptionId: true,
      analyticsOptOut: true,
    },
  });

  if (!user) {
    console.error(`\nRefusing: no user found for ${email}.`);
    process.exit(1);
  }
  if (user.deletedAt) {
    console.error(
      `\nRefusing: ${user.email} is soft-deleted (${user.deletedAt.toISOString()}).`
    );
    process.exit(1);
  }
  if (user.stripeSubscriptionId) {
    console.error(
      `\nRefusing: ${user.email} has a Stripe subscription link; webhook owns isPro.`
    );
    process.exit(1);
  }
  if (user.isPro === isPro) {
    console.log(`\n${user.email} is already isPro = ${isPro}; nothing to do.`);
    return;
  }
  if (user.analyticsOptOut) {
    console.warn(
      "\nWARNING: this user has analyticsOptOut = true and will not generate reviewable telemetry."
    );
  }

  console.log(`\nisPro: ${user.isPro} -> ${isPro}`);

  if (!apply) {
    console.log("DRY RUN - no changes written. Re-run with --apply to update.");
    return;
  }

  if (isProductionLike && !allowProduction) {
    console.error(
      "\nRefusing to --apply against a non-development host without --production.\n" +
        "Re-run with --production only if you intend to update the production branch."
    );
    process.exit(1);
  }

  const result = await prisma.user.updateMany({
    where: {
      id: user.id,
      deletedAt: null,
      stripeSubscriptionId: null,
    },
    data: { isPro },
  });

  if (result.count === 0) {
    console.error(
      "\nRefusing: user state changed between the safety read and write."
    );
    await printLostPrecondition(user.id);
    process.exit(1);
  }

  console.log(`\nUpdated ${user.email}: isPro = ${isPro}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
