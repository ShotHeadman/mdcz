import { defaultConfiguration } from "@mdcz/shared/config";
import { describe, expect, it } from "vitest";
import { MaintenanceRuntime, type MaintenanceRuntimeDependencies } from "./MaintenanceRuntime";

describe("MaintenanceRuntime network policy", () => {
  it("applies the current scrape site-delay policy to the maintenance client", async () => {
    const calls: string[] = [];
    const networkPolicyClient = {
      setDomainInterval: (domain: string, intervalMs: number, intervalCap?: number, concurrency?: number) => {
        calls.push(`interval:${domain}:${intervalMs}:${intervalCap}:${concurrency}`);
      },
      setDomainLimit: () => undefined,
      clearDomainLimit: (domain: string) => {
        calls.push(`clear:${domain}`);
      },
    };
    let configuration = {
      ...defaultConfiguration,
      scrape: { ...defaultConfiguration.scrape, javdbDelaySeconds: 2 },
    };
    const runtime = new MaintenanceRuntime({
      config: { get: async () => configuration },
      networkPolicyClient,
    } as unknown as MaintenanceRuntimeDependencies);

    await runtime.applyNetworkPolicy();
    configuration = {
      ...configuration,
      scrape: { ...configuration.scrape, javdbDelaySeconds: 0 },
    };
    await runtime.applyNetworkPolicy();

    expect(calls).toEqual([
      "interval:javdb.com:2000:1:1",
      "interval:www.javdb.com:2000:1:1",
      "clear:javdb.com",
      "clear:www.javdb.com",
    ]);
  });
});
