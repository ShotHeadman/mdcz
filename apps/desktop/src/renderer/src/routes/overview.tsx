import { createFileRoute } from "@tanstack/react-router";
import { OverviewHeroStartCard } from "@/components/overview/OverviewHeroStartCard";
import { OverviewMaintenanceCard } from "@/components/overview/OverviewMaintenanceCard";
import { RecentAcquisitionsGrid } from "@/components/overview/RecentAcquisitionsGrid";

export const Route = createFileRoute("/overview")({
  component: Overview,
});

function Overview() {
  return (
    <div className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <main className="mx-auto grid w-full max-w-[1600px] grid-cols-12 gap-8 px-6 py-8 md:px-10 lg:px-12 lg:py-12">
        <section className="col-span-12 grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
          <OverviewHeroStartCard className="lg:col-span-2" />
          <OverviewMaintenanceCard />
        </section>

        <section className="col-span-12 mt-8">
          <h2 className="mb-8 text-2xl font-bold tracking-tight">最近入库</h2>
          <RecentAcquisitionsGrid />
        </section>
      </main>
    </div>
  );
}
