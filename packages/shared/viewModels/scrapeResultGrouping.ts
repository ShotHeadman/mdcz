import type { AssetRef } from "@mdcz/shared/mediaRef";
import type {
  CrawlerData,
  ScrapeResult,
  ScrapeResultStatus,
  UncensoredConfirmItem,
  UncensoredConfirmResultItem,
} from "@mdcz/shared/types";
import type { ScrapeFileRefDto } from "../serverDtos";
import { deriveGroupingDirectoryFromPath } from "./multipartDisplay";
import {
  buildRendererGroups,
  findRendererGroup,
  type RendererGroup,
  type RendererGroupStatus,
} from "./rendererGroupModel";

export type ScrapeResultGroup = RendererGroup<ScrapeResult, ScrapeResult, RendererGroupStatus>;

export interface ScrapeResultGroupActionContext {
  selectedItem: ScrapeResult;
  nfoPath?: string;
  targets: Array<{ filePath: string; ref?: ScrapeFileRefDto }>;
  videoPaths: string[];
}

const scrapeResultPath = (result: ScrapeResult): string => result.output?.relativePath ?? result.relativePath;
const scrapeResultNumber = (result: ScrapeResult): string =>
  result.crawlerData?.number ?? result.fileName.replace(/\.[^.]+$/u, "");
const scrapeResultNfoPath = (result: ScrapeResult): string | undefined => result.nfo?.relativePath;

const scrapeResultMultipartSelectors = {
  getDirectory: (result: ScrapeResult) => deriveGroupingDirectoryFromPath(scrapeResultPath(result)),
  getFileName: (result: ScrapeResult) => scrapeResultPath(result),
  getItemKey: (result: ScrapeResult) => result.fileId,
  getNumber: (result: ScrapeResult) => scrapeResultNumber(result),
  getPart: (result: ScrapeResult) => result.part,
};

const pickLongerArray = <T>(incoming: T[] | undefined, existing: T[] | undefined): T[] | undefined => {
  if (!incoming?.length) {
    return existing;
  }

  if (!existing?.length || incoming.length >= existing.length) {
    return incoming;
  }

  return existing;
};

const mergeCrawlerData = (
  existing: CrawlerData | undefined,
  incoming: CrawlerData | undefined,
): CrawlerData | undefined => {
  if (!existing) {
    return incoming;
  }

  if (!incoming) {
    return existing;
  }

  return {
    ...existing,
    ...incoming,
    actors: pickLongerArray(incoming.actors, existing.actors) ?? existing.actors,
    actor_profiles: pickLongerArray(incoming.actor_profiles, existing.actor_profiles),
    genres: pickLongerArray(incoming.genres, existing.genres) ?? existing.genres,
    scene_images: pickLongerArray(incoming.scene_images, existing.scene_images) ?? existing.scene_images,
  };
};

const mergeAssets = (existing: AssetRef[], incoming: AssetRef[]): AssetRef[] => {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return incoming;
  const merged = new Map<string, AssetRef>();
  for (const asset of [...existing, ...incoming]) {
    const key =
      asset.type === "local"
        ? `${asset.kind}:${asset.file.rootId}:${asset.file.relativePath}`
        : `${asset.kind}:${asset.url}`;
    merged.set(key, asset);
  }
  return [...merged.values()];
};

const mergeGroupedScrapeResult = (existing: ScrapeResult, incoming: ScrapeResult): ScrapeResult => {
  return {
    ...existing,
    status: mergeScrapeResultStatus(existing.status, incoming.status),
    crawlerData: mergeCrawlerData(existing.crawlerData, incoming.crawlerData),
    videoMeta: incoming.videoMeta ?? existing.videoMeta,
    error: incoming.error ?? existing.error,
    output: existing.output ?? incoming.output,
    nfo: incoming.nfo ?? existing.nfo,
    assets: mergeAssets(existing.assets, incoming.assets),
    sources: incoming.sources ? { ...existing.sources, ...incoming.sources } : existing.sources,
    uncensoredAmbiguous: incoming.uncensoredAmbiguous ?? existing.uncensoredAmbiguous,
  };
};

const mergeScrapeResultStatus = (existing: ScrapeResultStatus, incoming: ScrapeResultStatus): ScrapeResultStatus => {
  if (existing === "failed" || incoming === "failed") return "failed";
  if (existing === "processing" || incoming === "processing") return "processing";
  if (existing === "pending" || incoming === "pending") return "processing";
  if (existing === "success" || incoming === "success") return "success";
  return "skipped";
};

const getScrapeGroupStatus = (group: ScrapeResultGroup["items"]): RendererGroupStatus => {
  if (group.some((item) => item.status === "failed")) return "failed";
  if (group.some((item) => item.status === "processing" || item.status === "pending")) return "processing";
  if (group.some((item) => item.status === "success")) return "success";
  return "idle";
};

