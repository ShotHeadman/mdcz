import { type CrawlerDataDto, type ScrapeFileRefDto, type ScrapeResultDto, Website } from "@mdcz/shared";
import { NfoEditorView, WorkbenchView } from "@mdcz/views";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { api, subscribeTaskUpdates } from "../client";
import { AppLink, formatDate, scanStatusLabels, taskKindLabels } from "./Common";

const emptyCrawlerData = (relativePath = ""): CrawlerDataDto => ({
  title:
    relativePath
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/u, "") ?? "",
  title_zh: "",
  number: "",
  actors: [],
  genres: [],
  scene_images: [],
  website: Website.JAVDB,
});

function EditMetadataPanel({ result }: { result: ScrapeResultDto }) {
  const queryClient = useQueryClient();
  const [data, setData] = useState<CrawlerDataDto>(result.crawlerData ?? emptyCrawlerData(result.relativePath));
  const nfoQ = useQuery({
    enabled: Boolean(result.nfoRelativePath),
    queryFn: () =>
      api.scrape.nfoRead({
        rootId: result.rootId,
        relativePath: result.nfoRelativePath ?? `${result.relativePath}.nfo`,
      }),
    queryKey: ["nfo", result.rootId, result.nfoRelativePath],
  });
  const writeNfoM = useMutation({
    mutationFn: () =>
      api.scrape.nfoWrite({
        rootId: result.rootId,
        relativePath: result.nfoRelativePath ?? `${result.relativePath}.nfo`,
        data,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["scrapeResults"] });
      await queryClient.invalidateQueries({ queryKey: ["nfo", result.rootId, result.nfoRelativePath] });
    },
  });

  useEffect(() => {
    setData(result.crawlerData ?? nfoQ.data?.data ?? emptyCrawlerData(result.relativePath));
  }, [nfoQ.data?.data, result]);

  return (
    <NfoEditorView
      data={data}
      errorMessage={writeNfoM.error?.message}
      nfoRelativePath={result.nfoRelativePath}
      onArrayFieldChange={(field, value) => setData((current) => ({ ...current, [field]: value }))}
      onFieldChange={(field, value) => setData((current) => ({ ...current, [field]: value }))}
      onSave={() => void writeNfoM.mutate()}
      saveDisabled={!result.nfoRelativePath || writeNfoM.isPending}
    />
  );
}

