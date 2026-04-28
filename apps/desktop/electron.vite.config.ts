import { resolve } from "node:path";

import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import pkg from "./package.json" with { type: "json" };

const appResolve = (subpath: string): string => resolve(__dirname, subpath);
const workspaceResolve = (subpath: string): string => resolve(__dirname, "../..", subpath);
const workspacePackages = ["@mdcz/client", "@mdcz/core", "@mdcz/persistence", "@mdcz/shared", "@mdcz/storage"];
const externalDependencies = Object.keys(pkg.dependencies).filter(
  (dependency) => !workspacePackages.includes(dependency),
);

const isIgnorableUseClientWarning = (message: string): boolean =>
  message.includes("Module level directives cause errors when bundled") && message.includes('"use client"');

const isIgnorableUseClientSourcemapWarning = (message: string): boolean =>
  message.includes("Error when using sourcemap for reporting an error") &&
  message.includes("Can't resolve original location of error");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    resolve: {
      alias: {
        "@main": appResolve("src/main"),
        "@mdcz/client": workspaceResolve("packages/client/src/index.ts"),
        "@mdcz/core": workspaceResolve("packages/core/src/index.ts"),
        "@mdcz/persistence": workspaceResolve("packages/persistence/src/index.ts"),
        "@mdcz/shared": workspaceResolve("packages/shared"),
        "@mdcz/storage": workspaceResolve("packages/storage/src/index.ts"),
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
        "@mdcz/client": workspaceResolve("packages/client/src/index.ts"),
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
        "@mdcz/client": workspaceResolve("packages/client/src/index.ts"),
        "@mdcz/shared": workspaceResolve("packages/shared"),
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
