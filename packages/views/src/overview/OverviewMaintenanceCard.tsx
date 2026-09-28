import { Button } from "@mdcz/ui";
import { BrushCleaning } from "lucide-react";
import { useT } from "../i18n";

export interface OverviewMaintenanceCardProps {
  onOpen: () => void;
}

export function OverviewMaintenanceCard({ onOpen }: OverviewMaintenanceCardProps) {
  const t = useT();

  return (
    <section className="flex min-h-[280px] flex-col justify-between rounded-quiet-xl bg-surface-low p-7 text-foreground md:p-8">
      <div>
        <div className="flex items-start justify-between gap-5">
          <h2 className="text-xl font-bold tracking-tight">{t.overview.maintenance.title}</h2>
          <BrushCleaning className="mt-1 h-5 w-5 text-muted-foreground" />
        </div>
        <p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">{t.overview.maintenance.description}</p>
      </div>

      <Button type="button" className="h-12 w-full rounded-quiet-capsule font-bold" onClick={onOpen}>
        {t.overview.maintenance.action}
      </Button>
    </section>
  );
}
