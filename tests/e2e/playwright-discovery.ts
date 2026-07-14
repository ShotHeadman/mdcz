export const LIVE_E2E_FILE_GLOB = "**/*.live.e2e.spec.ts";
export const PRODUCT_E2E_FILE_GLOB = "**/*.e2e.spec.ts";

export const resolvePlaywrightTargetDiscovery = (targetDirectory: "web" | "desktop", liveMode: boolean) => ({
  testMatch: liveMode ? `${targetDirectory}/**/*.live.e2e.spec.ts` : `${targetDirectory}/**/*.e2e.spec.ts`,
  testIgnore: liveMode ? [] : [`${targetDirectory}/**/*.live.e2e.spec.ts`],
});
