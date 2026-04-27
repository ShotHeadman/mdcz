import { Website } from "@shared/enums";
import type { OrderedSiteSummary } from "@/components/settings/orderedSiteSummary";
import { normalizeEnabledSites } from "@/utils/orderedSite";

export type SitePriorityOptionId = Website | "dmm_family" | "official";

type SitePriorityOptionStateValue = "none" | "partial" | "all";

interface SitePriorityOptionDefinition {
  id: SitePriorityOptionId;
  label: string;
  description: string;
  sites: Website[];
  aliases?: string[];
}

export interface SitePriorityOptionState extends SitePriorityOptionDefinition {
  enabledSites: Website[];
  state: SitePriorityOptionStateValue;
  memberLabel: string | null;
  statusLabel: string | null;
}

const SITE_PRIORITY_OPTION_DEFINITIONS: SitePriorityOptionDefinition[] = [
  {
    id: "dmm_family",
    label: "DMM/FANZA 系",
    description:
      "DMM/FANZA 官方售卖与配信源，主流日本 AV 作品的权威来源；标题、厂牌、封面可信度高，但受地区、登录/年龄确认和下架影响。",
    sites: [Website.DMM, Website.DMM_TV],
    aliases: ["dmm", "dmm tv", "dmm_tv", "fanza", "dmm/fanza"],
  },
  {
    id: "official",
    label: "厂商官网",
    description:
      "聚合 MGStage、Prestige、Faleno、Dahlia、KM Produce 等厂商或厂牌自有站点，适合对应厂牌作品，覆盖范围较窄，成功率随站点和编号差异较大。",
    sites: [Website.MGSTAGE, Website.PRESTIGE, Website.FALENO, Website.DAHLIA, Website.KM_PRODUCE],
    aliases: ["official", "maker", "studio official", "厂商", "官网", "厂牌官网"],
  },
  {
    id: Website.AVBASE,
    label: Website.AVBASE,
    description: "聚合站，字段覆盖广，标题、简介、演员与图片通常较完整，适合作为通用主来源。",
    sites: [Website.AVBASE],
  },
  {
    id: Website.R18_DEV,
    label: "R18.dev",
    description: "R18.dev JSON 元数据源，但图片较少。",
    sites: [Website.R18_DEV],
    aliases: ["r18", "r18.dev", "r18_dev"],
  },
  {
    id: Website.AVWIKIDB,
    label: Website.AVWIKIDB,
    description: "社区整理库，适合补简介、标签和发行信息；部分网络环境下可能出现区域限制或 403。",
    sites: [Website.AVWIKIDB],
  },
  {
    id: Website.JAVDB,
    label: Website.JAVDB,
    description: "聚合站，封面、剧照和预告片补充能力较强；可能受地区限制，必要时可配 Cookie。",
    sites: [Website.JAVDB],
  },
  {
    id: Website.JAVBUS,
    label: Website.JAVBUS,
    description: "聚合站，封面和样品图通常稳定；部分环境会遇到成年验证，必要时可配 Cookie。",
    sites: [Website.JAVBUS],
  },
  {
    id: Website.JAV321,
    label: Website.JAV321,
    description: "检索型聚合站，适合作为额外兜底来源；字段完整度和稳定性通常低于主流聚合站。",
    sites: [Website.JAV321],
  },
  {
    id: Website.FC2,
    label: Website.FC2,
    description: "FC2 官方商品页，卖家名与官方发行信息可信度高，适合 FC2 编号；无法作用于已下架作品。",
    sites: [Website.FC2],
  },
  {
    id: Website.FC2HUB,
    label: Website.FC2HUB,
    description: "FC2 聚合源，标题、时长、评分等补充较积极，适合作为 FC2 编号的主抓取来源之一。",
    sites: [Website.FC2HUB],
  },
  {
    id: Website.PPVDATABANK,
    label: Website.PPVDATABANK,
    description: "FC2 补充库，常用于回填卖家、日期、封面和样品图，适合作为 FC2 兜底来源。",
    sites: [Website.PPVDATABANK],
  },
  {
    id: Website.SOKMIL,
    label: Website.SOKMIL,
    description: "偏写真/gravure 和特定配信内容补充；不建议作为通用主来源。",
    sites: [Website.SOKMIL],
    aliases: ["gravure", "idol", "photo", "配信平台"],
  },
  {
    id: Website.KINGDOM,
    label: Website.KINGDOM,
    description: "Kingdom 体系官网，适合 Empress、Princess、Queen、Kingdom、bambini 等特定作品，通用性较低。",
    sites: [Website.KINGDOM],
    aliases: ["empress", "princess", "queen", "bambini"],
  },
];

export const SITE_PRIORITY_EDITOR_ALIASES = Array.from(
  new Set([
    "site",
    "sites",
    "priority",
    "source priority",
    "站点优先级",
    "站点分组",
    ...SITE_PRIORITY_OPTION_DEFINITIONS.flatMap((option) => [option.label, ...option.sites, ...(option.aliases ?? [])]),
  ]),
);

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

function buildStatusLabel(enabledSites: Website[], totalSites: number): string | null {
  if (enabledSites.length === 0 || enabledSites.length === totalSites) {
    return null;
  }

  return `已启用 ${enabledSites.length}/${totalSites}`;
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
      statusLabel: buildStatusLabel(enabledSites, option.sites.length),
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

export function buildGroupedSitePrioritySummary(value: unknown, availableSites: string[]): OrderedSiteSummary {
  const enabledOptions = resolveSitePriorityOptions(value, availableSites).filter((option) => option.state !== "none");
  const preview = enabledOptions.slice(0, 3).map((option) => option.label);

  return {
    enabledCount: enabledOptions.length,
    totalCount: getAvailableOptionDefinitions(availableSites).length,
    preview,
    remainingCount: Math.max(0, enabledOptions.length - preview.length),
  };
}
