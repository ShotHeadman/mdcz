import type { ActorProfile } from "@mdcz/shared/types";
import { BaseRosterOfficialAdapter } from "../BaseRosterOfficialAdapter";
import { hasMatchingName, OFFICIAL_HEADERS, type OfficialActressSummary } from "../shared";
import type { OfficialActorSourceDependencies, OfficialLookupRequest, OfficialLookupResult } from "../types";

export interface AgencySite {
  key: string;
  agency: string;
  rosterUrl: string;
  parseRoster(html: string): OfficialActressSummary[];
  parseDetail(html: string, actress: OfficialActressSummary): ActorProfile | null;
}

export class AgencyOfficialAdapter extends BaseRosterOfficialAdapter<OfficialActressSummary[]> {
  constructor(
    deps: OfficialActorSourceDependencies,
    private readonly site: AgencySite,
  ) {
    super(deps, { key: site.key, rateLimitedHosts: [new URL(site.rosterUrl).hostname] });
  }

  // No movie or actor source names an actress's agency, so its roster is always checked; the exact stage name on an
  // agency's own roster is the evidence. Romanized aliases are left out: different actresses share readings.
  matchesHints(): boolean {
    return true;
  }

  async lookup(query: OfficialLookupRequest): Promise<OfficialLookupResult | null> {
    const roster = await this.loadCachedRoster(async () =>
      this.site.parseRoster(await this.deps.networkClient.getText(this.site.rosterUrl, { headers: OFFICIAL_HEADERS })),
    );
    const actress = roster.find((entry) => hasMatchingName(query.queryNames, [entry.name]));
    if (!actress?.url) {
      return null;
    }

    const html = await this.deps.networkClient.getText(actress.url, { headers: OFFICIAL_HEADERS });
    const profile = this.site.parseDetail(html, actress);
    return profile ? { profile, sourceHints: [{ agency: this.site.agency, sourceUrl: actress.url }] } : null;
  }
}
