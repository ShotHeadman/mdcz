import { resolve } from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { configDefaults, defineConfig } from "vitest/config";

const browserExecutablePath = process.env.MDCZ_BROWSER_EXECUTABLE?.trim() || undefined;

export const workspaceAliases = [
  { find: "@main", replacement: resolve(__dirname, "apps/desktop/src/main") },
  { find: "@renderer", replacement: resolve(__dirname, "apps/desktop/src/renderer/src") },
  {
    find: /^@mdcz\/persistence\/test$/,
    replacement: resolve(__dirname, "packages/persistence/src/testDatabase.ts"),
  },
  { find: /^@mdcz\/persistence$/, replacement: resolve(__dirname, "packages/persistence/src/index.ts") },
  { find: /^@mdcz\/runtime\/(.+)$/, replacement: resolve(__dirname, "packages/runtime/src/$1") },
  { find: /^@mdcz\/runtime$/, replacement: resolve(__dirname, "packages/runtime/src/index.ts") },
  { find: /^@mdcz\/shared\/(.+)$/, replacement: resolve(__dirname, "packages/shared/$1") },
  { find: /^@mdcz\/shared$/, replacement: resolve(__dirname, "packages/shared") },
  { find: /^@mdcz\/media-store$/, replacement: resolve(__dirname, "packages/media-store/src/index.ts") },
  { find: /^@mdcz\/ui\/(.+)$/, replacement: resolve(__dirname, "packages/ui/src/$1") },
  { find: /^@mdcz\/ui$/, replacement: resolve(__dirname, "packages/ui/src/index.ts") },
  { find: /^@mdcz\/views\/(.+)$/, replacement: resolve(__dirname, "packages/views/src/$1") },
  { find: /^@mdcz\/views$/, replacement: resolve(__dirname, "packages/views/src/index.ts") },
] as const;

export const unitRuntimeAliases = [
  { find: "electron", replacement: resolve(__dirname, "tests/unit/electronMock.ts") },
  { find: "impit", replacement: resolve(__dirname, "tests/unit/impitMock.ts") },
  { find: "mediainfo.js", replacement: resolve(__dirname, "tests/unit/mediaInfoMock.ts") },
  { find: "@", replacement: resolve(__dirname, "apps/desktop/src/renderer/src") },
] as const;

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    coverage: {
      provider: "v8",
      include: [
        "apps/server/src/**/*.ts",
        "packages/media-store/src/**/*.ts",
        "packages/persistence/src/**/*.ts",
        "packages/runtime/src/**/*.ts",
        "packages/shared/**/*.ts",
      ],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/*.testSupport.ts", "**/testDatabase.ts"],
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "coverage",
      reportOnFailure: true,
      thresholds: {
        statements: 78.8,
        branches: 64.1,
        functions: 80.4,
        lines: 79.4,
        "apps/server/src/**": {
          statements: 73.5,
          branches: 60.8,
          functions: 74.4,
          lines: 73.8,
        },
        "packages/shared/**": {
          statements: 72.5,
          branches: 49.1,
          functions: 65.5,
          lines: 73.4,
        },
        "packages/runtime/src/**": {
          statements: 80.3,
          branches: 65.8,
          functions: 84.3,
          lines: 81,
        },
        "packages/persistence/src/**": {
          statements: 89.5,
          branches: 83.9,
          functions: 89.8,
          lines: 89.2,
        },
        "packages/media-store/src/**": {
          statements: 85.6,
          branches: 70.4,
          functions: 90,
          lines: 86,
        },
      },
    },
    server: {
      deps: {
        inline: ["@egoist/tipc"],
      },
    },
    projects: [
      {
        extends: true,
        resolve: {
          alias: unitRuntimeAliases,
        },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "apps/**/*.test.ts", "packages/**/*.test.ts"],
          exclude: [
            ...configDefaults.exclude,
            "**/*.component.test.tsx",
            "**/*.contract.test.ts",
            "**/*.integration.test.ts",
            "**/*.live.integration.test.ts",
          ],
          environment: "node",
          setupFiles: ["tests/unit/setup.ts"],
        },
      },
      {
        extends: true,
        optimizeDeps: {
          include: ["react/jsx-dev-runtime", "vitest-browser-react"],
        },
        test: {
          name: "integration",
          include: [
            "tests/integration/**/*.test.ts",
            "apps/**/*.integration.test.ts",
            "packages/**/*.integration.test.ts",
          ],
          environment: "node",
          testTimeout: 120000,
          exclude: [...configDefaults.exclude, "**/*.live.integration.test.ts"],
        },
      },
      {
        extends: true,
        resolve: {
          alias: unitRuntimeAliases,
        },
        test: {
          name: "desktop-integration",
          include: ["tests/desktop-integration/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/unit/setup.ts"],
          testTimeout: 120000,
          exclude: [...configDefaults.exclude, "**/*.live.integration.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration-live",
          include: ["tests/**/*.live.integration.test.ts"],
          environment: "node",
          testTimeout: 90_000,
          // Explicit live project only — never pulled into ordinary test/integration/coverage.
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: "contract",
          include: ["tests/contracts/**/*.test.ts", "apps/**/*.contract.test.ts", "packages/**/*.contract.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          include: [
            "tests/component/**/*.component.test.tsx",
            "apps/**/*.component.test.tsx",
            "packages/**/*.component.test.tsx",
          ],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: browserExecutablePath ? { executablePath: browserExecutablePath } : undefined,
            }),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
