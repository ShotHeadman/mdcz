import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, BrushCleaning } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function DashboardMaintenanceCard() {
  const navigate = useNavigate();

  return (
    <section className="flex min-h-[280px] flex-col justify-between rounded-quiet-xl bg-surface-low p-7 text-foreground md:p-8">
      <div>
        <div className="flex items-start justify-between gap-5">
          <h2 className="text-xl font-bold tracking-tight">维护</h2>
          <BrushCleaning className="mt-1 h-5 w-5 text-muted-foreground" />
        </div>
        <p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">
          预览目录变更、修复元数据并处理批量重写，让输出目录保持干净一致。
        </p>
      </div>

      <Button
        type="button"
        className="h-12 w-full rounded-quiet-capsule bg-black font-bold text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
        onClick={() => navigate({ to: "/" })}
      >
        去工作台
        <ArrowRight className="h-4 w-4" />
      </Button>
    </section>
  );
}
