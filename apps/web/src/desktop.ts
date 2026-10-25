import type { DesktopBridge } from "@mdcz/shared/desktopBridge";
import { toErrorMessage } from "@mdcz/shared/error";
import { SUPPORTED_MEDIA_EXTENSIONS } from "@mdcz/shared/mediaExtensions";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { getT } from "@mdcz/views/i18n";
import type { ResolvedTheme } from "@mdcz/views/shell";
import { toast } from "sonner";
import { api } from "./client";
import { queryClient } from "./lib/queryClient";
import { queryKeys } from "./lib/queryKeys";

/** Present only inside the desktop app, whose preload exposes it; its absence means the browser WebUI. */
export const desktop = (globalThis as { mdczDesktop?: DesktopBridge }).mdczDesktop;

export const browseDirectory = desktop && (() => desktop.browse("directory"));

/** Picks a video with the native dialog, then finds or registers the media root that holds it. */
export const browseMediaFile =
  desktop &&
  (async (): Promise<RootFileRef | null> => {
    const path = await desktop.browse("file", [
      { name: getT().tools.mediaFiles, extensions: [...SUPPORTED_MEDIA_EXTENSIONS] },
    ]);
    if (!path) return null;
    const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const root = await api.mediaRoots.ensurePath({ hostPath: path.slice(0, separator + 1) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.mediaRoots.all });
    return {
      rootId: root.id,
      relativePath: [root.relativeDirectory, path.slice(separator + 1)].filter(Boolean).join("/"),
    };
  });

export const openFolder =
  desktop &&
  ((file: RootFileRef) =>
    void desktop
      .showItemInFolder(file)
      .catch((error: unknown) => toast.error(toErrorMessage(error), { id: "file-action" })));

// The native window controls Windows and Linux draw over the title bar follow the page's theme.
export const syncTitleBarTheme =
  desktop && ((theme: ResolvedTheme) => void desktop.syncTitleBarTheme(theme === "dark"));
