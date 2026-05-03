import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@main", replacement: resolve(__dirname, "apps/desktop/src/main") },
      { find: "@renderer", replacement: resolve(__dirname, "apps/desktop/src/renderer/src") },
      { find: "@mdcz/persistence/test", replacement: resolve(__dirname, "packages/persistence/src/testDatabase.ts") },
      { find: "@mdcz/persistence", replacement: resolve(__dirname, "packages/persistence/src/index.ts") },
      { find: /^@mdcz\/runtime\/(.+)$/, replacement: resolve(__dirname, "packages/runtime/src/$1") },
      { find: "@mdcz/runtime", replacement: resolve(__dirname, "packages/runtime/src/index.ts") },
      { find: "@mdcz/shared", replacement: resolve(__dirname, "packages/shared") },
      { find: "@mdcz/storage", replacement: resolve(__dirname, "packages/storage/src/index.ts") },
      { find: "electron", replacement: resolve(__dirname, "tests/unit/electronMock.ts") },
      { find: "impit", replacement: resolve(__dirname, "tests/unit/impitMock.ts") },
      { find: "mediainfo.js", replacement: resolve(__dirname, "tests/unit/mediaInfoMock.ts") },
      { find: "@", replacement: resolve(__dirname, "apps/desktop/src/renderer/src") },
    ],
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
