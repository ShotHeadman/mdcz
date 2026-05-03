import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@mdcz/persistence", replacement: resolve(__dirname, "../../packages/persistence/src/index.ts") },
      { find: /^@mdcz\/runtime\/(.+)$/, replacement: resolve(__dirname, "../../packages/runtime/src/$1") },
      { find: "@mdcz/runtime", replacement: resolve(__dirname, "../../packages/runtime/src/index.ts") },
      { find: "@mdcz/shared/configCodec", replacement: resolve(__dirname, "../../packages/shared/configCodec.ts") },
      { find: "@mdcz/shared/config", replacement: resolve(__dirname, "../../packages/shared/config.ts") },
      { find: "@mdcz/shared", replacement: resolve(__dirname, "../../packages/shared") },
      { find: "@mdcz/storage", replacement: resolve(__dirname, "../../packages/storage/src/index.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
