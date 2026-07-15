import { resolve } from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { configDefaults, defineConfig } from "vitest/config";

const browserExecutablePath = process.env.MDCZ_BROWSER_EXECUTABLE?.trim() || undefined;

const workspaceAliases = [
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

const unitRuntimeAliases = [
  { find: "electron", replacement: resolve(__dirname, "tests/unit/electronMock.ts") },
  { find: "impit", replacement: resolve(__dirname, "tests/unit/impitMock.ts") },
  { find: "mediainfo.js", replacement: resolve(__dirname, "tests/unit/mediaInfoMock.ts") },
  { find: "@", replacement: resolve(__dirname, "apps/desktop/src/renderer/src") },
] as const;

const legacyNodeIntegrationTests = [
  "apps/server/src/configService.test.ts",
  "packages/media-store/src/storage.test.ts",
  "packages/persistence/src/persistence.test.ts",
  "packages/runtime/src/config/config.test.ts",
  "packages/runtime/src/runtimeActions.test.ts",
] as const;

const legacyDesktopIntegrationTests = [
  "tests/unit/ipc/file_handlers.test.ts",
  "tests/unit/main_utils_image_validation.test.ts",
  "tests/unit/services/actorImage/ActorImageService.test.ts",
  "tests/unit/services/actorImage/ActorPhotoMaterializer.test.ts",
  "tests/unit/services/actorSource/local_gfriends.test.ts",
  "tests/unit/services/actorSource/official.test.ts",
  "tests/unit/services/config/config_manager_config_directory.test.ts",
  "tests/unit/services/cooldown/persistent_cooldown_store.test.ts",
  "tests/unit/services/crawler/provider.test.ts",
  "tests/unit/services/jellyfin/jellyfin_services.test.ts",
  "tests/unit/services/library/output_library_scanner.test.ts",
  "tests/unit/services/scraper/download_manager_keep.test.ts",
  "tests/unit/services/scraper/file_organizer_settings.test.ts",
  "tests/unit/services/scraper/file_scraper_actor_images.test.ts",
  "tests/unit/services/scraper/file_scraper_multipart.test.ts",
  "tests/unit/services/scraper/file_scraper_pipeline_stages.test.ts",
  "tests/unit/services/scraper/file_scraper_strm.test.ts",
  "tests/unit/services/scraper/file_scraper_subtitle_sidecars.test.ts",
  "tests/unit/services/scraper/image_host_cooldown_tracker.test.ts",
  "tests/unit/services/scraper/local_scan_service.test.ts",
  "tests/unit/services/scraper/maintenance_artifact_resolver.test.ts",
  "tests/unit/services/scraper/maintenance_file_scraper_actor_images.test.ts",
  "tests/unit/services/scraper/nfo_generator_duration.test.ts",
  "tests/unit/services/scraper/poster_image_derivation.test.ts",
  "tests/unit/services/scraper/scene_image_downloader.test.ts",
  "tests/unit/services/scraper/scrape_session.test.ts",
  "tests/unit/services/scraper/scraper_service_paths.test.ts",
  "tests/unit/services/scraper/scraper_service_requeue.test.ts",
  "tests/unit/services/scraper/scraper_service_stop.test.ts",
  "tests/unit/services/scraper/subtitle_sidecars.test.ts",
  "tests/unit/services/tools/amazon_poster_tool_service.test.ts",
  "tests/unit/services/tools/symlink_service.test.ts",
  "tests/unit/utils/file.test.ts",
  "tests/unit/utils/strm.test.ts",
  "tests/unit/utils/translate.test.ts",
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
            ...legacyNodeIntegrationTests,
            ...legacyDesktopIntegrationTests,
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
            ...legacyNodeIntegrationTests,
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
          include: ["tests/desktop-integration/**/*.test.ts", ...legacyDesktopIntegrationTests],
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
