import { type CrawlerDataDto, Website } from "@mdcz/shared";
import { toErrorMessage } from "@mdcz/shared/error";
import { ScrapeResultDetailView } from "@mdcz/views/detail";
import { NfoEditorView } from "@mdcz/views/nfo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../client";
import { AppLink, ErrorBanner } from "./Common";

const emptyCrawlerData = (relativePath = ""): CrawlerDataDto => ({
  actors: [],
  genres: [],
  number: "",
  scene_images: [],
  title:
    relativePath
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/u, "") ?? "",
  title_zh: "",
  website: Website.JAVDB,
});

export function ScrapeResultPage() {
  const queryClient = useQueryClient();
  const resultId = decodeURIComponent(window.location.pathname.replace(/^\/scrape\//u, ""));
  const detailQ = useQuery({
    queryFn: () => api.scrape.result({ id: resultId }),
    queryKey: ["scrape", "result", resultId],
    retry: false,
  });
  const result = detailQ.data?.result ?? null;
  const [data, setData] = useState<CrawlerDataDto>(emptyCrawlerData());
  const writeNfoM = useMutation({
    mutationFn: () => {
      if (!result?.nfoRelativePath) {
        throw new Error("当前刮削结果没有 NFO 路径");
      }
      return api.scrape.nfoWrite({ rootId: result.rootId, relativePath: result.nfoRelativePath, data });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["scrape", "result", resultId] });
      await queryClient.invalidateQueries({ queryKey: ["scrapeResults"] });
    },
  });
  const deleteFileM = useMutation({
    mutationFn: () => {
      if (!result) {
        throw new Error("刮削结果尚未加载");
      }
      return api.scrape.deleteFile({ rootId: result.rootId, relativePath: result.relativePath });
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["scrape", "result", resultId] }),
  });

  useEffect(() => {
    if (result) {
      setData(result.crawlerData ?? emptyCrawlerData(result.relativePath));
    }
  }, [result]);

  return (
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto grid w-full max-w-[1180px] gap-7 px-6 py-8 lg:px-12 lg:py-12">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">刮削结果</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">Review 与 NFO</h1>
          </div>
          <AppLink className="text-sm font-medium text-foreground underline-offset-4 hover:underline" to="/workbench">
            返回工作台
          </AppLink>
        </header>
        {detailQ.error && <ErrorBanner>{toErrorMessage(detailQ.error)}</ErrorBanner>}
        {result && (
          <>
            <ScrapeResultDetailView
              browserLink={
                <AppLink
                  className="self-center text-sm font-medium text-foreground underline-offset-4 hover:underline"
                  search={{ rootId: result.rootId, path: result.relativePath.split("/").slice(0, -1).join("/") }}
                  to="/browser"
                >
                  打开目录
                </AppLink>
              }
              onDelete={() => void deleteFileM.mutate()}
              result={result}
            />
            <NfoEditorView
              data={data}
              errorMessage={writeNfoM.error ? toErrorMessage(writeNfoM.error) : null}
              nfoRelativePath={result.nfoRelativePath}
              onArrayFieldChange={(field, value) => setData((current) => ({ ...current, [field]: value }))}
              onFieldChange={(field, value) => setData((current) => ({ ...current, [field]: value }))}
              onSave={() => void writeNfoM.mutate()}
              saveDisabled={!result.nfoRelativePath || writeNfoM.isPending}
            />
          </>
        )}
      </div>
    </main>
  );
}
