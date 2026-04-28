import { ipc } from "@/client/ipc";
import type { ConfigOutput } from "@/client/types";

export const MEDIA_DIRECTORY_SELECTION_CANCELLED_MESSAGE = "No directory selected.";

const resolveCurrentConfig = async (currentConfig?: ConfigOutput): Promise<ConfigOutput> =>
  currentConfig ?? ((await ipc.config.get()) as ConfigOutput);

export const isMediaDirectorySelectionCancelled = (error: unknown): boolean =>
  error instanceof Error && error.message === MEDIA_DIRECTORY_SELECTION_CANCELLED_MESSAGE;

export const chooseMediaDirectory = async (currentConfig?: ConfigOutput): Promise<string> => {
  const resolvedConfig = await resolveCurrentConfig(currentConfig);
  const selection = await ipc.file.browse("directory");
  const mediaPath = selection.paths?.[0]?.trim() ?? "";

  if (!mediaPath) {
    throw new Error(MEDIA_DIRECTORY_SELECTION_CANCELLED_MESSAGE);
  }

  await ipc.config.save({
    paths: {
      ...(resolvedConfig.paths ?? {}),
      mediaPath,
    },
  });

  return mediaPath;
};

export const ensureMediaPathConfigured = async (currentConfig?: ConfigOutput): Promise<string> => {
  const resolvedConfig = await resolveCurrentConfig(currentConfig);
  const mediaPath = resolvedConfig.paths?.mediaPath?.trim() ?? "";

  if (mediaPath) {
    return mediaPath;
  }

  return await chooseMediaDirectory(resolvedConfig);
};
