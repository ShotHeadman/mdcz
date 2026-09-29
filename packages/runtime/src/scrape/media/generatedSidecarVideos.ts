import { dirname, join, parse, resolve } from "node:path";
import { isVideoFileName } from "@mdcz/shared/videoClassification";
import type { DirectoryInventory } from "../DirectoryInventory";
import { extractNumber, parseFileInfo } from "../utils/number";

const TRAILER_SUFFIX = /(?:^|[-_.\s])trailer$/iu;
// Only a trailing marker counts: FC2 titles often advertise bonuses (※特典あり), and a main video whose filename
// carries its title must never be skipped as an extra.
const FC2_FEATURE_SUFFIX = /[-_.\s]?(?<=[-_.\s\d])(?:花絮|おまけ|特典|gift|bonus|メイキング|撮影風景)\d*$/iu;

export interface GeneratedVideoSidecarMatch {
  path: string;
  suffix: string;
}

export const isGeneratedSidecarVideo = (filePath: string): boolean => {
  const name = parse(filePath).name.normalize("NFC");
  return (
    TRAILER_SUFFIX.test(name) || (FC2_FEATURE_SUFFIX.test(name) && extractNumber(name).toUpperCase().startsWith("FC2-"))
  );
};

export const isPrimaryVideoFile = (filePath: string): boolean =>
  isVideoFileName(filePath) && !isGeneratedSidecarVideo(filePath);

export const findGeneratedVideoSidecars = async (
  sourceVideoPath: string,
  inventory: DirectoryInventory,
): Promise<GeneratedVideoSidecarMatch[]> => {
  const number = parseFileInfo(sourceVideoPath).number.toUpperCase();
  if (!number.startsWith("FC2-")) {
    return [];
  }

  const directory = dirname(sourceVideoPath);
  const matches: GeneratedVideoSidecarMatch[] = [];
  for (const entry of await inventory.entries(directory)) {
    const path = join(directory, entry.name);
    if (
      !isVideoFileName(entry.name) ||
      !isGeneratedSidecarVideo(entry.name) ||
      resolve(path) === resolve(sourceVideoPath) ||
      parseFileInfo(path).number.toUpperCase() !== number
    )
      continue;
    const name = parse(path).name.normalize("NFC");
    const suffix = (FC2_FEATURE_SUFFIX.exec(name) ?? TRAILER_SUFFIX.exec(name))?.[0];
    if (!suffix) continue;
    if (entry.isFile() || (entry.isSymbolicLink() && (await inventory.stats(path)).isFile())) {
      matches.push({ path, suffix });
    }
  }
  return matches.sort((left, right) => left.path.localeCompare(right.path));
};

export const buildGeneratedVideoSidecarTargetPath = (
  sidecar: GeneratedVideoSidecarMatch,
  targetDirectory: string,
  sharedMovieBaseName: string,
): string => {
  return join(targetDirectory, `${sharedMovieBaseName}${sidecar.suffix}${parse(sidecar.path).ext}`);
};
