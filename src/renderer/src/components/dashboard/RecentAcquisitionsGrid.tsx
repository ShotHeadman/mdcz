import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, Film, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useRecentAcquisitions } from "@/hooks/useDashboard";
import { AcquisitionCard } from "./AcquisitionCard";

const SKELETON_KEYS = ["slot-1", "slot-2", "slot-3", "slot-4", "slot-5", "slot-6", "slot-7", "slot-8"];

export function RecentAcquisitionsGrid() {
  const navigate = useNavigate();
  const recentQ = useRecentAcquisitions();
  const items = recentQ.data?.items ?? [];

  if (recentQ.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
        {SKELETON_KEYS.map((key) => (
          <div key={key} className="aspect-[2/3] animate-pulse rounded-quiet-xl bg-surface-raised" />
        ))}
      </div>
    );
  }

  if (recentQ.isError) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center rounded-quiet-xl bg-surface-low p-8 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <h3 className="mt-4 text-base font-semibold">最近入库加载失败</h3>
        <p className="mt-1 text-sm text-muted-foreground">请稍后重试，或检查应用日志。</p>
        <Button
          type="button"
          variant="outline"
          className="mt-5 rounded-quiet-capsule"
          onClick={() => recentQ.refetch()}
        >
          <Loader2 className="h-4 w-4" />
          重试
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center rounded-quiet-xl bg-surface-low p-8 text-center">
        <Film className="h-9 w-9 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">暂无刮削记录</h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">完成一次刮削后，最近入库的影片会出现在这里。</p>
        <Button
          type="button"
          className="mt-5 rounded-quiet-capsule bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
          onClick={() => navigate({ to: "/" })}
        >
          去工作台
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
      {items.map((item) => (
        <AcquisitionCard key={`${item.number}-${item.completedAt}`} item={item} />
      ))}
    </div>
  );
}
