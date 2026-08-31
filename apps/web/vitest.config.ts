import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@mdcz\/shared\/(.+)$/, replacement: resolve(__dirname, "../../packages/shared/$1") },
      { find: /^@mdcz\/shared$/, replacement: resolve(__dirname, "../../packages/shared") },
      { find: /^@mdcz\/ui\/(.+)$/, replacement: resolve(__dirname, "../../packages/ui/src/$1") },
      { find: /^@mdcz\/ui$/, replacement: resolve(__dirname, "../../packages/ui/src/index.ts") },
      { find: /^@mdcz\/views\/(.+)$/, replacement: resolve(__dirname, "../../packages/views/src/$1") },
      { find: /^@mdcz\/views$/, replacement: resolve(__dirname, "../../packages/views/src/index.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
