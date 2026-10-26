import { toErrorMessage } from "@mdcz/shared/error";
import type { OverviewRecentAcquisitionDto } from "@mdcz/shared/serverDtos";
import { openNewWorkbenchTask } from "@mdcz/views/adapters/workbenchSession";
import { useT } from "@mdcz/views/i18n";
import {
  ActivityTimelineCard,
  hasActiveActivity,
  OverviewHeroStartCard,
  OverviewMaintenanceCard,
  RecentAcquisitionRemoveDialog,
  RecentAcquisitionsGrid,
  SiteHealthCard,
} from "@mdcz/views/overview";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { createWebMaintenanceActionPort } from "../adapters/ports";
import { api, getLibraryAssetSrc } from "../client";
import { openFolder } from "../desktop";
import { queryKeys } from "../lib/queryKeys";
import { ErrorBanner } from "../routeCommon";
import { buildHref } from "../routeHelpers";

export function OverviewPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const maintenancePort = useMemo(() => createWebMaintenanceActionPort(), []);
  const [removeTarget, setRemoveTarget] = useState<OverviewRecentAcquisitionDto | null>(null);
  const librariesQ = useQuery({ queryKey: queryKeys.libraries.all, queryFn: () => api.libraries.list() });
  const overviewQ = useQuery({
    queryKey: queryKeys.overview.summary,
    queryFn: () => api.overview.summary(),
  });
  const sitesQ = useQuery({ queryKey: queryKeys.overview.sites, queryFn: () => api.crawler.listSites() });
  const activityQ = useQuery({
    queryKey: queryKeys.activity.list,
    queryFn: () => api.activity.list({ limit: 12 }),
    refetchInterval: (query) => (hasActiveActivity(query.state.data?.entries ?? []) ? 3_000 : false),
  });
  const openWorkbench = async (mode: "scrape" | "maintenance") => {
    try {
      await openNewWorkbenchTask(mode, () => maintenancePort.discardSession());
      await navigate(
        mode === "maintenance" ? { to: buildHref("/workbench", { intent: "maintenance" }) } : { to: "/workbench" },
      );
    } catch (error) {
      toast.error(toErrorMessage(error), { id: "workbench-open" });
    }
  };
  const recent = overviewQ.data?.recentAcquisitions ?? [];

  return (
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto grid w-full max-w-[1600px] grid-cols-12 gap-6 px-6 py-6 md:px-10 lg:px-12 lg:py-8">
        <section className="col-span-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <OverviewHeroStartCard
            className="lg:col-span-2"
            data={overviewQ.data?.output}
            hasConfiguredOutput={(librariesQ.data?.libraries.length ?? 0) > 0}
            isError={overviewQ.isError}
            isLoading={librariesQ.isLoading || overviewQ.isLoading}
            labels={{ startAction: t.web.goToWorkbench, setupAction: t.libraries.createFirst }}
            onSetup={() => {
              void navigate({ to: "/libraries" });
            }}
            onStart={() => void openWorkbench("scrape")}
          />
          <OverviewMaintenanceCard onOpen={() => void openWorkbench("maintenance")} />
        </section>

        <SiteHealthCard
          sites={sitesQ.data?.sites ?? []}
          onOpenSettings={() => {
            void navigate({ to: buildHref("/settings", { section: "scrape" }) });
          }}
        />

        {overviewQ.error && <ErrorBanner>{toErrorMessage(overviewQ.error)}</ErrorBanner>}

        <section className="col-span-12">
          <div className="mb-4">
            <h2 className="text-xl font-bold tracking-tight">{t.web.recentAcquisitions}</h2>
          </div>
          <RecentAcquisitionsGrid
            getImageSrc={(path, item) =>
              getLibraryAssetSrc({ format: "webp", path, rootId: item.thumbnailRootId ?? item.rootId, width: 400 })
            }
            isError={overviewQ.isError}
            isLoading={overviewQ.isLoading}
            items={recent}
            onItemOpen={openFolder}
            onItemRemove={setRemoveTarget}
            onRetry={() => {
              void queryClient.invalidateQueries({ queryKey: queryKeys.overview.summary });
            }}
          />
        </section>

        <ActivityTimelineCard
          entries={activityQ.data?.entries ?? []}
          onOpenMaintenance={() => {
            void navigate({ to: buildHref("/workbench", { intent: "maintenance" }) });
          }}
        />
      </div>
      <RecentAcquisitionRemoveDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        onConfirm={() => {
          const target = removeTarget;
          if (!target) return;
          void removeRecentAcquisition(target, () => {
            setRemoveTarget(null);
            void queryClient.invalidateQueries({ queryKey: queryKeys.overview.summary });
          });
        }}
      />
    </main>
  );
}

async function removeRecentAcquisition(item: OverviewRecentAcquisitionDto, onSuccess: () => void) {
  try {
    await api.overview.removeRecentAcquisition({ id: item.id });
    onSuccess();
  } catch (error) {
    toast.error(toErrorMessage(error), { id: "recent-acquisition" });
  }
}

export const Route = createFileRoute("/overview")({
  component: OverviewPage,
});
