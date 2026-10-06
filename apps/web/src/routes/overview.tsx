import { toErrorMessage } from "@mdcz/shared/error";
import type { OverviewRecentAcquisitionDto } from "@mdcz/shared/serverDtos";
import { getT, useT } from "@mdcz/views/i18n";
import {
  OverviewHeroStartCard,
  OverviewMaintenanceCard,
  RecentAcquisitionRemoveDialog,
  RecentAcquisitionsGrid,
  SiteHealthCard,
} from "@mdcz/views/overview";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { api, getLibraryAssetSrc } from "../client";
import { queryKeys } from "../lib/queryKeys";
import { ErrorBanner } from "../routeCommon";
import { buildHref } from "../routeHelpers";

export const hasWorkbenchOutput = (input: {
  mediaRootCount: number;
  output?: { fileCount: number; totalBytes: number; rootPath: string | null } | null;
  recentCount: number;
}): boolean =>
  input.mediaRootCount > 0 ||
  Boolean(input.output?.rootPath) ||
  (input.output?.fileCount ?? 0) > 0 ||
  (input.output?.totalBytes ?? 0) > 0 ||
  input.recentCount > 0;

export function OverviewPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [removeTarget, setRemoveTarget] = useState<OverviewRecentAcquisitionDto | null>(null);
  const setupQ = useQuery({ queryKey: queryKeys.setup.status, queryFn: () => api.setup.status(), retry: false });
  const overviewQ = useQuery({
    queryKey: queryKeys.overview.summary,
    queryFn: () => api.overview.summary(),
    retry: false,
  });
  const sitesQ = useQuery({ queryKey: queryKeys.overview.sites, queryFn: () => api.crawler.listSites(), retry: false });
  const output = overviewQ.data?.output;
  const recent = overviewQ.data?.recentAcquisitions ?? [];
  const configured = hasWorkbenchOutput({
    mediaRootCount: setupQ.data?.mediaRootCount ?? 0,
    output,
    recentCount: recent.length,
  });

  return (
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto grid w-full max-w-[1600px] grid-cols-12 gap-8 px-6 py-8 md:px-10 lg:px-12 lg:py-12">
        <section className="col-span-12 grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
          <OverviewHeroStartCard
            className="lg:col-span-2"
            data={output}
            hasConfiguredOutput={configured}
            isError={overviewQ.isError}
            isLoading={setupQ.isLoading || overviewQ.isLoading}
            labels={{ startAction: t.web.goToWorkbench, setupAction: t.web.goToSettings }}
            onSetup={() => {
              void navigate({ to: "/settings" });
            }}
            onStart={() => {
              void navigate({ to: "/workbench" });
            }}
          />
          <OverviewMaintenanceCard
            onOpen={() => {
              void navigate({ to: buildHref("/workbench", { intent: "maintenance" }) });
            }}
          />
        </section>

        <SiteHealthCard
          sites={sitesQ.data?.sites ?? []}
          onOpenSettings={() => {
            void navigate({ to: buildHref("/settings", { section: "scrape" }) });
          }}
        />

        {overviewQ.error && <ErrorBanner>{toErrorMessage(overviewQ.error)}</ErrorBanner>}

        <section className="col-span-12 mt-8">
          <div className="mb-8">
            <h2 className="text-2xl font-bold tracking-tight">{t.web.recentAcquisitions}</h2>
          </div>
          <RecentAcquisitionsGrid
            getImageSrc={(path, item) =>
              getLibraryAssetSrc({ format: "webp", path, rootId: item.thumbnailRootId ?? item.rootId, width: 400 })
            }
            isError={overviewQ.isError}
            isLoading={overviewQ.isLoading}
            items={recent}
            onItemRemove={setRemoveTarget}
            onRetry={() => {
              void queryClient.invalidateQueries({ queryKey: queryKeys.overview.summary });
            }}
          />
        </section>
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
    toast.success(getT().web.removedFromRecent);
    onSuccess();
  } catch (error) {
    toast.error(toErrorMessage(error));
  }
}

export const Route = createFileRoute("/overview")({
  component: OverviewPage,
});
