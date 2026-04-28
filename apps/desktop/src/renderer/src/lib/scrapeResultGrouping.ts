import type {
  CrawlerData,
  DownloadedAssets,
  ScrapeResult,
  UncensoredConfirmItem,
  UncensoredConfirmResultItem,
} from "@mdcz/shared/types";
import { deriveGroupingDirectoryFromPath } from "@/lib/multipartDisplay";
import { buildRendererGroups, findRendererGroup, type RendererGroup } from "@/lib/rendererGroupModel";

export type ScrapeResultGroup = RendererGroup<ScrapeResult, ScrapeResult>;

export interface ScrapeResultGroupActionContext {
  selectedItem: ScrapeResult;
  nfoPath?: string;
  videoPaths: string[];
}

const scrapeResultMultipartSelectors = {
  getDirectory: (result: ScrapeResult) =>
    result.outputPath ?? deriveGroupingDirectoryFromPath(result.fileInfo.filePath),
  getFileName: (result: ScrapeResult) => result.fileInfo.filePath,
  getItemKey: (result: ScrapeResult) => result.fileId,
  getNumber: (result: ScrapeResult) => result.fileInfo.number,
  getPart: (result: ScrapeResult) => result.fileInfo.part,
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

const mergeDownloadedAssets = (
  existing: DownloadedAssets | undefined,
  incoming: DownloadedAssets | undefined,
): DownloadedAssets | undefined => {
  if (!existing) {
    return incoming;
  }

  if (!incoming) {
    return existing;
  }

  return {
    ...existing,
    ...incoming,
    sceneImages: pickLongerArray(incoming.sceneImages, existing.sceneImages) ?? existing.sceneImages,
    downloaded: pickLongerArray(incoming.downloaded, existing.downloaded) ?? existing.downloaded,
  };
};

const mergeGroupedScrapeResult = (existing: ScrapeResult, incoming: ScrapeResult): ScrapeResult => {
  return {
    ...existing,
    status: existing.status === "failed" || incoming.status === "failed" ? "failed" : "success",
    crawlerData: mergeCrawlerData(existing.crawlerData, incoming.crawlerData),
    videoMeta: incoming.videoMeta ?? existing.videoMeta,
    error: incoming.error ?? existing.error,
    outputPath: existing.outputPath ?? incoming.outputPath,
    nfoPath: incoming.nfoPath ?? existing.nfoPath,
    assets: mergeDownloadedAssets(existing.assets, incoming.assets),
    sources: incoming.sources ? { ...existing.sources, ...incoming.sources } : existing.sources,
    uncensoredAmbiguous: incoming.uncensoredAmbiguous ?? existing.uncensoredAmbiguous,
  };
};

const getScrapeGroupStatus = (group: ScrapeResultGroup["items"]): "success" | "failed" =>
  group.some((item) => item.status === "failed") ? "failed" : "success";

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
  group.items.filter(
    (item): item is ScrapeResult & { nfoPath: string } => Boolean(item.nfoPath) && item.uncensoredAmbiguous === true,
  );

export const getScrapeResultGroupNfoPath = (group: ScrapeResultGroup): string | undefined =>
  getAmbiguousUncensoredItemsForScrapeGroup(group)[0]?.nfoPath ??
  group.items.find((item) => Boolean(item.nfoPath))?.nfoPath ??
  group.display.nfoPath;

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
  return Array.from(new Set(group.items.map((item) => item.fileInfo.filePath).filter((value) => value.length > 0)));
};

export const buildScrapeResultGroupActionContext = (
  group: ScrapeResultGroup,
  itemId: string | null | undefined,
): ScrapeResultGroupActionContext => {
  return {
    selectedItem: findScrapeResultGroupItem(group, itemId) ?? group.representative,
    nfoPath: getScrapeResultGroupNfoPath(group),
    videoPaths: getScrapeResultGroupVideoPaths(group),
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
      videoPath: item.fileInfo.filePath,
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
    group.items.every((item) => updatedSourcePaths.has(item.fileInfo.filePath)),
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
