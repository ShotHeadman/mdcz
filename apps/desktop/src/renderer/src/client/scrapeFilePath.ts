import { SUPPORTED_MEDIA_EXTENSIONS } from "@mdcz/shared/mediaExtensions";
import { getT } from "@mdcz/views/i18n";
import { ipc } from "@/client/ipc";

export const getScrapeFileFilters = () => [
  {
    name: getT().desktop.mediaFiles,
    extensions: [...SUPPORTED_MEDIA_EXTENSIONS],
  },
];

export const chooseScrapeFilePath = async (): Promise<string | null> => {
  const selection = await ipc.file.browse("file", getScrapeFileFilters());
  const selectedPath = selection.paths?.[0]?.trim() ?? "";
  return selectedPath || null;
};
