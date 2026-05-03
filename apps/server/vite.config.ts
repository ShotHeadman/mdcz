import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const workspaceResolve = (subpath: string): string => resolve(__dirname, "../..", subpath);
const serverDist = resolve(__dirname, "dist");

const serverDistributionAssets = (): Plugin => ({
  name: "mdcz-server-distribution-assets",
  async buildStart() {
    await rm(resolve(serverDist, "persistence"), { recursive: true, force: true });
    await rm(resolve(serverDist, "server.js"), { force: true });
  },
  async closeBundle() {
    await cp(workspaceResolve("packages/persistence/drizzle"), resolve(serverDist, "persistence/drizzle"), {
      recursive: true,
    });
  },
});

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "server.js",
    },
    outDir: "dist",
    rollupOptions: {
      external: [
        /^node:/,
        "@trpc/server",
        "@trpc/server/adapters/fastify",
        "better-sqlite3",
        "fastify",
        "impit",
        "sharp",
      ],
      output: {
        entryFileNames: "server.js",
      },
    },
    ssr: true,
    target: "node20",
  },
  plugins: [serverDistributionAssets()],
  resolve: {
    alias: [
      { find: /^@mdcz\/persistence$/, replacement: workspaceResolve("packages/persistence/src/index.ts") },
      { find: /^@mdcz\/runtime$/, replacement: workspaceResolve("packages/runtime/src/index.ts") },
      { find: /^@mdcz\/runtime\/(.+)$/, replacement: workspaceResolve("packages/runtime/src/$1") },
      { find: /^@mdcz\/shared$/, replacement: workspaceResolve("packages/shared/index.ts") },
      { find: /^@mdcz\/shared\/(.+)$/, replacement: workspaceResolve("packages/shared/$1") },
      { find: /^@mdcz\/storage$/, replacement: workspaceResolve("packages/storage/src/index.ts") },
    ],
  },
});
