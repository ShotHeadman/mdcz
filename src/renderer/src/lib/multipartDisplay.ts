import {
  buildStandaloneGroupId,
  deriveGroupingDirectoryFromPath as deriveSharedGroupingDirectoryFromPath,
  tryBuildGroupedGroupId,
} from "@shared/mediaIdentity";
import type { FileInfo } from "@shared/types";

export interface MultipartDisplaySelectors<T> {
  getDirectory: (item: T) => string | undefined;
  getFileName: (item: T) => string;
  getItemKey: (item: T) => string;
  getNumber: (item: T) => string;
  getPart: (item: T) => FileInfo["part"] | undefined;
}

export interface MultipartDisplayGroup<T> {
  key: string;
  representative: T;
  items: T[];
}

export const deriveGroupingDirectoryFromPath = (filePath: string): string | undefined =>
  deriveSharedGroupingDirectoryFromPath(filePath);

const compareMultipartDisplayItems = <T>(left: T, right: T, selectors: MultipartDisplaySelectors<T>): number => {
  const leftPart = selectors.getPart(left)?.number ?? 0;
  const rightPart = selectors.getPart(right)?.number ?? 0;

  if (leftPart !== rightPart) {
    if (leftPart === 0) {
      return -1;
    }

    if (rightPart === 0) {
      return 1;
    }

    return leftPart - rightPart;
  }

  return selectors.getFileName(left).localeCompare(selectors.getFileName(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
};

export const buildMultipartDisplayGroups = <T>(
  items: T[],
  selectors: MultipartDisplaySelectors<T>,
): MultipartDisplayGroup<T>[] => {
  const standaloneGroups: Array<{ firstIndex: number; group: MultipartDisplayGroup<T> }> = [];
  const buckets = new Map<
    string,
    {
      firstIndex: number;
      items: T[];
    }
  >();

  for (const [index, item] of items.entries()) {
    const key = tryBuildGroupedGroupId({
      directory: selectors.getDirectory(item),
      number: selectors.getNumber(item),
    });

    if (!key) {
      standaloneGroups.push({
        firstIndex: index,
        group: {
          key: buildStandaloneGroupId(selectors.getItemKey(item)),
          representative: item,
          items: [item],
        },
      });
      continue;
    }

    const bucket = buckets.get(key);
    if (bucket) {
      bucket.items.push(item);
      continue;
    }

    buckets.set(key, {
      firstIndex: index,
      items: [item],
    });
  }

  const groupedBuckets: Array<{ firstIndex: number; group: MultipartDisplayGroup<T> }> = [];

  for (const [key, bucket] of buckets) {
    const sortedItems = [...bucket.items].sort((left, right) => compareMultipartDisplayItems(left, right, selectors));
    const representative = sortedItems[0];
    if (!representative) {
      continue;
    }

    groupedBuckets.push({
      firstIndex: bucket.firstIndex,
      group: {
        key,
        representative,
        items: sortedItems,
      },
    });
  }

  return [...standaloneGroups, ...groupedBuckets]
    .sort((left, right) => left.firstIndex - right.firstIndex)
    .map((entry) => entry.group);
};

export const countMultipartDisplayGroups = <T>(items: T[], selectors: MultipartDisplaySelectors<T>): number =>
  buildMultipartDisplayGroups(items, selectors).length;
