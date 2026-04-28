import type { Website } from "@mdcz/shared/enums";
import type { ActorSourceHint } from "../../../types";
import { BaseRosterOfficialAdapter } from "../BaseRosterOfficialAdapter";
import { matchesSourceHost } from "../shared";
import type { OfficialActorSourceDependencies } from "../types";

interface StudioOfficialAdapterConfig {
  hintHosts: string[];
  key: string;
  rateLimitedHosts: string[];
  studioPattern?: RegExp;
  website: Website;
}

export abstract class BaseStudioOfficialAdapter<TRoster> extends BaseRosterOfficialAdapter<TRoster> {
  protected constructor(
    deps: OfficialActorSourceDependencies,
    private readonly baseConfig: StudioOfficialAdapterConfig,
  ) {
    super(deps, {
      key: baseConfig.key,
      rateLimitedHosts: baseConfig.rateLimitedHosts,
    });
  }

  matchesHints(hints: ActorSourceHint[]): boolean {
    return hints.some(
      (hint) =>
        hint.website === this.baseConfig.website ||
        (this.baseConfig.studioPattern?.test(hint.studio ?? "") ?? false) ||
        (this.baseConfig.studioPattern?.test(hint.publisher ?? "") ?? false) ||
        this.baseConfig.hintHosts.some((host) => matchesSourceHost(hint, host)),
    );
  }
}
