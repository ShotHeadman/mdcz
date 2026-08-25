import { NetworkClient } from "@mdcz/runtime/network";
import { defaultConfiguration } from "@mdcz/shared/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServerMaintenanceRuntime } from "./maintenanceRuntimeFactory";
import type { ServerConfigService } from "./services/configService";

const config = {
  get: async () => ({
    ...defaultConfiguration,
    scrape: { ...defaultConfiguration.scrape, javdbDelaySeconds: 2 },
  }),
  runtimePaths: {
    configDir: "/tmp/mdcz-maintenance-runtime-test/config",
    configPath: "/tmp/mdcz-maintenance-runtime-test/config/default.toml",
    dataDir: "/tmp/mdcz-maintenance-runtime-test/data",
    databasePath: "/tmp/mdcz-maintenance-runtime-test/data/mdcz.sqlite",
  },
} as unknown as ServerConfigService;

describe("createServerMaintenanceRuntime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("wires its shared HTTP client into the current site-delay policy", async () => {
    const setDomainInterval = vi.spyOn(NetworkClient.prototype, "setDomainInterval");
    const runtime = createServerMaintenanceRuntime(config);

    await runtime.applyNetworkPolicy();

    expect(setDomainInterval).toHaveBeenCalledWith("javdb.com", 2_000, 1, 1);
    expect(setDomainInterval).toHaveBeenCalledWith("www.javdb.com", 2_000, 1, 1);
  });
});
