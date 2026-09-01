import { buildComputedConfiguration, type ComputedConfiguration } from "@mdcz/runtime/config";
import type { Configuration } from "@mdcz/shared/config";

export { buildComputedConfiguration, type ComputedConfiguration };

export class ComputedConfig {
  private cache: ComputedConfiguration | null = null;

  constructor(private readonly getConfiguration: () => Configuration) {}

  get value(): ComputedConfiguration {
    if (!this.cache) {
      this.cache = buildComputedConfiguration(this.getConfiguration());
    }

    return this.cache;
  }

  invalidate(): void {
    this.cache = null;
  }
}
