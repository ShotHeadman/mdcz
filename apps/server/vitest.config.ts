import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@mdcz/persistence": resolve(__dirname, "../../packages/persistence/src/index.ts"),
      "@mdcz/shared": resolve(__dirname, "../../packages/shared"),
      "@mdcz/shared/config": resolve(__dirname, "../../packages/shared/config.ts"),
      "@mdcz/shared/configCodec": resolve(__dirname, "../../packages/shared/configCodec.ts"),
      "@mdcz/storage": resolve(__dirname, "../../packages/storage/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
