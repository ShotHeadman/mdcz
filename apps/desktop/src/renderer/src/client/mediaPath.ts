export const MEDIA_DIRECTORY_SELECTION_CANCELLED_MESSAGE = "No directory selected.";

export const isMediaDirectorySelectionCancelled = (error: unknown): boolean =>
  error instanceof Error && error.message === MEDIA_DIRECTORY_SELECTION_CANCELLED_MESSAGE;
