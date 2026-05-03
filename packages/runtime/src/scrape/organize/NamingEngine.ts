import { parse } from "node:path";
import type { Configuration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData, FileInfo, NamingPreviewItem, NfoLocalState } from "@mdcz/shared/types";
import { classifyMovie, type MovieClassification } from "../utils/movieClassification";
import { buildSafeFileName, buildSafePath } from "../utils/path";
import { resolveFileInfoSubtitleTag } from "../utils/subtitles";

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

const extractReleaseYear = (releaseDate: string | undefined): string | undefined => {
  const match = releaseDate?.trim().match(/^(\d{4})/u);
  return match?.[1];
};

const formatRuntimeMinutes = (durationSeconds: number | undefined): string | undefined => {
  if (durationSeconds === undefined || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return undefined;
  }

  return String(Math.max(1, Math.round(durationSeconds / 60)));
};

const getNumberLetters = (number: string): string | undefined => {
  const normalized = number.trim();
  if (!normalized) {
    return undefined;
  }

  const upper = normalized.toUpperCase();
  for (const prefix of ["FC2", "MYWIFE", "KIN8", "S2M", "T28", "TH101", "XXX-AV"]) {
    if (upper.startsWith(prefix)) {
      return prefix;
    }
  }

  const match = normalized.match(/(\d*[A-Za-z]+)\d*/u);
  return match?.[1]?.toUpperCase();
};

const getNumberFirstLetter = (number: string): string | undefined => {
  const first = number.trim().charAt(0).toUpperCase();
  if (!first) {
    return undefined;
  }

  return /[0-9A-Z]/u.test(first) ? first : "#";
};

const formatDefinition = (fileInfo: FileInfo): string | undefined => {
  const resolution = fileInfo.resolution?.trim();
  return resolution || undefined;
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

const toTemplateValue = (value: string | number | undefined): string | number | undefined => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
    fileInfo: previewFileInfo("ABC-456", { isSubtitled: true, subtitleTag: "中文字幕", resolution: "2160P" }),
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
    const classification = classifyMovie(fileInfo, data, localState);
    const markers = buildNamingMarkers(fileInfo, config, classification);
    const styledNumber = buildNumberWithNamingMarkers(data.number, markers);
    const partSuffix = formatPartSuffix(fileInfo, config);
    const formattedReleaseDate = formatReleaseDateByRule(data.release_date, config.naming.releaseRule);
    const rawActors = (data.actors ?? []).map((actor) => actor.trim()).filter((actor) => actor.length > 0);
    const firstActor = rawActors[0] ?? actorTemplateValue.actor;
    const allActors = rawActors.length > 0 ? rawActors.join(" ") : actorTemplateValue.actor;
    const outline = data.plot_zh?.trim() || data.plot?.trim();
    const definition = formatDefinition(fileInfo);
    const fourK = formatFourKLabel(definition);
    const cnword = resolveFileInfoSubtitleTag(fileInfo) === "中文字幕" ? config.naming.cnwordStyle : undefined;
    const sourceFileName = fileInfo.fileName.trim() || parse(fileInfo.filePath).name;
    const censorshipType = formatCensorshipType(classification);
    const templateData = {
      title,
      originaltitle,
      number: styledNumber,
      rawNumber: data.number,
      actor: actorTemplateValue.actor,
      actorFallbackPrefix: actorTemplateValue.actorFallbackPrefix,
      date: formattedReleaseDate,
      release: formattedReleaseDate,
      year: extractReleaseYear(data.release_date),
      runtime: formatRuntimeMinutes(data.durationSeconds),
      director: data.director,
      series: data.series,
      studio: data.studio,
      publisher: data.publisher,
      outline,
      plot: outline,
      firstActor,
      allActors,
      letters: getNumberLetters(data.number),
      firstLetter: getNumberFirstLetter(data.number),
      filename: sourceFileName,
      definition,
      resolution: definition,
      "4K": fourK,
      cnword,
      subtitle: resolveFileInfoSubtitleTag(fileInfo),
      censorshipType,
      score: toTemplateValue(data.rating),
      rating: toTemplateValue(data.rating),
      website: data.website,
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
