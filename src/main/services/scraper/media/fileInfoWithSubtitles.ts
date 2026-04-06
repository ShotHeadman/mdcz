import { parseFileInfo } from "@main/utils/number";
import { preferSubtitleTag } from "@main/utils/subtitles";
import type { FileInfo } from "@shared/types";
import {
  findSubtitleSidecars,
  getPreferredSubtitleTagFromSidecars,
  type SubtitleSidecarMatch,
} from "./subtitleSidecars";

export interface FileInfoWithSubtitles {
  fileInfo: FileInfo;
  subtitleSidecars: SubtitleSidecarMatch[];
}

export interface ResolveFileInfoWithSubtitlesOptions {
  escapeStrings?: string[];
  parsedFileInfo?: FileInfo;
  subtitleSidecars?: SubtitleSidecarMatch[];
}

export const resolveFileInfoWithSubtitles = async (
  filePath: string,
  options: ResolveFileInfoWithSubtitlesOptions = {},
): Promise<FileInfoWithSubtitles> => {
  const parsedFileInfo = options.parsedFileInfo ?? parseFileInfo(filePath, options.escapeStrings ?? []);
  const subtitleSidecars = options.subtitleSidecars ?? (await findSubtitleSidecars(filePath));
  const subtitleTag = preferSubtitleTag(
    parsedFileInfo.subtitleTag,
    getPreferredSubtitleTagFromSidecars(subtitleSidecars),
  );

  return {
    fileInfo: {
      ...parsedFileInfo,
      isSubtitled: parsedFileInfo.isSubtitled || subtitleSidecars.length > 0,
      subtitleTag,
    },
    subtitleSidecars,
  };
};
