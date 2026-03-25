import type { UncensoredConfirmItem, UncensoredConfirmResultItem } from "@shared/types";
import { buildRendererGroups, findRendererGroup, type RendererGroup } from "@/lib/rendererGroupModel";
import type { ScrapeResult } from "@/store/scrapeStore";

export type ScrapeResultGroup = RendererGroup<ScrapeResult, ScrapeResult>;

export interface ScrapeResultGroupActionContext {
  selectedItem: ScrapeResult;
  nfoPath?: string;
  videoPaths: string[];
}

const scrapeResultMultipartSelectors = {
  getDirectory: (result: ScrapeResult) =>
    result.status === "success" ? (result.multipartDirectory ?? result.outputPath) : undefined,
  getFileName: (result: ScrapeResult) => result.path,
  getItemKey: (result: ScrapeResult) => result.id,
  getNumber: (result: ScrapeResult) => result.number,
  getPart: (result: ScrapeResult) => result.multipartPart,
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

const mergeGroupedScrapeResult = (existing: ScrapeResult, incoming: ScrapeResult): ScrapeResult => {
  return {
    id: existing.id,
    status: existing.status,
    number: existing.number,
    path: existing.path || incoming.path,
    title: incoming.title ?? existing.title,
    actors: incoming.actors ?? existing.actors,
    outline: incoming.outline ?? existing.outline,
    tags: incoming.tags ?? existing.tags,
    release: incoming.release ?? existing.release,
    duration: incoming.duration ?? existing.duration,
    resolution: incoming.resolution ?? existing.resolution,
    codec: incoming.codec ?? existing.codec,
    bitrate: incoming.bitrate ?? existing.bitrate,
    directors: incoming.directors ?? existing.directors,
    series: incoming.series ?? existing.series,
    studio: incoming.studio ?? existing.studio,
    publisher: incoming.publisher ?? existing.publisher,
    score: incoming.score ?? existing.score,
    posterUrl: incoming.posterUrl ?? existing.posterUrl,
    thumbUrl: incoming.thumbUrl ?? existing.thumbUrl,
    fanartUrl: incoming.fanartUrl ?? existing.fanartUrl,
    outputPath: existing.outputPath || incoming.outputPath,
    sceneImages: pickLongerArray(incoming.sceneImages, existing.sceneImages),
    sources: incoming.sources ?? existing.sources,
    errorMessage: incoming.errorMessage ?? existing.errorMessage,
    uncensoredAmbiguous: incoming.uncensoredAmbiguous ?? existing.uncensoredAmbiguous,
    nfoPath: incoming.nfoPath ?? existing.nfoPath,
    multipartDirectory: existing.multipartDirectory ?? incoming.multipartDirectory,
    multipartPart: existing.multipartPart ?? incoming.multipartPart,
  };
};

export const buildScrapeResultGroups = (results: ScrapeResult[]): ScrapeResultGroup[] => {
  return buildRendererGroups(results, {
    selectors: scrapeResultMultipartSelectors,
    buildDisplay: (group) =>
      group.items.reduce((merged, result) => mergeGroupedScrapeResult(merged, result), group.representative),
    buildStatus: (_group, display) => display.status,
    buildErrorText: (_group, display) => display.errorMessage,
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

  return group.items.find((item) => item.id === itemId);
};

export const getScrapeResultGroupVideoPaths = (group: ScrapeResultGroup): string[] => {
  return Array.from(new Set(group.items.map((item) => item.path).filter((value) => value.length > 0)));
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
      nfoPath: item.nfoPath,
      videoPath: item.path,
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
    group.items.every((item) => updatedSourcePaths.has(item.path)),
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
  return findRendererGroup(buildScrapeResultGroups(results), id, (result) => result.id);
};
