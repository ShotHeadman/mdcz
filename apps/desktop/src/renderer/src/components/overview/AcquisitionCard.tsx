import type { OverviewRecentAcquisitionItem } from "@mdcz/shared/ipc-contracts/overviewContract";
import { FolderOpen, ImageOff } from "lucide-react";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";
import { getImageSrc } from "@/utils/image";
import { getDirFromPath } from "@/utils/path";

interface AcquisitionCardProps {
  item: OverviewRecentAcquisitionItem;
}

export function AcquisitionCard({ item }: AcquisitionCardProps) {
  const imageSrc = item.thumbnailPath ? getImageSrc(item.thumbnailPath) : "";
  const title = item.title?.trim() || item.number;
  const actors = item.actors.filter(Boolean).join(" / ");

  const handleClick = async () => {
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
  };

  return (
    <button
      type="button"
      className="group relative aspect-[2/3] rounded-quiet-lg bg-surface-raised text-left shadow-none outline-none transition duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => {
        void handleClick();
      }}
    >
      <div className="absolute inset-0 overflow-hidden rounded-quiet-lg">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={title}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-8 w-8" />
          </div>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex h-1/3 flex-col justify-end rounded-b-quiet-lg bg-linear-to-t from-surface-floating/92 via-surface-floating/68 to-transparent p-5 text-foreground opacity-95 backdrop-blur-sm transition-opacity group-hover:opacity-100">
        <div className="mb-2 inline-flex max-w-full truncate rounded-quiet-sm font-numeric text-xs font-semibold uppercase tracking-[0.08em] text-foreground/70">
          {item.number}
        </div>
        <div className="line-clamp-1 text-base font-bold leading-tight">{title}</div>
        <div className="mt-1 line-clamp-1 text-sm text-muted-foreground">{actors || "未知演员"}</div>
      </div>
      <div className="absolute right-3 top-3 rounded-quiet-capsule bg-surface-floating/76 p-2 text-foreground opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100">
        <FolderOpen className="h-4 w-4" />
      </div>
    </button>
  );
}
