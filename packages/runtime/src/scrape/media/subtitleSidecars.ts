import { dirname, extname, join, parse } from "node:path";
import type { SubtitleTag } from "@mdcz/shared/types";
import { DirectoryInventory } from "../DirectoryInventory";
import { DEFAULT_VIDEO_EXTENSIONS } from "../utils/filesystem";
import { parseFileInfo } from "../utils/number";
import {
  detectSubtitleTagFromSidecarSuffix,
  normalizeSubtitleText,
  preferSubtitleTag,
  SUBTITLE_EXTENSIONS,
} from "../utils/subtitles";
import { isGeneratedSidecarVideo } from "./generatedSidecarVideos";

const SIDE_NAME_SEPARATOR = /^[-_.\s]/u;

const buildVideoBaseCandidates = (videoPath: string): string[] => {
  const video = parse(videoPath);
  const fileInfo = parseFileInfo(videoPath);
  const candidates = [video.name];

  if (!fileInfo.part && fileInfo.number && fileInfo.number !== video.name && !/\(\d+\)$/u.test(video.name)) {
    candidates.push(fileInfo.number);
  }

  return candidates;
};

const matchSidecarBase = (
  sidecarBaseName: string,
  videoBaseNames: string[],
): {
  matched: boolean;
  suffix: string;
} => {
  const normalizedSidecarBase = normalizeSubtitleText(sidecarBaseName);

  for (const videoBaseName of videoBaseNames) {
    const normalizedVideoBase = normalizeSubtitleText(videoBaseName);

    if (normalizedSidecarBase === normalizedVideoBase) {
      return {
        matched: true,
        suffix: "",
      };
    }

    if (!normalizedSidecarBase.startsWith(normalizedVideoBase)) {
      continue;
    }

    const suffix = normalizedSidecarBase.slice(normalizedVideoBase.length);
    if (!suffix || !SIDE_NAME_SEPARATOR.test(suffix) || /^\s*\(\d+\)/u.test(suffix)) {
      continue;
    }

    return {
      matched: true,
      suffix,
    };
  }

  return {
    matched: false,
    suffix: "",
  };
};

export interface SubtitleSidecarMatch {
  path: string;
  suffix: string;
  subtitleTag: SubtitleTag;
}

export const findSubtitleSidecars = async (
  videoPath: string,
  inventory = new DirectoryInventory(),
): Promise<SubtitleSidecarMatch[]> => {
  const video = parse(videoPath);
  const videoBaseCandidates = buildVideoBaseCandidates(videoPath);
  const entries = await inventory.entries(video.dir);
  const siblingVideos = (await inventory.mediaEntries(video.dir)).filter(
    (entry) =>
      (entry.isFile() || entry.isSymbolicLink()) &&
      DEFAULT_VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase()) &&
      entry.name !== video.base &&
      !isGeneratedSidecarVideo(entry.name),
  );
  const number = parseFileInfo(videoPath).number;
  if (siblingVideos.some((entry) => parseFileInfo(entry.name).number === number)) videoBaseCandidates.splice(1);
  const matches = await Promise.all(
    entries.map(async (entry) => {
      if (!SUBTITLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        return null;
      }

      const sidecarPath = join(video.dir, entry.name);
      if (entry.isSymbolicLink()) {
        const targetStats = await inventory.stats(sidecarPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (!targetStats?.isFile()) {
          return null;
        }
      } else if (!entry.isFile()) {
        return null;
      }

      const sidecarBaseName = parse(entry.name).name;
      const ownedBySibling = siblingVideos.some((sibling) => {
        const siblingName = parse(sibling.name).name;
        return siblingName.length > video.name.length && matchSidecarBase(sidecarBaseName, [siblingName]).matched;
      });
      if (ownedBySibling) return null;
      const matched = matchSidecarBase(sidecarBaseName, videoBaseCandidates);
      return matched.matched
        ? {
            path: sidecarPath,
            suffix: matched.suffix,
            subtitleTag: detectSubtitleTagFromSidecarSuffix(matched.suffix),
          }
        : null;
    }),
  );

  const sidecars = matches.filter((entry): entry is SubtitleSidecarMatch => entry !== null);
  for (const sidecar of sidecars) {
    if (
      extname(sidecar.path).toLowerCase() === ".idx" &&
      !sidecars.some((candidate) => candidate.path.toLowerCase() === `${sidecar.path.slice(0, -4).toLowerCase()}.sub`)
    )
      throw new Error(`字幕 IDX 缺少配对的 SUB 文件：${sidecar.path}`);
  }
  return sidecars;
};

export const getPreferredSubtitleTagFromSidecars = (sidecars: SubtitleSidecarMatch[]): SubtitleTag | undefined => {
  return preferSubtitleTag(...sidecars.map((sidecar) => sidecar.subtitleTag));
};

export const buildSubtitleSidecarTargetPath = (sidecar: SubtitleSidecarMatch, targetVideoPath: string): string => {
  const targetVideo = parse(targetVideoPath);
  return join(dirname(targetVideoPath), `${targetVideo.name}${sidecar.suffix}${extname(sidecar.path)}`);
};
