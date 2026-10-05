import { dirname, extname, join, parse } from "node:path";
import type { SubtitleTag } from "@mdcz/shared/types";
import { DirectoryInventory } from "../DirectoryInventory";
import { parseFileInfo } from "../utils/number";
import {
  detectSubtitleTagFromSidecarSuffix,
  normalizeSubtitleText,
  preferSubtitleTag,
  SUBTITLE_EXTENSIONS,
} from "../utils/subtitles";

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
  const subtitles = await inventory.files(video.dir, (name) => SUBTITLE_EXTENSIONS.has(extname(name).toLowerCase()));
  const siblingVideos = (await inventory.mediaEntries(video.dir)).filter((entry) => entry.name !== video.base);
  const number = parseFileInfo(videoPath).number;
  if (siblingVideos.some((entry) => parseFileInfo(entry.name).number === number)) videoBaseCandidates.splice(1);
  return subtitles.flatMap((entry) => {
    const sidecarBaseName = parse(entry.name).name;
    const ownedBySibling = siblingVideos.some((sibling) => {
      const siblingName = parse(sibling.name).name;
      return siblingName.length > video.name.length && matchSidecarBase(sidecarBaseName, [siblingName]).matched;
    });
    if (ownedBySibling) return [];
    const matched = matchSidecarBase(sidecarBaseName, videoBaseCandidates);
    return matched.matched
      ? [
          {
            path: join(video.dir, entry.name),
            suffix: matched.suffix,
            subtitleTag: detectSubtitleTagFromSidecarSuffix(matched.suffix),
          },
        ]
      : [];
  });
};

export const getPreferredSubtitleTagFromSidecars = (sidecars: SubtitleSidecarMatch[]): SubtitleTag | undefined => {
  return preferSubtitleTag(...sidecars.map((sidecar) => sidecar.subtitleTag));
};

export const buildSubtitleSidecarTargetPath = (sidecar: SubtitleSidecarMatch, targetVideoPath: string): string => {
  const targetVideo = parse(targetVideoPath);
  return join(dirname(targetVideoPath), `${targetVideo.name}${sidecar.suffix}${extname(sidecar.path)}`);
};
