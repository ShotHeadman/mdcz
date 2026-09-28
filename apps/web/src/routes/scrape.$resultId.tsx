import { toErrorMessage } from "@mdcz/shared/error";
import { DetailPanelAdapter } from "@mdcz/views/adapters";
import { toDetailViewItemFromScrapeResultDto } from "@mdcz/views/detail";
import { useT } from "@mdcz/views/i18n";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { createWebDetailPort } from "../adapters/ports";
import { api } from "../client";
import { queryKeys } from "../lib/queryKeys";
import { ErrorBanner } from "../routeCommon";

export function ScrapeResultPage() {
  const t = useT();
  const { resultId } = Route.useParams();
  const detailPort = useMemo(() => createWebDetailPort(), []);
  const detailQ = useQuery({
    queryFn: () => api.scrape.result({ id: resultId }),
    queryKey: queryKeys.scrape.result(resultId),
    retry: false,
  });
  const detailItem = detailQ.data?.result ? toDetailViewItemFromScrapeResultDto(detailQ.data.result) : null;

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas text-foreground">
      {detailQ.error ? <ErrorBanner>{toErrorMessage(detailQ.error)}</ErrorBanner> : null}
      <DetailPanelAdapter
        port={detailPort}
        item={detailItem}
        emptyMessage={detailQ.isLoading ? t.common.loading : t.web.scrapeResultNotFound}
      />
    </main>
  );
}

export const Route = createFileRoute("/scrape/$resultId")({
  component: ScrapeResultPage,
});
