import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@mdcz/shared": resolve(__dirname, "../../packages/shared"),
      "@mdcz/shared/config": resolve(__dirname, "../../packages/shared/config.ts"),
      "@mdcz/shared/configCodec": resolve(__dirname, "../../packages/shared/configCodec.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
