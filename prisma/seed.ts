import "dotenv/config";

import bcrypt from "bcryptjs";

import { prisma } from "../src/lib/prisma";

// ─── System Categories ─────────────────────────────────────────────────────

const systemCategories = [
  // Core — shown in default onboarding preset
  { name: "Groceries", icon: "ShoppingCart", color: "#EF9F27" },
  { name: "Dining", icon: "UtensilsCrossed", color: "#D85A30" },
  { name: "Transport", icon: "Bus", color: "#7F77DD" },
  { name: "Housing", icon: "Home", color: "#1D9E75" },
  { name: "Utilities", icon: "Zap", color: "#F59E0B" },
  { name: "Health", icon: "Heart", color: "#D4537E" },
  { name: "Entertainment", icon: "Gamepad2", color: "#F97316" },
  { name: "Miscellaneous", icon: "MoreHorizontal", color: "#9CA3AF" },
  { name: "Salary", icon: "Briefcase", color: "#1D9E75" },
  { name: "Freelance", icon: "Laptop", color: "#10B981" },
  // Extended — available from category picker, not shown by default
  { name: "Subscriptions", icon: "Tv", color: "#378ADD" },
  { name: "Clothing", icon: "Shirt", color: "#888780" },
  { name: "Education", icon: "BookOpen", color: "#6366F1" },
  { name: "Insurance", icon: "Shield", color: "#64748B" },
  { name: "Gifts", icon: "Gift", color: "#EC4899" },
  { name: "Travel", icon: "Plane", color: "#0EA5E9" },
  { name: "Taxes", icon: "Landmark", color: "#6B7280" },
  { name: "Pets", icon: "PawPrint", color: "#92400E" },
  { name: "Investment", icon: "TrendingUp", color: "#F59E0B" },
  // Fallback — cannot be deleted; used when a category is removed
  { name: "Uncategorized", icon: "HelpCircle", color: "#D1D5DB" },
];

