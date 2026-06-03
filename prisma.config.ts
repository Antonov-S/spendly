import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations run against the direct (unpooled) Neon connection.
    // The runtime client connects through the pooled DATABASE_URL.
    url: env("DIRECT_URL"),
  },
});
