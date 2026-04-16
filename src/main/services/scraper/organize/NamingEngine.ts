import { parse } from "node:path";
import type { Configuration } from "@main/services/config";
import { classifyMovie } from "@main/utils/movieClassification";
import { buildSafeFileName, buildSafePath } from "@main/utils/path";
import { resolveFileInfoSubtitleTag } from "@main/utils/subtitles";
import { Website } from "@shared/enums";
import type { CrawlerData, FileInfo, NamingPreviewItem, NfoLocalState } from "@shared/types";

export interface NamingLayout {
  folderRelativePath: string;
  targetVideoFileName: string;
  nfoFileName: string;
}

interface ActorTemplateValue {
  actor: string;
  actorFallbackPrefix?: string;
}

const FC2_NUMBER_PATTERN = /^FC2(?:-?PPV)?-?\d+$/iu;

const isSellerFallback = (data: CrawlerData): boolean => {
  return FC2_NUMBER_PATTERN.test(data.number.trim());
};

const pickActorTemplateValue = (config: Configuration, actors: string[], data: CrawlerData): ActorTemplateValue => {
  const cleaned = actors.map((actor) => actor.trim()).filter((actor) => actor.length > 0);
  if (cleaned.length === 0) {
    const fallbackValue = data.studio?.trim();
    if (config.naming.actorFallbackToStudio && fallbackValue) {
      return {
        actor: fallbackValue,
        actorFallbackPrefix: isSellerFallback(data) ? "卖家：" : "片商：",
      };
    }
    return { actor: "Unknown" };
  }

  const max = Math.max(1, config.naming.actorNameMax);
  const selected = cleaned.slice(0, max);
  if (cleaned.length > max) {
    selected.push(config.naming.actorNameMore);
  }

  return { actor: selected.join(" ") };
};

const normalizeMarker = (value: string): string => value.trim();

const appendMarker = (markers: string[], value: string): void => {
  const marker = normalizeMarker(value);
  if (!marker || markers.includes(marker)) {
    return;
  }
  markers.push(marker);
};

const formatPartSuffix = (fileInfo: FileInfo, config: Configuration): string => {
  if (!fileInfo.part) {
    return "";
  }

  if (config.naming.partStyle === "RAW") {
    return fileInfo.part.suffix;
  }

  return `-${config.naming.partStyle}${fileInfo.part.number}`;
};

const buildNumberWithNamingMarkers = (
  fileInfo: FileInfo,
  data: CrawlerData,
  config: Configuration,
  localState?: NfoLocalState,
): string => {
  const baseNumber = data.number.trim();
  if (!baseNumber) {
    return data.number;
  }

  const classification = classifyMovie(fileInfo, data, localState);
  const markers: string[] = [];
  if (resolveFileInfoSubtitleTag(fileInfo) === "中文字幕") {
    appendMarker(markers, config.naming.cnwordStyle);
  }

  if (classification.umr) {
    appendMarker(markers, config.naming.umrStyle);
  }

  if (classification.leak) {
    appendMarker(markers, config.naming.leakStyle);
  }

  if (classification.uncensored) {
    appendMarker(markers, config.naming.uncensoredStyle);
  } else {
    appendMarker(markers, config.naming.censoredStyle);
  }

  return `${baseNumber}${markers.join("")}`;
};

const formatReleaseDateByRule = (releaseDate: string | undefined, rule: string): string | undefined => {
  if (!releaseDate) {
    return undefined;
  }

  const normalized = releaseDate.trim();
  if (!normalized) {
    return undefined;
  }

  const match = normalized.match(/^(\d{4})[-/.]?(\d{1,2})[-/.]?(\d{1,2})/u);
  if (!match) {
    return normalized;
  }

  const year = match[1];
  const month = match[2].padStart(2, "0");
  const day = match[3].padStart(2, "0");
  const template = rule.trim() || "YYYY-MM-DD";

  return template.replaceAll("YYYY", year).replaceAll("MM", month).replaceAll("DD", day);
};

const truncateSegment = (value: string, maxLength: number): string => {
  const limit = Math.max(1, Math.trunc(maxLength));
  if (value.length <= limit) {
    return value;
  }
  return value.slice(0, limit).trim();
};

