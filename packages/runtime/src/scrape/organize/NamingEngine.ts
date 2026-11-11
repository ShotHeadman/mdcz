import { parse } from "node:path";
import type { Configuration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { PublicationTarget } from "@mdcz/shared/mediaLibrary";
import type { CrawlerData, FileInfo, NamingPreviewSampleId, NfoLocalState } from "@mdcz/shared/types";
import { classifyMovie, type MovieClassification } from "../utils/movieClassification";
import { buildSafeFileName, buildSafePath } from "../utils/path";
import { resolveFileInfoSubtitleTag } from "../utils/subtitles";
import { buildMetadataTemplateData } from "../utils/templateData";

export interface NamingLayout {
  folderRelativePath: string;
  targetVideoFileName: string;
  nfoFileName: string;
}

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

const buildNamingMarkers = (
  fileInfo: FileInfo,
  config: Configuration,
  classification: MovieClassification,
): string[] => {
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

  return markers;
};

const buildNumberWithNamingMarkers = (number: string, markers: string[]): string => {
  const baseNumber = number.trim();
  if (!baseNumber) {
    return number;
  }

  return `${baseNumber}${markers.join("")}`;
};

const formatFourKLabel = (definition: string | undefined): string | undefined => {
  if (!definition) {
    return undefined;
  }

  const normalized = definition.toUpperCase();
  if (["8K", "4320P", "UHD8"].includes(normalized)) {
    return "8K";
  }

  if (["4K", "2160P", "UHD"].includes(normalized)) {
    return "4K";
  }

  return undefined;
};

const formatCensorshipType = (classification: MovieClassification): string => {
  if (classification.umr) {
    return "无码破解";
  }

  if (classification.leak) {
    return "无码流出";
  }

  return classification.uncensored ? "无码" : "有码";
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
  resolution: "1080P",
  ...overrides,
});

const previewData = (number: string, overrides?: Partial<CrawlerData>): CrawlerData => ({
  title: "Sample Original Title",
  title_zh: "示例中文标题",
  number,
  actors: ["演员A"],
  genres: [],
  studio: "示例制片",
  director: "示例导演",
  publisher: "示例发行",
  series: "示例系列",
  plot: "Sample plot",
  plot_zh: "示例简介",
  release_date: "2024-01-15",
  durationSeconds: 7260,
  rating: 4.5,
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

export const NAMING_PREVIEW_SAMPLES: Array<{
  sample: NamingPreviewSampleId;
  fileInfo: FileInfo;
  data: CrawlerData;
  localState?: NfoLocalState;
}> = [
  {
    sample: "standard",
    fileInfo: previewFileInfo("ABC-123"),
    data: previewData("ABC-123"),
  },
  {
    sample: "subtitled",
    fileInfo: previewFileInfo("ABC-456", { isSubtitled: true, subtitleTag: "中文字幕", resolution: "2160P" }),
    // The standard sample's actor, so a template that groups movies by actor shows two movies in one folder.
    data: previewData("ABC-456", { title_zh: "中文字幕示例", studio: "Studio X" }),
  },
  {
    sample: "multiActor",
    fileInfo: previewFileInfo("DEF-012"),
    data: previewData("DEF-012", {
      title_zh: "多演员作品",
      actors: ["演员E", "演员F", "演员G", "演员H"],
      studio: "Studio W",
    }),
  },
  {
    sample: "noActor",
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
  buildLayout(
    fileInfo: FileInfo,
    data: CrawlerData,
    config: Configuration,
    target: Pick<PublicationTarget, "placement" | "folderTemplate" | "fileTemplate">,
    localState?: NfoLocalState,
  ): NamingLayout {
    const classification = classifyMovie(fileInfo, data, localState);
    const styledNumber = buildNumberWithNamingMarkers(
      data.number,
      buildNamingMarkers(fileInfo, config, classification),
    );
    const partSuffix = formatPartSuffix(fileInfo, config);
    const definition = fileInfo.resolution?.trim() || undefined;
    const subtitle = resolveFileInfoSubtitleTag(fileInfo);
    const templateData = {
      ...buildMetadataTemplateData(data, config.naming, { missingActor: "Unknown" }),
      number: styledNumber,
      filename: fileInfo.fileName.trim() || parse(fileInfo.filePath).name,
      definition,
      resolution: definition,
      "4K": formatFourKLabel(definition),
      cnword: subtitle === "中文字幕" ? config.naming.cnwordStyle : undefined,
      subtitle,
      censorshipType: formatCensorshipType(classification),
    };

    const sourceVideo = parse(fileInfo.filePath);
    const folderRelativePath = truncatePathSegments(
      buildSafePath(target.folderTemplate, templateData),
      config.naming.folderNameMax,
    );
    const fileBaseName = truncateSegment(
      buildSafeFileName(target.fileTemplate, templateData) || styledNumber,
      config.naming.fileNameMax,
    );
    const sourceBaseName = parse(sourceVideo.base).name;
    const nfoBaseName =
      fileInfo.part && sourceBaseName.endsWith(fileInfo.part.suffix)
        ? sourceBaseName.slice(0, -fileInfo.part.suffix.length)
        : sourceBaseName;
    // In place, the video keeps its name and the NFO follows it; every other placement names its output by template.
    const renamed = target.placement !== "inPlace";
    const targetVideoFileName = renamed ? `${fileBaseName}${partSuffix}${fileInfo.extension}` : sourceVideo.base;
    const nfoFileName = `${renamed ? fileBaseName : nfoBaseName}.nfo`;

    return {
      folderRelativePath,
      targetVideoFileName,
      nfoFileName,
    };
  }
}