async function main() {
  // ─── System categories (idempotent) ──────────────────────────────────────

  let categoriesCreated = 0;
  for (const category of systemCategories) {
    const existing = await prisma.category.findFirst({
      where: { name: category.name, userId: null, isSystem: true },
    });
    if (!existing) {
      await prisma.category.create({
        data: { ...category, isSystem: true },
      });
      categoriesCreated++;
    }
  }
  console.log(
    `System categories: ${categoriesCreated} created, ${systemCategories.length - categoriesCreated} already present`
  );

  // Build name → id lookup for system categories
  const sysCats = await prisma.category.findMany({
    where: { isSystem: true, userId: null },
  });
  const cat = Object.fromEntries(sysCats.map((c) => [c.name, c.id]));

  const passwordHash = await bcrypt.hash("12345678", 12);
  const now = new Date();

  // ─── Demo Pro User ────────────────────────────────────────────────────────

  // Wipe and re-create so the seed is safe to re-run
  await prisma.user.deleteMany({ where: { email: "demo-pro@spendly.io" } });

  const proUser = await prisma.user.create({
    data: {
      email: "demo-pro@spendly.io",
      name: "Demo User Pro",
      password: passwordHash,
      isPro: true,
      emailVerified: now,
    },
  });

  const checking = await prisma.financialAccount.create({
    data: {
      name: "Checking",
      type: "CHECKING",
      currency: "USD",
      startingBalance: 1800,
      color: "#1D9E75",
      icon: "Wallet",
      userId: proUser.id,
    },
  });
  const savings = await prisma.financialAccount.create({
    data: {
      name: "Savings",
      type: "SAVINGS",
      currency: "USD",
      startingBalance: 1200,
      color: "#378ADD",
      icon: "PiggyBank",
      userId: proUser.id,
    },
  });
  const cash = await prisma.financialAccount.create({
    data: {
      name: "Cash",
      type: "CASH",
      currency: "USD",
      startingBalance: 150,
      color: "#EF9F27",
      icon: "Banknote",
      userId: proUser.id,
    },
  });
  const card = await prisma.financialAccount.create({
    data: {
      name: "Credit Card",
      type: "CREDIT_CARD",
      currency: "USD",
      startingBalance: 0,
      color: "#7F77DD",
      icon: "CreditCard",
      userId: proUser.id,
    },
  });

  // Amounts: positive = income, negative = expense.
  // Balance = startingBalance + SUM(amounts), matching schema comment.

  // April 2026
  await prisma.transaction.createMany({
    data: [
      { type: "INCOME", amount: 3200, currency: "USD", date: new Date("2026-04-01"), merchant: "Employer", userId: proUser.id, financialAccountId: checking.id, categoryId: cat["Salary"] },
      { type: "EXPENSE", amount: -650, currency: "USD", date: new Date("2026-04-01"), merchant: "Landlord", note: "April rent", userId: proUser.id, financialAccountId: checking.id, categoryId: cat["Housing"] },
      { type: "EXPENSE", amount: -19, currency: "USD", date: new Date("2026-04-03"), merchant: "Netflix", userId: proUser.id, financialAccountId: card.id, categoryId: cat["Subscriptions"] },
      { type: "EXPENSE", amount: -9, currency: "USD", date: new Date("2026-04-03"), merchant: "Spotify", userId: proUser.id, financialAccountId: card.id, categoryId: cat["Subscriptions"] },
      { type: "EXPENSE", amount: -115, currency: "USD", date: new Date("2026-04-05"), merchant: "Whole Foods", userId: proUser.id, financialAccountId: checking.id, categoryId: cat["Groceries"] },
      { type: "EXPENSE", amount: -22, currency: "USD", date: new Date("2026-04-08"), merchant: "Uber", userId: proUser.id, financialAccountId: card.id, categoryId: cat["Transport"] },
      { type: "EXPENSE", amount: -18, currency: "USD", date: new Date("2026-04-10"), merchant: "Chipotle", userId: proUser.id, financialAccountId: card.id, categoryId: cat["Dining"] },
      { type: "EXPENSE", amount: -34, currency: "USD", date: new Date("2026-04-12"), merchant: "CVS Pharmacy", userId: proUser.id, financialAccountId: card.id, categoryId: cat["Health"] },
      { type: "EXPENSE", amount: -90, currency: "USD", date: new Date("2026-04-14"), merchant: "Transit Authority", userId: proUser.id, financialAccountId: cash.id, categoryId: cat["Transport"] },
      { type: "EXPENSE", amount: -85, currency: "USD", date: new Date("2026-04-16"), merchant: "Trader Joe's", userId: proUser.id, financialAccountId: checking.id, categoryId: cat["Groceries"] },
      { type: "INCOME", amount: 800, currency: "USD", date: new Date("2026-04-18"), merchant: "Client ABC", note: "Design project", userId: proUser.id, financialAccountId: checking.id, categoryId: cat["Freelance"] },
      { type: "EXPENSE", amount: -55, currency: "USD", date: new Date("2026-04-20"), merchant: "The Grill", userId: proUser.id, financialAccountId: card.id, categoryId: cat["Dining"] },
      { type: "EXPENSE", amount: -75, currency: "USD", date: new Date("2026-04-22"), merchant: "Con Edison", userId: proUser.id, financialAccountId: checking.id, categoryId: cat["Utilities"] },
      { type: "EXPENSE", amount: -130, currency: "USD", date: new Date("2026-04-25"), merchant: "Costco", userId: proUser.id, financialAccountId: checking.id, categoryId: cat["Groceries"] },
      { type: "EXPENSE", amount: -35, currency: "USD", date: new Date("2026-04-28"), merchant: "AMC Theatres", userId: proUser.id, financialAccountId: card.id, categoryId: cat["Entertainment"] },
    ],
  });

  // May 2026
  await prisma.transaction.createMany({
    data: [
      { type: "INCOME", amount: 3200, currency: "USD", date: new Date("2026-05-01"), merchant: "Employer", userId: proUser.id, financialAccountId: checking.id, categoryId: cat["Salary"] },
      { type: "EXPENSE", amount: -650, currency: "USD", date: new Date("2026-05-01"), merchant: "Landlord", note: "May rent", userId: proUser.id, financialAccountId: checking.id, categoryId: cat["Housing"] },
      { type: "EXPENSE", amount: -19, currency: "USD", date: new Date("2026-05-02"), merchant: "Netflix", userId: proUser.id, financialAccountId: card.id, categoryId: cat["Subscriptions"] },
      { type: "EXPENSE", amount: -9, currency: "USD", date: new Date("2026-05-02"), merchant: "Spotify", userId: proUser.id, financialAccountId: card.id, categoryId: cat["Subscriptions"] },
      { type: "EXPENSE", amount: -92, currency: "USD", date: new Date("2026-05-05"), merchant: "Whole Foods", userId: proUser.id, financialAccountId: checking.id, categoryId: cat["Groceries"] },
      { type: "EXPENSE", amount: -18, currency: "USD", date: new Date("2026-05-08"), merchant: "Uber", userId: proUser.id, financialAccountId: card.id, categoryId: cat["Transport"] },
      { type: "EXPENSE", amount: -24, currency: "USD", date: new Date("2026-05-10"), merchant: "Pho 79", userId: proUser.id, financialAccountId: card.id, categoryId: cat["Dining"] },
      { type: "EXPENSE", amount: -45, currency: "USD", date: new Date("2026-05-12"), merchant: "Planet Fitness", userId: proUser.id, financialAccountId: card.id, categoryId: cat["Health"] },
      { type: "EXPENSE", amount: -90, currency: "USD", date: new Date("2026-05-15"), merchant: "Transit Authority", userId: proUser.id, financialAccountId: cash.id, categoryId: cat["Transport"] },
      { type: "EXPENSE", amount: -88, currency: "USD", date: new Date("2026-05-18"), merchant: "Trader Joe's", userId: proUser.id, financialAccountId: checking.id, categoryId: cat["Groceries"] },
      { type: "EXPENSE", amount: -62, currency: "USD", date: new Date("2026-05-20"), merchant: "Nobu", userId: proUser.id, financialAccountId: card.id, categoryId: cat["Dining"] },
      { type: "EXPENSE", amount: -65, currency: "USD", date: new Date("2026-05-22"), merchant: "City Water", userId: proUser.id, financialAccountId: checking.id, categoryId: cat["Utilities"] },
      { type: "EXPENSE", amount: -78, currency: "USD", date: new Date("2026-05-25"), merchant: "Supermarket", userId: proUser.id, financialAccountId: checking.id, categoryId: cat["Groceries"] },
      { type: "EXPENSE", amount: -90, currency: "USD", date: new Date("2026-05-26"), merchant: "Ticketmaster", userId: proUser.id, financialAccountId: card.id, categoryId: cat["Entertainment"] },
      { type: "EXPENSE", amount: -50, currency: "USD", date: new Date("2026-05-28"), merchant: "Urgent Care", userId: proUser.id, financialAccountId: card.id, categoryId: cat["Health"] },
    ],
  });

  // June 2026 (current month)
  await prisma.transaction.createMany({
    data: [
      { type: "INCOME", amount: 3200, currency: "USD", date: new Date("2026-06-01"), merchant: "Employer", userId: proUser.id, financialAccountId: checking.id, categoryId: cat["Salary"] },
      { type: "EXPENSE", amount: -650, currency: "USD", date: new Date("2026-06-01"), merchant: "Landlord", note: "June rent", userId: proUser.id, financialAccountId: checking.id, categoryId: cat["Housing"] },
      { type: "EXPENSE", amount: -19, currency: "USD", date: new Date("2026-06-02"), merchant: "Netflix", userId: proUser.id, financialAccountId: card.id, categoryId: cat["Subscriptions"] },
      { type: "EXPENSE", amount: -9, currency: "USD", date: new Date("2026-06-02"), merchant: "Spotify", userId: proUser.id, financialAccountId: card.id, categoryId: cat["Subscriptions"] },
      { type: "EXPENSE", amount: -60, currency: "USD", date: new Date("2026-06-03"), merchant: "Transit Authority", userId: proUser.id, financialAccountId: cash.id, categoryId: cat["Transport"] },
      { type: "EXPENSE", amount: -8, currency: "USD", date: new Date("2026-06-03"), merchant: "Starbucks", userId: proUser.id, financialAccountId: card.id, categoryId: cat["Dining"] },
      { type: "EXPENSE", amount: -47, currency: "USD", date: new Date("2026-06-04"), merchant: "Whole Foods", userId: proUser.id, financialAccountId: checking.id, categoryId: cat["Groceries"] },
    ],
  });

  // Budgets — June 2026
  await prisma.budget.createMany({
    data: [
      { amount: 700, currency: "USD", month: 6, year: 2026, userId: proUser.id, categoryId: cat["Groceries"] },
      { amount: 200, currency: "USD", month: 6, year: 2026, userId: proUser.id, categoryId: cat["Dining"] },
      { amount: 500, currency: "USD", month: 6, year: 2026, userId: proUser.id, categoryId: cat["Transport"] },
      { amount: 700, currency: "USD", month: 6, year: 2026, userId: proUser.id, categoryId: cat["Housing"] },
      { amount: 300, currency: "USD", month: 6, year: 2026, userId: proUser.id, categoryId: cat["Health"] },
      { amount: 100, currency: "USD", month: 6, year: 2026, userId: proUser.id, categoryId: cat["Subscriptions"] },
      { amount: 150, currency: "USD", month: 6, year: 2026, userId: proUser.id, categoryId: cat["Entertainment"] },
    ],
  });

  // Goals
  const japanTrip = await prisma.goal.create({
    data: {
      name: "Japan Trip",
      targetAmount: 5000,
      currentAmount: 2400,
      currency: "USD",
      targetDate: new Date("2026-12-01"),
      userId: proUser.id,
    },
  });
  await prisma.goalContribution.createMany({
    data: [
      { amount: 1000, date: new Date("2026-04-01"), goalId: japanTrip.id },
      { amount: 800, date: new Date("2026-05-01"), goalId: japanTrip.id },
      { amount: 600, date: new Date("2026-06-01"), goalId: japanTrip.id },
    ],
  });

  const emergencyFund = await prisma.goal.create({
    data: {
      name: "Emergency Fund",
      targetAmount: 10000,
      currentAmount: 3800,
      currency: "USD",
      userId: proUser.id,
    },
  });
  await prisma.goalContribution.createMany({
    data: [
      { amount: 1500, date: new Date("2026-03-01"), goalId: emergencyFund.id },
      { amount: 1200, date: new Date("2026-04-01"), goalId: emergencyFund.id },
      { amount: 1100, date: new Date("2026-05-01"), goalId: emergencyFund.id },
    ],
  });

  const newLaptop = await prisma.goal.create({
    data: {
      name: "New Laptop",
      targetAmount: 1500,
      currentAmount: 900,
      currency: "USD",
      targetDate: new Date("2026-09-01"),
      userId: proUser.id,
    },
  });
  await prisma.goalContribution.createMany({
    data: [
      { amount: 500, date: new Date("2026-04-15"), goalId: newLaptop.id },
      { amount: 400, date: new Date("2026-05-15"), goalId: newLaptop.id },
    ],
  });

  console.log("Demo pro user seeded");

  // ─── Demo Nonpro User ──────────────────────────────────────────────────────

  await prisma.user.deleteMany({ where: { email: "demo-nonpro@spendly.io" } });

  const nonproUser = await prisma.user.create({
    data: {
      email: "demo-nonpro@spendly.io",
      name: "Demo User Free",
      password: passwordHash,
      isPro: false,
      emailVerified: now,
    },
  });

  const nChecking = await prisma.financialAccount.create({
    data: {
      name: "Checking",
      type: "CHECKING",
      currency: "USD",
      startingBalance: 1200,
      color: "#1D9E75",
      icon: "Wallet",
      userId: nonproUser.id,
    },
  });
  const nCard = await prisma.financialAccount.create({
    data: {
      name: "Credit Card",
      type: "CREDIT_CARD",
      currency: "USD",
      startingBalance: 0,
      color: "#7F77DD",
      icon: "CreditCard",
      userId: nonproUser.id,
    },
  });

  await prisma.transaction.createMany({
    data: [
      { type: "INCOME", amount: 2800, currency: "USD", date: new Date("2026-06-01"), merchant: "Employer", userId: nonproUser.id, financialAccountId: nChecking.id, categoryId: cat["Salary"] },
      { type: "EXPENSE", amount: -800, currency: "USD", date: new Date("2026-06-01"), merchant: "Landlord", note: "June rent", userId: nonproUser.id, financialAccountId: nChecking.id, categoryId: cat["Housing"] },
      { type: "EXPENSE", amount: -65, currency: "USD", date: new Date("2026-06-02"), merchant: "Supermarket", userId: nonproUser.id, financialAccountId: nChecking.id, categoryId: cat["Groceries"] },
      { type: "EXPENSE", amount: -15, currency: "USD", date: new Date("2026-06-03"), merchant: "Subway", userId: nonproUser.id, financialAccountId: nCard.id, categoryId: cat["Dining"] },
      { type: "EXPENSE", amount: -45, currency: "USD", date: new Date("2026-06-04"), merchant: "Transit Authority", userId: nonproUser.id, financialAccountId: nChecking.id, categoryId: cat["Transport"] },
    ],
  });

  await prisma.budget.createMany({
    data: [
      { amount: 500, currency: "USD", month: 6, year: 2026, userId: nonproUser.id, categoryId: cat["Groceries"] },
      { amount: 850, currency: "USD", month: 6, year: 2026, userId: nonproUser.id, categoryId: cat["Housing"] },
      { amount: 200, currency: "USD", month: 6, year: 2026, userId: nonproUser.id, categoryId: cat["Transport"] },
    ],
  });

  const vacationFund = await prisma.goal.create({
    data: {
      name: "Vacation Fund",
      targetAmount: 2000,
      currentAmount: 400,
      currency: "USD",
      targetDate: new Date("2026-12-01"),
      userId: nonproUser.id,
    },
  });
  await prisma.goalContribution.createMany({
    data: [{ amount: 400, date: new Date("2026-05-01"), goalId: vacationFund.id }],
  });

  console.log("Demo nonpro user seeded");
  console.log("Seed complete");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
