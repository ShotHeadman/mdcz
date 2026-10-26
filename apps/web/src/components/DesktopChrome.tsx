import type { DesktopBridge } from "@mdcz/shared/desktopBridge";
import { toErrorMessage } from "@mdcz/shared/error";
import {
  buildScrapeResultGroupActionContext,
  findScrapeResultGroup,
} from "@mdcz/shared/viewModels/scrapeResultGrouping";
import { useT } from "@mdcz/views/i18n";
import {
  runScrapeRequest,
  selectIsScraping,
  selectScrapeResults,
  selectScrapeTaskId,
  useScrapeStore,
} from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { useWorkbenchSetupStore } from "@mdcz/views/state/workbenchSetupStore";
import { useLocation } from "@tanstack/react-router";
import { type CSSProperties, useEffect } from "react";
import { toast } from "sonner";
import { createWebScrapeActionPort } from "../adapters/ports";
import { api } from "../client";
import { requestScrapeLiveRunsRefresh } from "../hooks/useWebTaskSync";

const DRAG_STYLE = { WebkitAppRegion: "drag" } as CSSProperties;

/** The strip the native window controls sit in when MDCz draws its own title bar. */
export function DesktopTitleBar() {
  return (
    <header
      className="flex h-9 shrink-0 select-none items-center bg-background"
      style={{ ...DRAG_STYLE, paddingLeft: "max(12px, env(titlebar-area-x, 0px))" }}
    >
      <div className="flex-1" />
      <div aria-hidden="true" className="h-full shrink-0" style={{ width: "env(titlebar-area-width, 138px)" }} />
    </header>
  );
}

const isEditingText = () => {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    (active.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName))
  );
};

/** Keyboard shortcuts main captures for the scrape workbench, and update notices. */
export function DesktopChrome({ desktop }: { desktop: DesktopBridge }) {
  const t = useT();
  const pathname = useLocation().pathname;

  useEffect(
    () =>
      desktop.on("updateStatus", (status) => {
        if (status.phase === "available") {
          const { manualDownloadUrl } = status;
          toast.info(t.about.updateAvailable(status.version), {
            id: "app-update",
            duration: Number.POSITIVE_INFINITY,
            action: manualDownloadUrl
              ? {
                  label: t.about.updateOpenDownload,
                  onClick: () => window.open(manualDownloadUrl, "_blank", "noopener,noreferrer"),
                }
              : { label: t.about.updateDownload, onClick: () => void desktop.downloadUpdate() },
          });
        }
        if (status.phase === "downloaded") {
          toast.success(t.about.updateDownloaded(status.version), {
            id: "app-update",
            duration: Number.POSITIVE_INFINITY,
            action: { label: t.about.updateInstall, onClick: () => void desktop.installUpdate() },
          });
        }
      }),
    [desktop, t],
  );

  useEffect(
    () =>
      desktop.on("shortcut", (action) => {
        // Like other desktop apps, a shortcut with nothing to act on does nothing.
        if (isEditingText() || pathname !== "/workbench" || useUIStore.getState().workbenchMode !== "scrape") return;
        const scrapeState = useScrapeStore.getState();
        const selectedResultId = useUIStore.getState().selectedResultId;
        const group = findScrapeResultGroup(selectScrapeResults(scrapeState), selectedResultId);
        const context = group ? buildScrapeResultGroupActionContext(group, selectedResultId) : undefined;
        const item = context?.selectedItem;
        const file = item ? (item.output ?? { rootId: item.rootId, relativePath: item.relativePath }) : undefined;
        const run = (task: () => Promise<unknown>) =>
          void task().catch((error: unknown) => toast.error(toErrorMessage(error), { id: "shortcut" }));
        const taskId = selectScrapeTaskId(scrapeState);
        switch (action) {
          case "start-or-stop-scrape":
            if (selectIsScraping(scrapeState) && taskId) {
              run(async () => {
                await runScrapeRequest(async () => await api.scrape.stop({ taskId }));
                requestScrapeLiveRunsRefresh();
              });
            } else run(async () => await useWorkbenchSetupStore.getState().startTask?.());
            return;
          case "retry-scrape":
            if (item) run(() => createWebScrapeActionPort().retryFailed([item.fileId]));
            return;
          case "open-folder":
            if (file) run(() => desktop.showItemInFolder(file));
            return;
          case "play-video":
            if (file) run(() => desktop.playMedia(file));
            return;
          case "edit-nfo":
            if (file) {
              window.dispatchEvent(
                new CustomEvent("app:open-nfo", { detail: { path: context?.nfoPath ?? file.relativePath } }),
              );
            }
        }
      }),
    [desktop, pathname],
  );

  return null;
}
