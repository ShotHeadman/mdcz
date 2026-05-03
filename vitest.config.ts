import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "apps/desktop/src/renderer/src"),
      "@main": resolve(__dirname, "apps/desktop/src/main"),
      "@renderer": resolve(__dirname, "apps/desktop/src/renderer/src"),
      "@mdcz/persistence": resolve(__dirname, "packages/persistence/src/index.ts"),
      "@mdcz/persistence/test": resolve(__dirname, "packages/persistence/src/testDatabase.ts"),
      "@mdcz/shared": resolve(__dirname, "packages/shared"),
      "@mdcz/storage": resolve(__dirname, "packages/storage/src/index.ts"),
      electron: resolve(__dirname, "tests/unit/electronMock.ts"),
      impit: resolve(__dirname, "tests/unit/impitMock.ts"),
      "mediainfo.js": resolve(__dirname, "tests/unit/mediaInfoMock.ts"),
    },
  },
  test: {
    server: {
      deps: {
        inline: ["@egoist/tipc"],
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "apps/**/*.test.ts", "packages/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/unit/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          testTimeout: 120000,
          exclude: process.env.CI ? ["tests/integration/crawlers/**"] : [],
        },
      },
    ],
  },
});
