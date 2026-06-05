import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**"],
    // Required workaround: next-auth's next/server import fails under Node ESM
    // resolution and poisons sibling workers. Sequential + isolated per file prevents leakage.
    fileParallelism: false,
    isolate: true,
    clearMocks: true,
    restoreMocks: true,
  },
});
