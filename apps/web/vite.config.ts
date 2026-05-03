import { resolve } from "node:path";
import { defineConfig } from "vite";

const workspaceResolve = (subpath: string): string => resolve(__dirname, "../..", subpath);

const isIgnorableUseClientWarning = (message: string): boolean =>
  message.includes("Module level directives cause errors when bundled") && message.includes('"use client"');

const isIgnorableUseClientSourcemapWarning = (message: string): boolean =>
  message.includes("Error when using sourcemap for reporting an error") &&
  message.includes("Can't resolve original location of error");

export default defineConfig({
  resolve: {
    alias: {
      "@": workspaceResolve("apps/desktop/src/renderer/src"),
      "@mdcz/shared": workspaceResolve("packages/shared"),
      "@mdcz/ui": workspaceResolve("packages/ui/src/index.ts"),
    },
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  build: {
    rollupOptions: {
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
});
