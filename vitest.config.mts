import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolves the "@/*" alias from tsconfig.json natively, no plugin needed.
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "lib/**/*.test.ts", "app/**/*.test.ts"],
    // Access-control tests share one database. Running files sequentially keeps
    // fixtures from colliding; correctness matters more than suite speed here.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
