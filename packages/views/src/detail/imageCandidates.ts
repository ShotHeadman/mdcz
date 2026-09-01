import { buildMovieAssetFileNames, isMovieNfoBaseName } from "@mdcz/shared/assetNaming";
import { resolveImagePath } from "@mdcz/shared/imageSource";
import { LOCAL_FILE_SCHEME, parseLocalFileUrl } from "@mdcz/shared/mediaRef";
import type { DetailViewItem } from "./types";

const getPathBaseName = (path: string | undefined): string => {
  const trimmed = path?.trim();
  if (!trimmed) {
    return "";
  }

  const normalizedPath = trimmed.replace(/[\\/]+$/u, "");
  const separatorIndex = Math.max(normalizedPath.lastIndexOf("/"), normalizedPath.lastIndexOf("\\"));
  const fileName = separatorIndex >= 0 ? normalizedPath.slice(separatorIndex + 1) : normalizedPath;
  const extensionIndex = fileName.lastIndexOf(".");
  return extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
};

const resolveMovieBaseName = (item: DetailViewItem | null | undefined): string => {
  const videoBaseName = getPathBaseName(item?.path);
  if (videoBaseName) {
    return videoBaseName;
  }

  const nfoBaseName = getPathBaseName(item?.nfoPath);
  if (nfoBaseName && !isMovieNfoBaseName(nfoBaseName)) {
    return nfoBaseName;
  }

  return item?.number?.trim() ?? "";
};

const buildSiblingPath = (filePath: string, fileName: string): string => {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const separator = filePath.lastIndexOf("\\") > filePath.lastIndexOf("/") ? "\\" : "/";
  if (slash < 0) {
    return fileName;
  }

  return `${filePath.slice(0, slash)}${separator}${fileName}`;
};

const getImageBaseDir = (filePath: string | undefined, outputPath: string | undefined): string => {
  if (outputPath) {
    return outputPath;
  }

  if (!filePath) {
    return "";
  }

  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (slash < 0) {
    return "";
  }

  return filePath.slice(0, slash) || filePath[0] || "";
};

const buildLocalImageCandidate = (
  filePath: string | undefined,
  outputPath: string | undefined,
  fileName: string,
): string => {
  if (outputPath) {
    const separator = outputPath.lastIndexOf("\\") > outputPath.lastIndexOf("/") ? "\\" : "/";
    return `${outputPath}${separator}${fileName}`;
  }

  if (filePath) {
    return buildSiblingPath(filePath, fileName);
  }

  return "";
};

interface ImageSourceCandidatesInput {
  remotePath?: string;
  filePath?: string;
  outputPath?: string;
  fileName: string;
}

const buildImageSourceCandidates = (input: ImageSourceCandidatesInput): { primary: string; fallback: string } => {
  const fallback = buildLocalImageCandidate(input.filePath, input.outputPath, input.fileName);
  const baseDir = getImageBaseDir(input.filePath, input.outputPath);
  const primary = resolveImagePath(input.remotePath, baseDir) || fallback;

  return {
    primary,
    fallback,
  };
};

const dedupeCandidates = (candidates: string[]): string[] =>
  candidates
    .map((candidate) => candidate.trim())
    .filter((candidate, index, items) => candidate && items.indexOf(candidate) === index);

export interface DetailArtworkCandidates {
  poster: string[];
  thumb: string[];
}

export const getDetailLocalAssetRef = (item: DetailViewItem | null | undefined, path: string | undefined) => {
  if (path?.startsWith(`${LOCAL_FILE_SCHEME}://`)) {
    return parseLocalFileUrl(path);
  }
  const normalizedPath = path?.replace(/\\/gu, "/");
  if (!normalizedPath) return undefined;
  const asset = item?.assets?.find(
    (candidate) => candidate.type === "local" && candidate.file.relativePath.replace(/\\/gu, "/") === normalizedPath,
  );
  return asset?.type === "local" ? asset.file : undefined;
};

export const buildDetailArtworkCandidates = (item: DetailViewItem | null | undefined): DetailArtworkCandidates => {
  if (!item) {
    return { poster: [], thumb: [] };
  }

  const assetBasePath = item.path ?? item.nfoPath;
  const movieAssetFileNames = buildMovieAssetFileNames(resolveMovieBaseName(item), "followVideo");
  const posterCandidates = buildImageSourceCandidates({
    remotePath: item.posterUrl,
    filePath: assetBasePath,
    outputPath: item.outputPath,
    fileName: "poster.jpg",
  });
  const thumbCandidates = buildImageSourceCandidates({
    remotePath: item.thumbUrl ?? item.fanartUrl,
    filePath: assetBasePath,
    outputPath: item.outputPath,
    fileName: "thumb.jpg",
  });
  const posterSource = item.posterUrl;
  if (posterSource && getDetailLocalAssetRef(item, posterSource)) {
    posterCandidates.primary = posterSource;
  }
  const thumbSource = item.thumbUrl ?? item.fanartUrl;
  if (thumbSource && getDetailLocalAssetRef(item, thumbSource)) {
    thumbCandidates.primary = thumbSource;
  }

  return {
    poster: dedupeCandidates([
      posterCandidates.primary,
      buildLocalImageCandidate(assetBasePath, item.outputPath, movieAssetFileNames.poster),
      posterCandidates.fallback,
    ]),
    thumb: dedupeCandidates([
      thumbCandidates.primary,
      buildLocalImageCandidate(assetBasePath, item.outputPath, movieAssetFileNames.thumb),
      thumbCandidates.fallback,
    ]),
  };
};
