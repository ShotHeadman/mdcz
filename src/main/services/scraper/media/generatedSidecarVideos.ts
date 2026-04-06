import { dirname, join, parse, resolve } from "node:path";
import { listVideoFiles } from "@main/utils/file";
import { extractNumber, parseFileInfo } from "@main/utils/number";

const FC2_SPECIAL_FEATURE_HINTS = ["花絮", "おまけ", "特典", "gift"];

export interface GeneratedVideoSidecarMatch {
  path: string;
  suffix: string;
}

const extractGeneratedVideoSidecarSuffix = (filePath: string, fc2Number: string): string | undefined => {
  const rawName = parse(filePath).name.normalize("NFC");
  const digits = fc2Number.match(/FC2-(\d{5,})/iu)?.[1];
  if (!digits) {
    return undefined;
  }

  const digitIndex = rawName.toUpperCase().indexOf(digits.toUpperCase());
  if (digitIndex < 0) {
    return undefined;
  }

  const suffix = rawName.slice(digitIndex + digits.length);
  return suffix || undefined;
};

export const isGeneratedSidecarVideo = (filePath: string): boolean => {
  const rawName = parse(filePath).name.normalize("NFC");
  const normalizedName = rawName.toLowerCase();
  if (normalizedName === "trailer") {
    return true;
  }

  if (!extractNumber(rawName).toUpperCase().startsWith("FC2-")) {
    return false;
  }

  return FC2_SPECIAL_FEATURE_HINTS.some((hint) => normalizedName.includes(hint));
};

export const findGeneratedVideoSidecars = async (sourceVideoPath: string): Promise<GeneratedVideoSidecarMatch[]> => {
  const sourceFileInfo = parseFileInfo(sourceVideoPath);
  if (!sourceFileInfo.number.toUpperCase().startsWith("FC2-")) {
    return [];
  }

  const candidates = await listVideoFiles(dirname(sourceVideoPath), false);
  const matches = candidates
    .filter(
      (candidatePath) => resolve(candidatePath) !== resolve(sourceVideoPath) && isGeneratedSidecarVideo(candidatePath),
    )
    .map((candidatePath) => {
      const candidateFileInfo = parseFileInfo(candidatePath);
      if (candidateFileInfo.number.toUpperCase() !== sourceFileInfo.number.toUpperCase()) {
        return undefined;
      }

      const suffix = extractGeneratedVideoSidecarSuffix(candidatePath, sourceFileInfo.number);
      if (!suffix) {
        return undefined;
      }

      return {
        path: candidatePath,
        suffix,
      } satisfies GeneratedVideoSidecarMatch;
    })
    .filter((match): match is GeneratedVideoSidecarMatch => Boolean(match));

  matches.sort((left, right) => left.path.localeCompare(right.path));
  return matches;
};

export const buildGeneratedVideoSidecarTargetPath = (
  sidecar: GeneratedVideoSidecarMatch,
  targetDirectory: string,
  sharedMovieBaseName: string,
): string => {
  return join(targetDirectory, `${sharedMovieBaseName}${sidecar.suffix}${parse(sidecar.path).ext}`);
};
