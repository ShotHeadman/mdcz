import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";
import pkg from "./package.json" with { type: "json" };
import { buildRendererContentSecurityPolicy } from "./src/shared/rendererCsp";

const appResolve = (subpath: string): string => resolve(__dirname, subpath);
const workspaceResolve = (subpath: string): string => resolve(__dirname, "../..", subpath);
const workspacePackages = [
  "@mdcz/persistence",
  "@mdcz/runtime",
  "@mdcz/shared",
  "@mdcz/media-store",
  "@mdcz/ui",
  "@mdcz/views",
];
const externalDependencies = Object.keys(pkg.dependencies).filter(
  (dependency) => !workspacePackages.includes(dependency),
);

const desktopDistributionAssets = (): Plugin => ({
  name: "mdcz-desktop-distribution-assets",
  async buildStart() {
    const target = appResolve("out/drizzle");
    await rm(target, { recursive: true, force: true });
    await cp(workspaceResolve("packages/persistence/drizzle"), target, {
      recursive: true,
    });
  },
});

const rendererContentSecurityPolicy = (): Plugin => ({
  name: "mdcz-renderer-csp",
  transformIndexHtml: {
    order: "pre",
    handler() {
      return [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: buildRendererContentSecurityPolicy(process.env.ELECTRON_RENDERER_URL, "meta"),
          },
          injectTo: "head-prepend",
        },
      ];
    },
  },
});

const isIgnorableUseClientWarning = (message: string): boolean =>
  message.includes("Module level directives cause errors when bundled") && message.includes('"use client"');

const isIgnorableUseClientSourcemapWarning = (message: string): boolean =>
  message.includes("Error when using sourcemap for reporting an error") &&
  message.includes("Can't resolve original location of error");

// The dev app records every scrape for replay; packaged builds use the plain network client.
export default defineConfig(({ command }) => ({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages }), desktopDistributionAssets()],
    resolve: {
      alias: {
        "@main/networkComposition": appResolve(
          command === "serve" ? "src/main/networkFixtureComposition.ts" : "src/main/networkComposition.ts",
        ),
        "@main": appResolve("src/main"),
        "@mdcz/persistence": workspaceResolve("packages/persistence/src/index.ts"),
        "@mdcz/runtime": workspaceResolve("packages/runtime/src"),
        "@mdcz/shared": workspaceResolve("packages/shared"),
        "@mdcz/media-store": workspaceResolve("packages/media-store/src/index.ts"),
        "@mdcz/ui": workspaceResolve("packages/ui/src/index.ts"),
        "@mdcz/views": workspaceResolve("packages/views/src"),
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
    plugins: [rendererContentSecurityPolicy()],
    root: appResolve("src/renderer"),
    base: "./",
    resolve: {
      alias: {
        "@": appResolve("src/renderer/src"),
        "@renderer": appResolve("src/renderer/src"),
        "@mdcz/shared": workspaceResolve("packages/shared"),
        "@mdcz/runtime": workspaceResolve("packages/runtime/src"),
        "@mdcz/views": workspaceResolve("packages/views/src"),
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
}));
