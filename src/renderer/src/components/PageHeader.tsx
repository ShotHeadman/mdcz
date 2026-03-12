import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  extra?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, icon: Icon, extra, className }: PageHeaderProps) {
  return (
    <div className={cn("px-8 pt-6 pb-4", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-1 items-start gap-3">
          {Icon && (
            <div className="p-2 bg-primary/8 rounded-xl flex-none">
              <Icon className="h-6 w-6 text-primary" />
            </div>
          )}
          <div className="flex-1 pt-0.5">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <div className="text-sm text-muted-foreground mt-1">{subtitle}</div>}
          </div>
        </div>
        {extra && <div className="flex flex-wrap items-center justify-end gap-3">{extra}</div>}
      </div>
    </div>
  );
}
