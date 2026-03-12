import type { CrawlerData, FieldDiff } from "@shared/types";

interface DiffableField {
  key: keyof CrawlerData;
  label: string;
}

interface DiffCrawlerDataOptions {
  includeTranslatedFields?: boolean;
}

const DIFFABLE_FIELDS: DiffableField[] = [
  { key: "title", label: "标题" },
  { key: "title_zh", label: "中文标题" },
  { key: "plot", label: "简介" },
  { key: "plot_zh", label: "中文简介" },
  { key: "studio", label: "制片" },
  { key: "director", label: "导演" },
  { key: "publisher", label: "发行商" },
  { key: "series", label: "系列" },
  { key: "release_date", label: "发行日期" },
  { key: "release_year", label: "发行年份" },
  { key: "rating", label: "评分" },
  { key: "thumb_url", label: "封面图" },
  { key: "poster_url", label: "海报" },
  { key: "fanart_url", label: "背景图" },
  { key: "trailer_url", label: "预告片" },
  { key: "durationSeconds", label: "时长" },
  { key: "content_type", label: "内容类型" },
];

const isEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => isEqual(val, b[i]));
  }
  return false;
};

/**
 * Compute field-level diffs between old (local NFO) and new (network) CrawlerData.
 * Only includes fields that have changed.
 */
export function diffCrawlerData(oldData: CrawlerData, newData: CrawlerData): FieldDiff[] {
  return diffCrawlerDataWithOptions(oldData, newData, {});
}

export function diffCrawlerDataWithOptions(
  oldData: CrawlerData,
  newData: CrawlerData,
  options: DiffCrawlerDataOptions,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const includeTranslatedFields = options.includeTranslatedFields ?? true;

  for (const { key, label } of DIFFABLE_FIELDS) {
    if (!includeTranslatedFields && (key === "title_zh" || key === "plot_zh")) {
      continue;
    }

    const oldValue = oldData[key];
    const newValue = newData[key];

    if (!isEqual(oldValue, newValue)) {
      diffs.push({ field: key, label, oldValue, newValue, changed: true });
    }
  }

  // Array fields: actors, genres, sample_images
  const arrayFields: { key: keyof CrawlerData; label: string }[] = [
    { key: "actors", label: "演员" },
    { key: "genres", label: "标签" },
    { key: "sample_images", label: "场景图" },
  ];

  for (const { key, label } of arrayFields) {
    const oldArr = oldData[key] as unknown[];
    const newArr = newData[key] as unknown[];
    if (!isEqual(oldArr, newArr)) {
      diffs.push({ field: key, label, oldValue: oldArr, newValue: newArr, changed: true });
    }
  }

  return diffs;
}