const truncatePathSegments = (value: string, maxLength: number): string => {
  return value
    .split(/[\\/]+/u)
    .map((segment) => truncateSegment(segment, maxLength))
    .filter((segment) => segment.length > 0)
    .join("/");
};

const previewFileInfo = (number: string, overrides?: Partial<FileInfo>): FileInfo => ({
  filePath: `/preview/${number}.mp4`,
  fileName: number,
  extension: ".mp4",
  number,
  isSubtitled: false,
  ...overrides,
});

const previewData = (number: string, overrides?: Partial<CrawlerData>): CrawlerData => ({
  title: "示例标题",
  title_zh: "示例标题",
  number,
  actors: ["演员A"],
  genres: [],
  studio: "示例制片",
  release_date: "2024-01-15",
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

const NAMING_PREVIEW_SAMPLES: Array<{
  label: string;
  fileInfo: FileInfo;
  data: CrawlerData;
  localState?: NfoLocalState;
}> = [
  {
    label: "普通",
    fileInfo: previewFileInfo("ABC-123"),
    data: previewData("ABC-123"),
  },
  {
    label: "中文字幕",
    fileInfo: previewFileInfo("ABC-456", { isSubtitled: true, subtitleTag: "中文字幕" }),
    data: previewData("ABC-456", { title_zh: "中文字幕示例", actors: ["演员B"], studio: "Studio X" }),
  },
  {
    label: "多演员",
    fileInfo: previewFileInfo("DEF-012"),
    data: previewData("DEF-012", {
      title_zh: "多演员作品",
      actors: ["演员E", "演员F", "演员G", "演员H"],
      studio: "Studio W",
    }),
  },
  {
    label: "演员为空",
    fileInfo: previewFileInfo("FC2-123456"),
    data: previewData("FC2-123456", {
      actors: [],
      studio: "示例卖家",
      publisher: "示例卖家",
      website: Website.FC2,
    }),
  },
];

export class NamingEngine {
  buildLayout(fileInfo: FileInfo, data: CrawlerData, config: Configuration, localState?: NfoLocalState): NamingLayout {
    const title = data.title_zh?.trim() || data.title;
    const originaltitle = data.title.trim();
    const actorTemplateValue = pickActorTemplateValue(config, data.actors ?? [], data);
    const styledNumber = buildNumberWithNamingMarkers(fileInfo, data, config, localState);
    const partSuffix = formatPartSuffix(fileInfo, config);
    const formattedReleaseDate = formatReleaseDateByRule(data.release_date, config.naming.releaseRule);
    const templateData = {
      title,
      originaltitle,
      number: styledNumber,
      actor: actorTemplateValue.actor,
      actorFallbackPrefix: actorTemplateValue.actorFallbackPrefix,
      date: formattedReleaseDate,
      studio: data.studio,
      publisher: data.publisher,
    };

    const sourceVideo = parse(fileInfo.filePath);
    const folderRelativePath = truncatePathSegments(
      buildSafePath(config.naming.folderTemplate, templateData),
      config.naming.folderNameMax,
    );
    const fileBaseName = truncateSegment(
      buildSafeFileName(config.naming.fileTemplate, templateData) || styledNumber,
      config.naming.fileNameMax,
    );
    const nfoBaseName = fileInfo.part ? fileBaseName : parse(sourceVideo.base).name;
    const targetVideoFileName = config.behavior.successFileRename
      ? `${fileBaseName}${partSuffix}${fileInfo.extension}`
      : sourceVideo.base;
    const nfoFileName = `${config.behavior.successFileRename ? fileBaseName : nfoBaseName}.nfo`;

    return {
      folderRelativePath,
      targetVideoFileName,
      nfoFileName,
    };
  }

  buildPreview(config: Configuration): NamingPreviewItem[] {
    return NAMING_PREVIEW_SAMPLES.map((sample) => {
      const layout = this.buildLayout(sample.fileInfo, sample.data, config, sample.localState);
      return {
        label: sample.label,
        folder: config.behavior.successFileMove ? layout.folderRelativePath || "当前目录" : "当前目录",
        file: layout.targetVideoFileName,
      };
    });
  }
}
