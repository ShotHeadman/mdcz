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
  const suffixOf = (fileName: string) => {
    const name = parse(fileName).name.normalize("NFC");
    return (FC2_FEATURE_SUFFIX.exec(name) ?? TRAILER_SUFFIX.exec(name))?.[0];
  };
  const sidecars = await inventory.files(
    directory,
    (name) =>
      isVideoFileName(name) &&
      isGeneratedSidecarVideo(name) &&
      resolve(directory, name) !== resolve(sourceVideoPath) &&
      parseFileInfo(join(directory, name)).number.toUpperCase() === number &&
      suffixOf(name) !== undefined,
  );
  return sidecars
    .map((entry) => ({ path: join(directory, entry.name), suffix: suffixOf(entry.name) as string }))
    .sort((left, right) => left.path.localeCompare(right.path));
};

export const buildGeneratedVideoSidecarTargetPath = (
  sidecar: GeneratedVideoSidecarMatch,
  targetDirectory: string,
  sharedMovieBaseName: string,
): string => {
  return join(targetDirectory, `${sharedMovieBaseName}${sidecar.suffix}${parse(sidecar.path).ext}`);
};
