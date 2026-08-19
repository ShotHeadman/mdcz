import { cp, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const workspaceResolve = (subpath: string): string => resolve(__dirname, "../..", subpath);
const serverDist = resolve(__dirname, "dist");
const serverRuntimeExternals = [
  "@trpc/server",
  "@trpc/server/adapters/fastify",
  "better-sqlite3",
  "drizzle-orm",
  "drizzle-orm/better-sqlite3",
  "drizzle-orm/better-sqlite3/migrator",
  "drizzle-orm/sqlite-core",
  "fastify",
  "impit",
  "sharp",
];

const cleanServerOutput = async (): Promise<void> => {
  const entries = await readdir(serverDist, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  await Promise.all(
    entries
      .filter((entry) => entry.name !== "web")
      .map((entry) => rm(resolve(serverDist, entry.name), { recursive: true, force: true })),
  );
};

const serverDistributionAssets = (): Plugin => ({
  name: "mdcz-server-distribution-assets",
  async buildStart() {
    await cleanServerOutput();
  },
  async closeBundle() {
    await cp(workspaceResolve("packages/persistence/drizzle"), resolve(serverDist, "persistence/drizzle"), {
      recursive: true,
    });
    await cp(
      workspaceResolve("packages/runtime/resources/mapping_table"),
      resolve(serverDist, "resources/mapping_table"),
      {
        recursive: true,
      },
    );
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
      external: [/^node:/, ...serverRuntimeExternals],
      output: {
        entryFileNames: "server.js",
      },
    },
    ssr: true,
    target: "node24",
  },
  plugins: [serverDistributionAssets()],
  resolve: {
    alias: [
      { find: /^@mdcz\/persistence$/, replacement: workspaceResolve("packages/persistence/src/index.ts") },
      { find: /^@mdcz\/runtime$/, replacement: workspaceResolve("packages/runtime/src/index.ts") },
      { find: /^@mdcz\/runtime\/(.+)$/, replacement: workspaceResolve("packages/runtime/src/$1") },
      { find: /^@mdcz\/shared$/, replacement: workspaceResolve("packages/shared/index.ts") },
      { find: /^@mdcz\/shared\/(.+)$/, replacement: workspaceResolve("packages/shared/$1") },
      { find: /^@mdcz\/media-store$/, replacement: workspaceResolve("packages/media-store/src/index.ts") },
    ],
  },
  ssr: {
    external: serverRuntimeExternals,
    noExternal: true,
  },
});
