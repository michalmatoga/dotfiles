import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["wo/__tests__/**/*.test.ts"],
    setupFiles: ["wo/__tests__/acceptance/setup.ts"],
    testTimeout: 30000, // 30s for acceptance tests hitting real backends
    hookTimeout: 30000,
    // Run test files sequentially to avoid state file conflicts
    fileParallelism: false,
  },
});