const getScrapeGroupErrorText = (group: ScrapeResultGroup["items"]): string | undefined =>
  group.find((item) => item.status === "failed" && item.error)?.error;

export const buildScrapeResultGroups = (results: ScrapeResult[]): ScrapeResultGroup[] => {
  return buildRendererGroups(results, {
    selectors: scrapeResultMultipartSelectors,
    buildDisplay: (group) =>
      group.items.reduce((merged, result) => mergeGroupedScrapeResult(merged, result), group.representative),
    buildStatus: (group) => getScrapeGroupStatus(group.items),
    buildErrorText: (group) => getScrapeGroupErrorText(group.items),
  });
};

export const buildAmbiguousUncensoredScrapeGroups = (results: ScrapeResult[]): ScrapeResultGroup[] =>
  buildScrapeResultGroups(results).filter((group) => getAmbiguousUncensoredItemsForScrapeGroup(group).length > 0);

export const getAmbiguousUncensoredItemsForScrapeGroup = (
  group: ScrapeResultGroup,
): Array<ScrapeResult & { nfoPath: string }> =>
  group.items.flatMap((item) => {
    const nfoPath = scrapeResultNfoPath(item);
    return nfoPath && item.uncensoredAmbiguous === true ? [{ ...item, nfoPath }] : [];
  });

export const getScrapeResultGroupNfoPath = (group: ScrapeResultGroup): string | undefined =>
  getAmbiguousUncensoredItemsForScrapeGroup(group)[0]?.nfoPath ??
  group.items.map(scrapeResultNfoPath).find((nfoPath) => Boolean(nfoPath)) ??
  scrapeResultNfoPath(group.display);

export const findScrapeResultGroupItem = (
  group: ScrapeResultGroup,
  itemId: string | null | undefined,
): ScrapeResult | undefined => {
  if (!itemId) {
    return undefined;
  }

  return group.items.find((item) => item.fileId === itemId);
};

export const getScrapeResultGroupVideoPaths = (group: ScrapeResultGroup): string[] => {
  return Array.from(new Set(group.items.map(scrapeResultPath).filter((value) => value.length > 0)));
};

export const getScrapeResultGroupTargets = (
  group: ScrapeResultGroup,
): Array<{ filePath: string; ref?: ScrapeFileRefDto }> => {
  const targets = new Map<string, { filePath: string; ref?: ScrapeFileRefDto }>();
  for (const item of group.items) {
    const filePath = scrapeResultPath(item);
    if (!filePath) continue;
    targets.set(filePath, {
      filePath,
      ref: item.output ?? { rootId: item.rootId, relativePath: item.relativePath },
    });
  }
  return [...targets.values()];
};

export const buildScrapeResultGroupActionContext = (
  group: ScrapeResultGroup,
  itemId: string | null | undefined,
): ScrapeResultGroupActionContext => {
  const targets = getScrapeResultGroupTargets(group);
  return {
    selectedItem: findScrapeResultGroupItem(group, itemId) ?? group.representative,
    nfoPath: getScrapeResultGroupNfoPath(group),
    targets,
    videoPaths: targets.map((target) => target.filePath),
  };
};

export const buildUncensoredConfirmItemsForScrapeGroups = (
  groups: ScrapeResultGroup[],
  choicesByGroupId: Record<string, UncensoredConfirmItem["choice"]>,
): UncensoredConfirmItem[] =>
  groups.flatMap((group) =>
    getAmbiguousUncensoredItemsForScrapeGroup(group).map((item) => ({
      fileId: item.fileId,
      nfoPath: item.nfoPath,
      videoPath: scrapeResultPath(item),
      choice: choicesByGroupId[group.id] ?? "uncensored",
    })),
  );

export const summarizeUncensoredConfirmResultForScrapeGroups = (
  groups: ScrapeResultGroup[],
  updates: UncensoredConfirmResultItem[],
): { successCount: number; failedCount: number } => {
  const updatedSourcePaths = new Set(updates.map((item) => item.sourceVideoPath));
  const submittedGroups = groups
    .map((group) => ({
      items: getAmbiguousUncensoredItemsForScrapeGroup(group),
    }))
    .filter((group) => group.items.length > 0);

  const successCount = submittedGroups.filter((group) =>
    group.items.every((item) => updatedSourcePaths.has(scrapeResultPath(item))),
  ).length;
  return {
    successCount,
    failedCount: submittedGroups.length - successCount,
  };
};

export const findScrapeResultGroup = (
  results: ScrapeResult[],
  id: string | null | undefined,
): ScrapeResultGroup | undefined => {
  return findRendererGroup(buildScrapeResultGroups(results), id, (result) => result.fileId);
};
