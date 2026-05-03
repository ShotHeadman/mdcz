import type { OverviewRecentAcquisitionItem } from "@mdcz/shared/ipc-contracts/overviewContract";
import { RecentAcquisitionsGrid as SharedRecentAcquisitionsGrid } from "@mdcz/views/overview";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";
import { useRecentAcquisitions } from "@/hooks/useOverview";
import { getImageSrc } from "@/utils/image";
import { getDirFromPath } from "@/utils/path";

export function RecentAcquisitionsGrid() {
  const recentQ = useRecentAcquisitions();
  const items = recentQ.data?.items ?? [];

  return (
    <SharedRecentAcquisitionsGrid
      getImageSrc={getImageSrc}
      isError={recentQ.isError}
      isLoading={recentQ.isLoading}
      items={items}
      onItemOpen={(item) => {
        void openRecentAcquisition(item);
      }}
      onRetry={() => {
        void recentQ.refetch();
      }}
    />
  );
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

  if (!window.electron?.openPath) {
    toast.error("无法打开系统文件管理器");
    return;
  }

  void window.electron.openPath(getDirFromPath(item.lastKnownPath));
}
