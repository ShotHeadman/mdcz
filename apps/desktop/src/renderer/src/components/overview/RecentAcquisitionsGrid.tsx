import type { OverviewRecentAcquisitionItem } from "@mdcz/shared/ipc-contracts/overviewContract";
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
        getImageSrc={getImageSrc}
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
    toast.success("已从最近入库移除");
    onSuccess();
  } catch {
    toast.error("移除最近入库记录失败");
  }
}

async function openRecentAcquisition(item: OverviewRecentAcquisitionItem) {
  if (!item.lastKnownPath) {
    toast.info("无已知路径");
    return;
  }

  try {
    const result = await ipc.file.exists(item.lastKnownPath);
    if (!result.exists) {
      toast.error("文件已移动或删除,无法定位原位置");
      return;
    }
  } catch {
    toast.error("文件已移动或删除,无法定位原位置");
    return;
  }

  try {
    await ipc.app.showItemInFolder(item.lastKnownPath);
  } catch {
    toast.error("无法打开系统文件管理器");
  }
}
