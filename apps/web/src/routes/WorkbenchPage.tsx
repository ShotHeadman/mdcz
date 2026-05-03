import {
  type CrawlerDataDto,
  type ScanTaskDto,
  type ScrapeFileRefDto,
  type ScrapeResultDto,
  Website,
} from "@mdcz/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, FolderOpen, Pause, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, subscribeTaskUpdates } from "../client";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Textarea } from "../ui";
import { AppLink, formatDate, scanStatusLabels, taskKindLabels } from "./common";

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

const parseLines = (value: string): string[] =>
  value
    .split(/[\n,，]/u)
    .map((item) => item.trim())
    .filter(Boolean);

const EditMetadataPanel = ({ result }: { result: ScrapeResultDto }) => {
  const queryClient = useQueryClient();
  const [data, setData] = useState<CrawlerDataDto>(result.crawlerData ?? emptyCrawlerData(result.relativePath));
  const nfoQ = useQuery({
    queryKey: ["nfo", result.rootId, result.nfoRelativePath],
    queryFn: () =>
      api.scrape.nfoRead({
        rootId: result.rootId,
        relativePath: result.nfoRelativePath ?? `${result.relativePath}.nfo`,
      }),
    enabled: Boolean(result.nfoRelativePath),
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
    <Card>
      <CardHeader>
        <CardTitle>元数据与 NFO</CardTitle>
        <CardDescription>{result.nfoRelativePath ?? "刮削成功后生成 NFO 路径"}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <Field label="标题" value={data.title} onChange={(title) => setData((current) => ({ ...current, title }))} />
        <Field
          label="中文标题"
          value={data.title_zh ?? ""}
          onChange={(title_zh) => setData((current) => ({ ...current, title_zh }))}
        />
        <Field label="番号" value={data.number} onChange={(number) => setData((current) => ({ ...current, number }))} />
        <Field
          label="发行日期"
          value={data.release_date ?? ""}
          onChange={(release_date) => setData((current) => ({ ...current, release_date }))}
        />
        <Field
          label="制作商"
          value={data.studio ?? ""}
          onChange={(studio) => setData((current) => ({ ...current, studio }))}
        />
        <Field
          label="导演"
          value={data.director ?? ""}
          onChange={(director) => setData((current) => ({ ...current, director }))}
        />
        <div className="grid gap-2 lg:col-span-2">
          <Label>演员</Label>
          <Textarea
            value={data.actors.join("\n")}
            onChange={(event) => setData((current) => ({ ...current, actors: parseLines(event.target.value) }))}
          />
        </div>
        <div className="grid gap-2 lg:col-span-2">
          <Label>类型</Label>
          <Textarea
            value={data.genres.join("\n")}
            onChange={(event) => setData((current) => ({ ...current, genres: parseLines(event.target.value) }))}
          />
        </div>
        <div className="grid gap-2 lg:col-span-2">
          <Label>简介</Label>
          <Textarea
            value={data.plot ?? ""}
            onChange={(event) => setData((current) => ({ ...current, plot: event.target.value }))}
          />
        </div>
        <div className="flex flex-wrap gap-2 lg:col-span-2">
          <Button disabled={!result.nfoRelativePath || writeNfoM.isPending} onClick={() => void writeNfoM.mutate()}>
            <FileText className="h-4 w-4" />
            保存 NFO
          </Button>
          {writeNfoM.error && <p className="text-sm text-destructive">{writeNfoM.error.message}</p>}
        </div>
      </CardContent>
    </Card>
  );
};

const Field = ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => (
  <div className="grid gap-2">
    <Label>{label}</Label>
    <Input value={value} onChange={(event) => onChange(event.target.value)} />
  </div>
);

export const WorkbenchPage = () => {
  const queryClient = useQueryClient();
  const [selectedRootId, setSelectedRootId] = useState("");
  const [selectedRefs, setSelectedRefs] = useState<ScrapeFileRefDto[]>([]);
  const [manualUrl, setManualUrl] = useState("");
  const [activeResultId, setActiveResultId] = useState<string | null>(null);

  const rootsQ = useQuery({ queryKey: ["mediaRoots"], queryFn: () => api.mediaRoots.list(), retry: false });
  const tasksQ = useQuery({ queryKey: ["tasks"], queryFn: () => api.tasks.list(), retry: false });
  const browserQ = useQuery({
    queryKey: ["browser", selectedRootId],
    queryFn: () => api.browser.list({ rootId: selectedRootId, relativePath: "" }),
    enabled: Boolean(selectedRootId),
    retry: false,
  });
  const scrapeResultsQ = useQuery({
    queryKey: ["scrapeResults"],
    queryFn: () => api.scrape.listResults(),
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

  const enabledRoots = rootsQ.data?.roots.filter((root) => root.enabled) ?? [];
  const scrapeTasks = tasksQ.data?.tasks.filter((task) => task.kind === "scrape") ?? [];
  const activeResult = scrapeResultsQ.data?.results.find((result) => result.id === activeResultId) ?? null;
  const selectedKeySet = useMemo(
    () => new Set(selectedRefs.map((ref) => `${ref.rootId}:${ref.relativePath}`)),
    [selectedRefs],
  );

  const toggleRef = (ref: ScrapeFileRefDto) => {
    const key = `${ref.rootId}:${ref.relativePath}`;
    setSelectedRefs((current) =>
      current.some((item) => `${item.rootId}:${item.relativePath}` === key)
        ? current.filter((item) => `${item.rootId}:${item.relativePath}` !== key)
        : [...current, ref],
    );
  };

  const retryTask = async (taskId: string) => {
    await retryM.mutateAsync(taskId);
    await queryClient.invalidateQueries({ queryKey: ["tasks"] });
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
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto grid w-full max-w-[1600px] gap-7 px-6 py-8 lg:px-12 lg:py-12">
        <header className="max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">工作台</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            从挂载媒体目录选择文件，启动 WebUI 刮削任务， review 元数据并编辑 NFO。
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>扫描媒体目录</CardTitle>
            <CardDescription>选择一个已启用媒体目录开始扫描，扫描结果会成为媒体库与刮削候选。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <AppLink
                className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                to="/media-roots"
              >
                媒体目录
              </AppLink>
              <AppLink className="text-sm font-medium text-foreground underline-offset-4 hover:underline" to="/browser">
                浏览
              </AppLink>
              <AppLink className="text-sm font-medium text-foreground underline-offset-4 hover:underline" to="/library">
                媒体库
              </AppLink>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {enabledRoots.map((root) => (
                <Button
                  key={root.id}
                  variant="secondary"
                  onClick={() => {
                    void api.scans
                      .start({ rootId: root.id })
                      .then(() => queryClient.invalidateQueries({ queryKey: ["tasks"] }));
                  }}
                >
                  <FolderOpen className="h-4 w-4" />
                  {root.displayName}
                </Button>
              ))}
              <Button variant="secondary" onClick={() => void tasksQ.refetch()}>
                刷新
              </Button>
            </div>
            {enabledRoots.length === 0 && (
              <p className="text-sm text-muted-foreground">没有已启用的媒体目录。先到媒体目录页面添加挂载路径。</p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-7 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <Card>
            <CardHeader>
              <CardTitle>选择刮削文件</CardTitle>
              <CardDescription>文件引用只保存 rootId + 相对路径，不暴露宿主绝对路径。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>扫描目录</Label>
                <select
                  className="h-10 rounded-quiet border border-border bg-surface-panel px-3 text-sm"
                  value={selectedRootId}
                  onChange={(event) => setSelectedRootId(event.target.value)}
                >
                  {enabledRoots.map((root) => (
                    <option key={root.id} value={root.id}>
                      {root.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid max-h-[360px] gap-2 overflow-y-auto pr-1">
                {browserQ.data?.entries
                  .filter((entry) => entry.type === "file")
                  .map((entry) => {
                    const ref = { rootId: selectedRootId, relativePath: entry.relativePath };
                    const selected = selectedKeySet.has(`${ref.rootId}:${ref.relativePath}`);
                    return (
                      <button
                        key={entry.relativePath}
                        className={`rounded-quiet border px-3 py-2 text-left text-sm transition-colors ${
                          selected
                            ? "border-primary/50 bg-primary/10"
                            : "border-border/60 bg-surface-low hover:bg-surface-panel"
                        }`}
                        onClick={() => toggleRef(ref)}
                        type="button"
                      >
                        <span className="block truncate font-medium text-foreground">{entry.name}</span>
                        <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                          {entry.relativePath}
                        </span>
                      </button>
                    );
                  })}
              </div>
              <div className="grid gap-2">
                <Label>手动 URL 重刮削</Label>
                <Input
                  value={manualUrl}
                  onChange={(event) => setManualUrl(event.target.value)}
                  placeholder="可选：粘贴站点详情页 URL"
                />
              </div>
              <Button
                disabled={selectedRefs.length === 0 || startScrapeM.isPending}
                onClick={() => void startScrapeM.mutate()}
              >
                <Play className="h-4 w-4" />
                启动刮削（{selectedRefs.length}）
              </Button>
              {startScrapeM.error && <p className="text-sm text-destructive">{startScrapeM.error.message}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>刮削任务</CardTitle>
              <CardDescription>支持暂停、恢复、停止、失败重试与任务详情查看。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {scrapeTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onPause={() => void taskControlM.mutate({ action: "pause", taskId: task.id })}
                  onResume={() => void taskControlM.mutate({ action: "resume", taskId: task.id })}
                  onRetry={() => void retryTask(task.id)}
                  onStop={() => void taskControlM.mutate({ action: "stop", taskId: task.id })}
                />
              ))}
              {scrapeTasks.length === 0 && <p className="text-sm text-muted-foreground">暂无刮削任务。</p>}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>刮削结果</CardTitle>
            <CardDescription>选择结果查看桌面一致字段，并可保存 NFO 或删除源文件。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {scrapeResultsQ.data?.results.map((result) => (
              <div
                key={result.id}
                className="grid gap-3 rounded-quiet border border-border/60 bg-surface-low p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{result.crawlerData?.title ?? result.fileName}</p>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {result.rootDisplayName} / {result.relativePath}
                  </p>
                  {result.error && <p className="mt-1 text-xs text-destructive">{result.error}</p>}
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Button variant="secondary" onClick={() => setActiveResultId(result.id)}>
                    Review
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!result.nfoRelativePath}
                    onClick={() => setActiveResultId(result.id)}
                  >
                    <FileText className="h-4 w-4" />
                    NFO
                  </Button>
                  <AppLink
                    className="self-center text-sm font-medium text-foreground underline-offset-4 hover:underline"
                    to="/browser"
                    search={{ rootId: result.rootId, path: result.relativePath.split("/").slice(0, -1).join("/") }}
                  >
                    打开目录
                  </AppLink>
                  <Button variant="secondary" onClick={() => void deleteFileM.mutate(result)}>
                    <Trash2 className="h-4 w-4" />
                    删除文件
                  </Button>
                </div>
              </div>
            ))}
            {scrapeResultsQ.data?.results.length === 0 && (
              <p className="text-sm text-muted-foreground">暂无刮削结果。</p>
            )}
          </CardContent>
        </Card>

        {activeResult && <EditMetadataPanel result={activeResult} />}
      </div>
    </main>
  );
};

const TaskCard = ({
  task,
  onPause,
  onResume,
  onRetry,
  onStop,
}: {
  task: ScanTaskDto;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onStop: () => void;
}) => (
  <div className="rounded-quiet border border-border/60 bg-surface-low p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="font-medium text-foreground">{`${taskKindLabels[task.kind]} · ${task.rootDisplayName} · ${scanStatusLabels[task.status]}`}</p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{task.id}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={task.status !== "running"} variant="secondary" onClick={onPause}>
          <Pause className="h-4 w-4" />
          暂停
        </Button>
        <Button disabled={task.status !== "paused"} variant="secondary" onClick={onResume}>
          <Play className="h-4 w-4" />
          恢复
        </Button>
        <Button
          disabled={task.status !== "running" && task.status !== "queued" && task.status !== "paused"}
          variant="secondary"
          onClick={onStop}
        >
          <Square className="h-4 w-4" />
          停止
        </Button>
        <Button disabled={task.status === "queued" || task.status === "running"} variant="secondary" onClick={onRetry}>
          <RotateCcw className="h-4 w-4" />
          重试
        </Button>
      </div>
    </div>
    <p className="mt-3 text-sm text-muted-foreground">{task.error ?? `${task.videoCount} 个文件`}</p>
    <p className="mt-2 font-mono text-xs text-muted-foreground">
      创建 {formatDate(task.createdAt)} · 更新 {formatDate(task.updatedAt)}
    </p>
    <AppLink
      className="mt-3 inline-flex text-sm font-medium text-foreground underline-offset-4 hover:underline"
      to={`/tasks/${task.id}`}
    >
      查看任务详情
    </AppLink>
  </div>
);
