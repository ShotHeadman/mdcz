import { dirname, join, parse } from "node:path";
import { filesystemPathKey } from "@mdcz/media-store";

export interface VersionCandidate {
  sourcePath: string;
  targetVideoPath: string;
  multipart: boolean;
  height?: number;
  filenameResolution?: string;
  size: number;
}

const FILENAME_K_HEIGHTS: Readonly<Record<string, number>> = { "8K": 4320, "4K": 2160 };

export const versionKey = (videoPath: string): string =>
  filesystemPathKey(join(dirname(videoPath), parse(videoPath).name));

// Only heights that parseFileInfo reads back as a `<height>p` token may become labels, or the next organize
// run could not tell the labeled file apart from its siblings.
const heightOf = (candidate: VersionCandidate): number | undefined => {
  const token = candidate.filenameResolution?.toUpperCase() ?? "";
  const height = candidate.height || FILENAME_K_HEIGHTS[token] || Number.parseInt(token, 10);
  return height >= 100 && height <= 9999 ? height : undefined;
};

/**
 * Emby, Jellyfin and Plex group `Name.ext` with `Name - 2160p.ext` in one folder as versions of one movie,
 * and Jellyfin sorts `<height>p` labels highest first. The unlabeled file is never renamed once in place, and
 * only a file whose resolution is known can carry a label.
 */
export const assignVersionLabels = (
  candidates: readonly VersionCandidate[],
  occupiedKeys: ReadonlySet<string> = new Set(),
): Array<string | undefined> => {
  const labels: Array<string | undefined> = candidates.map(() => undefined);
  const collisions = new Map<string, number[]>();
  for (const [index, candidate] of candidates.entries()) {
    const key = versionKey(candidate.targetVideoPath);
    collisions.set(key, [...(collisions.get(key) ?? []), index]);
  }
  for (const [key, indices] of collisions) {
    const occupied = occupiedKeys.has(key);
    if ((indices.length < 2 && !occupied) || indices.some((index) => candidates[index].multipart)) continue;
    const inPlace = indices.find(
      (index) =>
        filesystemPathKey(candidates[index].sourcePath) === filesystemPathKey(candidates[index].targetVideoPath),
    );
    const unknown = indices.filter((index) => !heightOf(candidates[index]));
    const [best] = indices.toSorted((left, right) => {
      const a = candidates[left];
      const b = candidates[right];
      return (heightOf(b) ?? 0) - (heightOf(a) ?? 0) || b.size - a.size || a.sourcePath.localeCompare(b.sourcePath);
    });
    const unlabeled = occupied ? undefined : (inPlace ?? (unknown.length === 1 ? unknown[0] : best));
    for (const index of indices) {
      const height = heightOf(candidates[index]);
      if (index !== unlabeled && height) labels[index] = `${height}p`;
    }
  }
  return labels;
};