export function WorkbenchPage() {
  const queryClient = useQueryClient();
  const [selectedRootId, setSelectedRootId] = useState("");
  const [selectedRefs, setSelectedRefs] = useState<ScrapeFileRefDto[]>([]);
  const [manualUrl, setManualUrl] = useState("");
  const [activeResultId, setActiveResultId] = useState<string | null>(null);

  const rootsQ = useQuery({ queryFn: () => api.mediaRoots.list(), queryKey: ["mediaRoots"], retry: false });
  const tasksQ = useQuery({ queryFn: () => api.tasks.list(), queryKey: ["tasks"], retry: false });
  const browserQ = useQuery({
    enabled: Boolean(selectedRootId),
    queryFn: () => api.browser.list({ rootId: selectedRootId, relativePath: "" }),
    queryKey: ["browser", selectedRootId],
    retry: false,
  });
  const scrapeResultsQ = useQuery({
    queryFn: () => api.scrape.listResults(),
    queryKey: ["scrapeResults"],
    retry: false,
  });

  const startScrapeM = useMutation({
    mutationFn: () =>
      api.scrape.start({ refs: selectedRefs, manualUrl: manualUrl.trim() || undefined, uncensoredConfirmed: true }),
    onSuccess: async () => {
      setSelectedRefs([]);
      setManualUrl("");
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["scrapeResults"] });
    },
  });
  const retryM = useMutation({ mutationFn: (taskId: string) => api.tasks.retry({ taskId }) });
  const taskControlM = useMutation({
    mutationFn: ({ action, taskId }: { action: "pause" | "resume" | "stop"; taskId: string }) =>
      api.scrape[action]({ taskId }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const deleteFileM = useMutation({
    mutationFn: (result: ScrapeResultDto) =>
      api.scrape.deleteFile({ rootId: result.rootId, relativePath: result.relativePath }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["scrapeResults"] });
      await queryClient.invalidateQueries({ queryKey: ["browser", selectedRootId] });
    },
  });

  const enabledRoots = useMemo(() => rootsQ.data?.roots.filter((root) => root.enabled) ?? [], [rootsQ.data?.roots]);
  const scrapeTasks = tasksQ.data?.tasks.filter((task) => task.kind === "scrape") ?? [];
  const activeResult = scrapeResultsQ.data?.results.find((result) => result.id === activeResultId) ?? null;

  const toggleRef = (ref: ScrapeFileRefDto) => {
    const key = `${ref.rootId}:${ref.relativePath}`;
    setSelectedRefs((current) =>
      current.some((item) => `${item.rootId}:${item.relativePath}` === key)
        ? current.filter((item) => `${item.rootId}:${item.relativePath}` !== key)
        : [...current, ref],
    );
  };

  const controlTask = async (action: "pause" | "resume" | "stop" | "retry", taskId: string) => {
    if (action === "retry") {
      await retryM.mutateAsync(taskId);
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      return;
    }
    taskControlM.mutate({ action, taskId });
  };

  useEffect(
    () =>
      subscribeTaskUpdates(() => {
        void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        void queryClient.invalidateQueries({ queryKey: ["scrapeResults"] });
      }),
    [queryClient],
  );

  useEffect(() => {
    if (!selectedRootId && enabledRoots[0]) {
      setSelectedRootId(enabledRoots[0].id);
    }
  }, [enabledRoots, selectedRootId]);

  return (
    <WorkbenchView
      activeEditor={activeResult ? <EditMetadataPanel result={activeResult} /> : undefined}
      browserEntries={browserQ.data?.entries ?? []}
      browserLink={<WorkbenchLink to="/browser">浏览</WorkbenchLink>}
      enabledRoots={enabledRoots}
      errorMessage={startScrapeM.error?.message}
      isStarting={startScrapeM.isPending}
      labels={{ formatDate, scanStatus: scanStatusLabels, taskKind: taskKindLabels }}
      manualUrl={manualUrl}
      mediaRootsLink={<WorkbenchLink to="/media-roots">媒体目录</WorkbenchLink>}
      onDeleteResult={(result) => void deleteFileM.mutate(result)}
      onManualUrlChange={setManualUrl}
      onRefreshTasks={() => void tasksQ.refetch()}
      onResultSelect={setActiveResultId}
      onRootChange={setSelectedRootId}
      onScanRoot={(rootId) => {
        void api.scans.start({ rootId }).then(() => queryClient.invalidateQueries({ queryKey: ["tasks"] }));
      }}
      onStartScrape={() => void startScrapeM.mutate()}
      onTaskControl={(action, taskId) => void controlTask(action, taskId)}
      onToggleRef={toggleRef}
      renderBrowserDirectoryLink={(result) => (
        <WorkbenchLink
          search={{ rootId: result.rootId, path: result.relativePath.split("/").slice(0, -1).join("/") }}
          to="/browser"
        >
          打开目录
        </WorkbenchLink>
      )}
      renderTaskLink={(task) => (
        <AppLink
          className="mt-3 inline-flex text-sm font-medium text-foreground underline-offset-4 hover:underline"
          to={`/tasks/${task.id}`}
        >
          查看任务详情
        </AppLink>
      )}
      results={scrapeResultsQ.data?.results ?? []}
      selectedRefs={selectedRefs}
      selectedRootId={selectedRootId}
      tasks={scrapeTasks}
    />
  );
}

function WorkbenchLink({
  children,
  search,
  to,
}: {
  children: ReactNode;
  search?: Record<string, string | undefined>;
  to: string;
}) {
  return (
    <AppLink
      className="self-center text-sm font-medium text-foreground underline-offset-4 hover:underline"
      search={search}
      to={to}
    >
      {children}
    </AppLink>
  );
}
