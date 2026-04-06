import { readdir, stat } from "node:fs/promises";
import { dirname, extname, join, parse } from "node:path";

import {
  detectSubtitleTagFromSidecarSuffix,
  normalizeSubtitleText,
  preferSubtitleTag,
  SUBTITLE_EXTENSIONS,
} from "@main/utils/subtitles";
import type { SubtitleTag } from "@shared/types";

const SIDE_NAME_SEPARATOR = /^[-_.\s]/u;

const matchSidecarBase = (
  sidecarBaseName: string,
  videoBaseName: string,
): {
  matched: boolean;
  suffix: string;
} => {
  const normalizedSidecarBase = normalizeSubtitleText(sidecarBaseName);
  const normalizedVideoBase = normalizeSubtitleText(videoBaseName);

  if (normalizedSidecarBase === normalizedVideoBase) {
    return {
      matched: true,
      suffix: "",
    };
  }

  if (!normalizedSidecarBase.startsWith(normalizedVideoBase)) {
    return {
      matched: false,
      suffix: "",
    };
  }

  const suffix = normalizedSidecarBase.slice(normalizedVideoBase.length);
  if (!suffix || !SIDE_NAME_SEPARATOR.test(suffix)) {
    return {
      matched: false,
      suffix: "",
    };
  }

  return {
    matched: true,
    suffix,
  };
};

export interface SubtitleSidecarMatch {
  path: string;
  suffix: string;
  subtitleTag: SubtitleTag;
}

export const findSubtitleSidecars = async (videoPath: string): Promise<SubtitleSidecarMatch[]> => {
  const video = parse(videoPath);
  const entries = await readdir(video.dir, { withFileTypes: true }).catch(() => []);
  const matches = await Promise.all(
    entries.map(async (entry) => {
      if (!SUBTITLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        return null;
      }

      const sidecarPath = join(video.dir, entry.name);
      if (entry.isSymbolicLink()) {
        const targetStats = await stat(sidecarPath).catch(() => null);
        if (!targetStats?.isFile()) {
          return null;
        }
      } else if (!entry.isFile()) {
        return null;
      }

      const sidecarBaseName = parse(entry.name).name;
      const matched = matchSidecarBase(sidecarBaseName, video.name);
      return matched.matched
        ? {
            path: sidecarPath,
            suffix: matched.suffix,
            subtitleTag: detectSubtitleTagFromSidecarSuffix(matched.suffix),
          }
        : null;
    }),
  );

  return matches.filter((entry): entry is SubtitleSidecarMatch => entry !== null);
};

export const getPreferredSubtitleTagFromSidecars = (sidecars: SubtitleSidecarMatch[]): SubtitleTag | undefined => {
  return preferSubtitleTag(...sidecars.map((sidecar) => sidecar.subtitleTag));
};

export const buildSubtitleSidecarTargetPath = (sidecar: SubtitleSidecarMatch, targetVideoPath: string): string => {
  const targetVideo = parse(targetVideoPath);
  return join(dirname(targetVideoPath), `${targetVideo.name}${sidecar.suffix}${extname(sidecar.path)}`);
};
