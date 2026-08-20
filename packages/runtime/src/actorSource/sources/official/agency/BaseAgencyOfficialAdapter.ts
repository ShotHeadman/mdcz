import type { ActorSourceHint } from "../../../types";
import { BaseRosterOfficialAdapter } from "../BaseRosterOfficialAdapter";
import { matchesSourceHost } from "../shared";
import type { OfficialActorSourceDependencies } from "../types";

interface AgencyOfficialAdapterConfig {
  agencyPattern: RegExp;
  hintHosts: string[];
  key: string;
  rateLimitedHosts: string[];
}

export abstract class BaseAgencyOfficialAdapter<TRoster> extends BaseRosterOfficialAdapter<TRoster> {
  protected constructor(
    deps: OfficialActorSourceDependencies,
    private readonly config: AgencyOfficialAdapterConfig,
  ) {
    super(deps, {
      key: config.key,
      rateLimitedHosts: config.rateLimitedHosts,
    });
  }

  matchesHints(hints: ActorSourceHint[]): boolean {
    return hints.some(
      (hint) =>
        this.config.agencyPattern.test(hint.agency ?? "") ||
        this.config.hintHosts.some((host) => matchesSourceHost(hint, host)),
    );
  }
}
