import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma generated client
    "src/generated/**",
  ]),
  {
    // Enforce the export pure↔HTTP boundary (data-export-spec §7.0): route
    // handlers reach the DB ONLY through src/lib/db/export.ts, never Prisma
    // directly. Turns the rule from prose into a lint failure.
    files: ["src/app/api/export/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/prisma",
              message:
                "Export route handlers must go through src/lib/db/export.ts, not Prisma directly (data-export-spec §7.0).",
            },
          ],
          patterns: [
            {
              group: ["@/generated/prisma", "@/generated/prisma/*"],
              message:
                "Export route handlers must go through src/lib/db/export.ts, not the Prisma client directly (data-export-spec §7.0).",
            },
          ],
        },
      ],
    },
  },
  {
    // Same boundary for the Stripe webhook (stripe-billing-spec §12.6): the
    // route reaches the DB ONLY through src/lib/db/billing.ts, never Prisma.
    files: ["src/app/api/stripe/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/prisma",
              message:
                "Stripe route handlers must go through src/lib/db/billing.ts, not Prisma directly (stripe-billing-spec §12.6).",
            },
          ],
          patterns: [
            {
              group: ["@/generated/prisma", "@/generated/prisma/*"],
              message:
                "Stripe route handlers must go through src/lib/db/billing.ts, not the Prisma client directly (stripe-billing-spec §12.6).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
