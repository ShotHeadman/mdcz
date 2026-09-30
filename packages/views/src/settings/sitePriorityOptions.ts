import { Website } from "@mdcz/shared/enums";
import type { Messages } from "../i18n";
import { normalizeEnabledSites } from "./orderedSite";
import type { OrderedSiteSummary } from "./orderedSiteSummary";

export type SitePriorityOptionId = keyof Messages["settings"]["sitePriority"]["options"];

type SitePriorityOptionStateValue = "none" | "partial" | "all";

interface SitePriorityOptionDefinition {
  id: SitePriorityOptionId;
  sites: Website[];
}

export interface SitePriorityOptionState extends SitePriorityOptionDefinition {
  enabledSites: Website[];
  state: SitePriorityOptionStateValue;
  memberLabel: string | null;
}

const SITE_PRIORITY_OPTION_DEFINITIONS: SitePriorityOptionDefinition[] = [
  { id: "dmm_family", sites: [Website.DMM, Website.DMM_TV] },
  {
    id: "official",
    sites: [Website.MGSTAGE, Website.PRESTIGE, Website.FALENO, Website.DAHLIA, Website.KM_PRODUCE],
  },
  { id: Website.AVBASE, sites: [Website.AVBASE] },
  { id: Website.R18_DEV, sites: [Website.R18_DEV] },
  { id: Website.AVWIKIDB, sites: [Website.AVWIKIDB] },
  { id: Website.JAVDB, sites: [Website.JAVDB] },
  { id: Website.JAVBUS, sites: [Website.JAVBUS] },
  { id: Website.JAV321, sites: [Website.JAV321] },
  { id: "h0930_family", sites: [Website.H0930, Website.H4610] },
  { id: Website.FC2, sites: [Website.FC2] },
  { id: Website.FC2HUB, sites: [Website.FC2HUB] },
  { id: Website.PPVDATABANK, sites: [Website.PPVDATABANK] },
  { id: Website.SOKMIL, sites: [Website.SOKMIL] },
  { id: Website.KINGDOM, sites: [Website.KINGDOM] },
  { id: Website.FANTIA, sites: [Website.FANTIA] },
];

function getAvailableOptionDefinitions(availableSites: string[]): SitePriorityOptionDefinition[] {
  const available = new Set(normalizeEnabledSites(availableSites));

  return SITE_PRIORITY_OPTION_DEFINITIONS.map((option) => ({
    ...option,
    sites: option.sites.filter((site) => available.has(site)),
  })).filter((option) => option.sites.length > 0);
}

function normalizeConcreteSites(value: unknown, availableSites: string[]): Website[] {
  const available = new Set(normalizeEnabledSites(availableSites));

  return normalizeEnabledSites(
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [],
  ).filter((site): site is Website => available.has(site));
}

export function resolveSitePriorityOptions(value: unknown, availableSites: string[]): SitePriorityOptionState[] {
  const concreteSites = normalizeConcreteSites(value, availableSites);
  const optionDefinitions = getAvailableOptionDefinitions(availableSites);

  const resolved = optionDefinitions.map((option) => {
    const enabledSites = concreteSites.filter((site) => option.sites.includes(site));
    const state: SitePriorityOptionStateValue =
      enabledSites.length === 0 ? "none" : enabledSites.length === option.sites.length ? "all" : "partial";

    return {
      ...option,
      enabledSites,
      state,
      memberLabel: option.sites.length > 1 ? option.sites.join(" / ") : null,
    };
  });

  const enabledOptions = resolved
    .filter((option) => option.state !== "none")
    .sort((left, right) => {
      const leftSite = left.enabledSites[0] ?? left.sites[0];
      const rightSite = right.enabledSites[0] ?? right.sites[0];
      return concreteSites.indexOf(leftSite) - concreteSites.indexOf(rightSite);
    });
  const disabledOptions = resolved.filter((option) => option.state === "none");

  return [...enabledOptions, ...disabledOptions];
}

function flattenEnabledSites(options: SitePriorityOptionState[]): Website[] {
  return options.flatMap((option) => option.enabledSites);
}

export function setAllSitePriorityOptions(value: string[], availableSites: string[]): Website[] {
  return resolveSitePriorityOptions(value, availableSites).flatMap((option) => {
    if (option.state === "none") {
      return option.sites;
    }

    return [...option.enabledSites, ...option.sites.filter((site) => !option.enabledSites.includes(site))];
  });
}

export function toggleSitePriorityOption(
  value: string[],
  availableSites: string[],
  optionId: SitePriorityOptionId,
  enabled: boolean,
): Website[] {
  const options = resolveSitePriorityOptions(value, availableSites);

  return flattenEnabledSites(
    options.map((option) => {
      if (option.id !== optionId) {
        return option;
      }

      return {
        ...option,
        enabledSites: enabled
          ? [...option.enabledSites, ...option.sites.filter((site) => !option.enabledSites.includes(site))]
          : [],
      };
    }),
  );
}

export function moveSitePriorityOption(
  value: string[],
  availableSites: string[],
  optionId: SitePriorityOptionId,
  direction: -1 | 1,
): Website[] {
  const enabledOptions = resolveSitePriorityOptions(value, availableSites).filter((option) => option.state !== "none");
  const index = enabledOptions.findIndex((option) => option.id === optionId);
  const nextIndex = index + direction;

  if (index < 0 || nextIndex < 0 || nextIndex >= enabledOptions.length) {
    return normalizeConcreteSites(value, availableSites);
  }

  const nextOptions = [...enabledOptions];
  [nextOptions[index], nextOptions[nextIndex]] = [nextOptions[nextIndex], nextOptions[index]];
  return flattenEnabledSites(nextOptions);
}

export function buildGroupedSitePrioritySummary(
  t: Messages,
  value: unknown,
  availableSites: string[],
): OrderedSiteSummary {
  const enabledOptions = resolveSitePriorityOptions(value, availableSites).filter((option) => option.state !== "none");
  const preview = enabledOptions.slice(0, 3).map((option) => t.settings.sitePriority.options[option.id].label);

  return {
    enabledCount: enabledOptions.length,
    totalCount: getAvailableOptionDefinitions(availableSites).length,
    preview,
    remainingCount: Math.max(0, enabledOptions.length - preview.length),
  };
}
