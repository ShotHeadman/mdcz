import {
  findGeneratedVideoSidecars,
  findSubtitleSidecars,
  type GeneratedVideoSidecarMatch,
  type SubtitleSidecarMatch,
} from "../media";

export interface ResolvedBundledSidecars {
  subtitleSidecars: SubtitleSidecarMatch[];
  generatedVideoSidecars: GeneratedVideoSidecarMatch[];
}

export class SidecarResolver {
  async resolve(sourceVideoPath: string, subtitleSidecars?: SubtitleSidecarMatch[]): Promise<ResolvedBundledSidecars> {
    return {
      subtitleSidecars: subtitleSidecars ?? (await findSubtitleSidecars(sourceVideoPath)),
      generatedVideoSidecars: await findGeneratedVideoSidecars(sourceVideoPath),
    };
  }

  async resolveSubtitleSidecars(
    sourceVideoPath: string,
    subtitleSidecars?: SubtitleSidecarMatch[],
  ): Promise<SubtitleSidecarMatch[]> {
    return subtitleSidecars ?? (await findSubtitleSidecars(sourceVideoPath));
  }
}
