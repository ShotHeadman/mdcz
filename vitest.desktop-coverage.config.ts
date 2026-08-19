import { defineConfig } from "vitest/config";
import { unitRuntimeAliases, workspaceAliases } from "./vitest.config";

export default defineConfig({
  resolve: {
    alias: [...workspaceAliases, ...unitRuntimeAliases],
  },
  test: {
    include: ["tests/desktop-integration/**/*.test.ts", "tests/unit/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/unit/setup.ts"],
    testTimeout: 120_000,
    server: {
      deps: {
        inline: ["@egoist/tipc"],
      },
    },
    coverage: {
      provider: "v8",
      include: ["apps/desktop/src/main/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/*.testSupport.ts"],
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "coverage/desktop-main",
      reportOnFailure: true,
      thresholds: {
        statements: 50,
        branches: 40,
        functions: 55,
        lines: 50,
      },
    },
  },
});
