import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";
import pkg from "./package.json" with { type: "json" };

const appResolve = (subpath: string): string => resolve(__dirname, subpath);
const workspaceResolve = (subpath: string): string => resolve(__dirname, "../..", subpath);
const workspacePackages = [
  "@mdcz/persistence",
  "@mdcz/runtime",
  "@mdcz/shared",
  "@mdcz/storage",
  "@mdcz/ui",
  "@mdcz/views",
];
const externalDependencies = Object.keys(pkg.dependencies).filter(
  (dependency) => !workspacePackages.includes(dependency),
);

const desktopDistributionAssets = (): Plugin => ({
  name: "mdcz-desktop-distribution-assets",
  async buildStart() {
    await rm(appResolve("out/persistence"), { recursive: true, force: true });
  },
  async closeBundle() {
    await cp(workspaceResolve("packages/persistence/drizzle"), appResolve("out/persistence/drizzle"), {
      recursive: true,
    });
  },
});

const isIgnorableUseClientWarning = (message: string): boolean =>
  message.includes("Module level directives cause errors when bundled") && message.includes('"use client"');

const isIgnorableUseClientSourcemapWarning = (message: string): boolean =>
  message.includes("Error when using sourcemap for reporting an error") &&
  message.includes("Can't resolve original location of error");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages }), desktopDistributionAssets()],
    resolve: {
      alias: {
        "@main": appResolve("src/main"),
        "@mdcz/persistence": workspaceResolve("packages/persistence/src/index.ts"),
        "@mdcz/runtime": workspaceResolve("packages/runtime/src/index.ts"),
        "@mdcz/shared": workspaceResolve("packages/shared"),
        "@mdcz/storage": workspaceResolve("packages/storage/src/index.ts"),
        "@mdcz/ui": workspaceResolve("packages/ui/src/index.ts"),
        "@mdcz/views": workspaceResolve("packages/views/src/index.ts"),
        "@mdcz/views/overview": workspaceResolve("packages/views/src/overview/index.ts"),
      },
    },
    build: {
      rollupOptions: {
        external: externalDependencies,
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    resolve: {
      alias: {
        "@mdcz/shared": workspaceResolve("packages/shared"),
      },
    },
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "index.js",
        },
      },
    },
  },
  renderer: {
    root: appResolve("src/renderer"),
    base: "./",
    resolve: {
      alias: {
        "@": appResolve("src/renderer/src"),
        "@renderer": appResolve("src/renderer/src"),
        "@mdcz/shared": workspaceResolve("packages/shared"),
        "@mdcz/runtime": workspaceResolve("packages/runtime/src/index.ts"),
        "@mdcz/views": workspaceResolve("packages/views/src/index.ts"),
        "@mdcz/views/overview": workspaceResolve("packages/views/src/overview/index.ts"),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: appResolve("src/renderer/index.html"),
        },
        onwarn(warning, warn) {
          if (isIgnorableUseClientWarning(warning.message)) {
            return;
          }
          if (isIgnorableUseClientSourcemapWarning(warning.message)) {
            return;
          }
          warn(warning);
        },
      },
    },
  },
});
