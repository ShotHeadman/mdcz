import { DetailPanelAdapter } from "@mdcz/shared/adapters";
import { scrapeResultDtoToDetailScrapeResult } from "@mdcz/shared/dtoAdapters";
import { toErrorMessage } from "@mdcz/shared/error";
import { toDetailViewItemFromScrapeResult } from "@mdcz/views/detail";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { createWebDetailPort } from "../adapters/ports";
import { api } from "../client";
import { ErrorBanner } from "../routeCommon";

export function ScrapeResultPage() {
  const { resultId } = Route.useParams();
  const detailPort = useMemo(() => createWebDetailPort(), []);
  const detailQ = useQuery({
    queryFn: () => api.scrape.result({ id: resultId }),
    queryKey: ["scrape", "result", resultId],
    retry: false,
  });
  const detailItem = detailQ.data?.result
    ? toDetailViewItemFromScrapeResult(scrapeResultDtoToDetailScrapeResult(detailQ.data.result))
    : null;

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas text-foreground">
      {detailQ.error ? <ErrorBanner>{toErrorMessage(detailQ.error)}</ErrorBanner> : null}
      <DetailPanelAdapter
        port={detailPort}
        item={detailItem}
        emptyMessage={detailQ.isLoading ? "加载中..." : "未找到刮削结果"}
        renderSceneImages={({ images, label }) => (
          <div className="space-y-3">
            {label ? (
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground/80">{label}</div>
            ) : null}
            <div className="flex gap-3 overflow-x-auto pb-1">
              {images.map((src) => (
                <img key={src} src={src} alt="剧照" className="h-28 w-auto rounded-quiet-sm object-cover" />
              ))}
            </div>
          </div>
        )}
      />
    </main>
  );
}

export const Route = createFileRoute("/scrape/$resultId")({
  component: ScrapeResultPage,
});
