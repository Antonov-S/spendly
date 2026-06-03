import "dotenv/config";

import { prisma } from "../src/lib/prisma";

// All 20 categories are seeded. The "Personal" onboarding preset surfaces
// only the most common ones by default; the rest are available to add but
// not shown until needed.
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
  let created = 0;

  for (const category of systemCategories) {
    // Compound unique [name, userId] can't be queried with a null userId,
    // so check for the existing system row explicitly before creating.
    const existing = await prisma.category.findFirst({
      where: { name: category.name, userId: null, isSystem: true },
    });

    if (!existing) {
      await prisma.category.create({
        data: { ...category, isSystem: true },
      });
      created += 1;
    }
  }

  console.log(
    `Seed complete: ${created} system categories created, ${
      systemCategories.length - created
    } already present.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
