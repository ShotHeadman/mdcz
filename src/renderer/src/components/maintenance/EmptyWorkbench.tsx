import { FolderPlus, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface EmptyWorkbenchProps {
  variant: "no-path" | "ready";
  mediaPath?: string;
  action?: () => void;
}

export default function EmptyWorkbench({ variant, action }: EmptyWorkbenchProps) {
  if (variant === "no-path") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8 animate-in fade-in duration-500">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/40 transition-colors hover:bg-muted/60">
          <FolderPlus className="h-8 w-8 text-muted-foreground/70" strokeWidth={1.5} />
        </div>

        <h3 className="mb-2 text-base font-medium text-foreground tracking-tight">未配置媒体目录</h3>
        <p className="mb-6 max-w-[320px] text-center text-[13px] text-muted-foreground leading-relaxed">
          请选择包含待处理媒体文件的根目录
        </p>

        {action && (
          <Button
            onClick={action}
            className="h-9 px-6 font-medium shadow-sm transition-transform hover:-translate-y-0.5"
          >
            选择目录
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8 animate-in fade-in duration-700 select-none">
      <ScanLine className="mb-4 h-12 w-12 text-muted-foreground/30" strokeWidth={1} />
      <span className="text-[13px] font-medium text-muted-foreground/40">就绪</span>
    </div>
  );
}
