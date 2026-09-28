import type { OverviewRecentAcquisitionItem } from "@mdcz/shared/ipc-contracts/overviewContract";
import { getT } from "@mdcz/views/i18n";
import {
  RecentAcquisitionRemoveDialog,
  RecentAcquisitionsGrid as SharedRecentAcquisitionsGrid,
} from "@mdcz/views/overview";
import { useState } from "react";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";
import { useRecentAcquisitions } from "@/hooks/useOverview";
import { getImageSrc } from "@/utils/image";

export function RecentAcquisitionsGrid() {
  const recentQ = useRecentAcquisitions();
  const items = recentQ.data?.items ?? [];
  const [removeTarget, setRemoveTarget] = useState<OverviewRecentAcquisitionItem | null>(null);

  return (
    <>
      <SharedRecentAcquisitionsGrid
        getImageSrc={(path, item) => getImageSrc(path, item.thumbnailRootId ?? item.rootId)}
        isError={recentQ.isError}
        isLoading={recentQ.isLoading}
        items={items}
        onItemOpen={(item) => {
          void openRecentAcquisition(item);
        }}
        onItemRemove={setRemoveTarget}
        onRetry={() => {
          void recentQ.refetch();
        }}
      />
      <RecentAcquisitionRemoveDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        onConfirm={() => {
          const target = removeTarget;
          if (!target) return;
          void removeRecentAcquisition(target, () => {
            setRemoveTarget(null);
            void recentQ.refetch();
          });
        }}
      />
    </>
  );
}

async function removeRecentAcquisition(item: OverviewRecentAcquisitionItem, onSuccess: () => void) {
  try {
    await ipc.overview.removeRecentAcquisition(item.id);
    toast.success(getT().desktop.removedFromRecent);
    onSuccess();
  } catch {
    toast.error(getT().desktop.removeFromRecentFailed);
  }
}

async function openRecentAcquisition(item: OverviewRecentAcquisitionItem) {
  if (!item.lastKnownPath) {
    toast.info(getT().desktop.noKnownPath);
    return;
  }

  try {
    const result = await ipc.file.exists(item.lastKnownPath);
    if (!result.exists) {
      toast.error(getT().desktop.fileMovedOrDeleted);
      return;
    }
  } catch {
    toast.error(getT().desktop.fileMovedOrDeleted);
    return;
  }

  try {
    await ipc.app.showItemInFolder(item.lastKnownPath);
  } catch {
    toast.error(getT().desktop.cannotOpenFileExplorer);
  }
}
