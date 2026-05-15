import { toErrorMessage } from "@mdcz/shared/error";
import type { OverviewRecentAcquisitionDto } from "@mdcz/shared/serverDtos";
import {
  OverviewHeroStartCard,
  OverviewMaintenanceCard,
  RecentAcquisitionRemoveDialog,
  RecentAcquisitionsGrid,
} from "@mdcz/views/overview";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { api, getLibraryAssetSrc } from "../client";
import { ErrorBanner } from "../routeCommon";
import { buildHref } from "../routeHelpers";

export const hasWorkbenchOutput = (input: {
  configured: boolean;
  output?: { fileCount: number; totalBytes: number; rootPath: string | null } | null;
  recentCount: number;
}): boolean =>
  input.configured ||
  Boolean(input.output?.rootPath) ||
  (input.output?.fileCount ?? 0) > 0 ||
  (input.output?.totalBytes ?? 0) > 0 ||
  input.recentCount > 0;

export function OverviewPage() {
  const [removeTarget, setRemoveTarget] = useState<OverviewRecentAcquisitionDto | null>(null);
  const setupQ = useQuery({ queryKey: ["setup"], queryFn: () => api.setup.status(), retry: false });
  const overviewQ = useQuery({
    queryKey: ["overview", "summary"],
    queryFn: () => api.overview.summary(),
    retry: false,
  });
  const output = overviewQ.data?.output;
  const recent = overviewQ.data?.recentAcquisitions ?? [];
  const configured = hasWorkbenchOutput({
    configured: Boolean(setupQ.data?.configured),
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
            labels={{ startAction: "去工作台", setupAction: "去初始化" }}
            onSetup={() => {
              window.location.href = "/setup";
            }}
            onStart={() => {
              window.location.href = "/workbench";
            }}
          />
          <OverviewMaintenanceCard
            onOpen={() => {
              window.location.href = buildHref("/workbench", { intent: "maintenance" });
            }}
          />
        </section>

        {overviewQ.error && <ErrorBanner>{toErrorMessage(overviewQ.error)}</ErrorBanner>}

        <section className="col-span-12 mt-8">
          <div className="mb-8">
            <h2 className="text-2xl font-bold tracking-tight">最近入库</h2>
          </div>
          <RecentAcquisitionsGrid
            getImageSrc={(path, item) => getLibraryAssetSrc({ path, rootId: item.rootId })}
            isError={overviewQ.isError}
            isLoading={overviewQ.isLoading}
            items={recent}
            onItemRemove={setRemoveTarget}
            onRetry={() => {
              void overviewQ.refetch();
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
            void overviewQ.refetch();
          });
        }}
      />
    </main>
  );
}

async function removeRecentAcquisition(item: OverviewRecentAcquisitionDto, onSuccess: () => void) {
  try {
    await api.overview.removeRecentAcquisition({ id: item.id });
    toast.success("已从最近入库移除");
    onSuccess();
  } catch (error) {
    toast.error(toErrorMessage(error));
  }
}

export const Route = createFileRoute("/overview")({
  component: OverviewPage,
});
