import { toErrorMessage } from "@mdcz/shared/error";
import { OverviewHeroStartCard, OverviewMaintenanceCard, RecentAcquisitionsGrid } from "@mdcz/views/overview";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "../client";
import { AppLink, ErrorBanner } from "../routeCommon";
import { buildHref } from "../routeHelpers";

export function OverviewPage() {
  const setupQ = useQuery({ queryKey: ["setup"], queryFn: () => api.setup.status(), retry: false });
  const overviewQ = useQuery({
    queryKey: ["overview", "summary"],
    queryFn: () => api.overview.summary(),
    retry: false,
  });
  const output = overviewQ.data?.output;
  const recent = overviewQ.data?.recentAcquisitions ?? [];
  const configured = Boolean(setupQ.data?.configured);

  return (
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto grid w-full max-w-[1600px] grid-cols-12 gap-8 px-6 py-8 lg:px-12 lg:py-12">
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
          <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-bold tracking-tight">最近入库</h2>
            <AppLink className="text-sm font-medium text-foreground underline-offset-4 hover:underline" to="/library">
              打开媒体库
            </AppLink>
          </div>
          <RecentAcquisitionsGrid
            isError={overviewQ.isError}
            isLoading={overviewQ.isLoading}
            items={recent}
            onRetry={() => {
              void overviewQ.refetch();
            }}
          />
        </section>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/overview")({
  component: OverviewPage,
});
