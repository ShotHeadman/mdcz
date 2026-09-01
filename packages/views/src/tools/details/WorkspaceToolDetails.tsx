import { toErrorMessage } from "@mdcz/shared/error";
import type { BatchTranslateApplyResultItem, BatchTranslateScanItem } from "@mdcz/shared/ipcTypes";
import { Badge, Button, Checkbox, cn, Input, Label, Progress } from "@mdcz/ui";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  FolderOpen,
  Languages,
  Layers,
  Loader2,
  Pause,
  Play,
  Search,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const TOOL_ICON_BUTTON_CLASS =
  "h-11 w-11 shrink-0 rounded-quiet-sm bg-surface-low text-foreground hover:bg-surface-raised/75 transition-colors";
const TOOL_INPUT_CLASS =
  "h-11 rounded-quiet-sm border-none bg-surface-low/90 px-4 shadow-none focus-visible:ring-2 focus-visible:ring-ring/30 transition-shadow";
const TOOL_NOTE_CLASS = "text-xs leading-6 text-muted-foreground";
const TOOL_PRIMARY_BUTTON_CLASS =
  "h-11 rounded-quiet-capsule bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors inline-flex items-center justify-center gap-2";
const TOOL_SECONDARY_BUTTON_CLASS =
  "h-11 rounded-quiet-capsule bg-surface-low px-5 text-sm font-semibold text-foreground hover:bg-surface-raised/75 transition-colors inline-flex items-center justify-center gap-2";
const TOOL_SUBSECTION_CLASS = "space-y-4 rounded-quiet-lg bg-surface-low/90 p-4 md:p-5";
const TOOL_TABLE_SHELL_CLASS =
  "overflow-hidden rounded-quiet-lg bg-surface-floating/96 border border-black/5 dark:border-white/5";

const DEFAULT_BATCH_TRANSLATE_SIZE = 20;
const MIN_BATCH_TRANSLATE_SIZE = 1;
const MAX_BATCH_TRANSLATE_SIZE = 20;
const STORAGE_KEY_BATCH_TRANSLATE_DIR = "mdcz:tool:batch-translate-dir";

const readStoredBatchTranslateDirectory = (): string => {
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(STORAGE_KEY_BATCH_TRANSLATE_DIR) ?? "";
  } catch {
    return "";
  }
};

const persistBatchTranslateDirectory = (directory: string): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_BATCH_TRANSLATE_DIR, directory);
  } catch {
    // Directory persistence is optional and must not block the tool.
  }
};

const BATCH_SIZE_PRESETS = [
  { label: "1 条 (逐项)", value: 1 },
  { label: "5 条", value: 5 },
  { label: "10 条", value: 10 },
  { label: "20 条 (合并)", value: 20 },
];

type BatchTranslateItemApplyStatus = "idle" | "processing" | "success" | "partial" | "failed";

type BatchNfoTranslatorApplySummary = {
  successCount: number;
  partialCount: number;
  failedCount: number;
  totalCount: number;
};

const normalizeBatchTranslateSize = (value: unknown): number => {
  if (typeof value === "string" && value.trim() === "") return DEFAULT_BATCH_TRANSLATE_SIZE;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_BATCH_TRANSLATE_SIZE;
  return Math.min(MAX_BATCH_TRANSLATE_SIZE, Math.max(MIN_BATCH_TRANSLATE_SIZE, Math.trunc(parsed)));
};

const toBatchTranslateItemApplyStatus = (result: BatchTranslateApplyResultItem): BatchTranslateItemApplyStatus => {
  if (result.success) return "success";
  if (result.translatedFields.length > 0) return "partial";
  return "failed";
};

const buildBatchTranslateApplyStatusLabel = (status: BatchTranslateItemApplyStatus): string => {
  switch (status) {
    case "processing":
      return "翻译中";
    case "success":
      return "成功";
    case "partial":
      return "部分成功";
    case "failed":
      return "失败";
    default:
      return "待处理";
  }
};

const buildFailedBatchTranslateResult = (
  item: BatchTranslateScanItem,
  error: string,
): BatchTranslateApplyResultItem => ({
  directory: item.directory,
  error,
  filePath: item.filePath,
  nfoPath: item.nfoPath,
  number: item.number,
  success: false,
  translatedFields: [],
});

export interface SingleFilePathScraperDetailProps {
  pending?: boolean;
  onBrowseFile?: () => Promise<string | null | undefined>;
  onRun: (path: string) => void | Promise<void>;
}

export function SingleFilePathScraperDetail({
  pending = false,
  onBrowseFile,
  onRun,
}: SingleFilePathScraperDetailProps) {
  const [filePath, setFilePath] = useState("");

  const browseFile = async () => {
    const selected = await onBrowseFile?.();
    if (selected) setFilePath(selected);
  };

  return (
    <div className="space-y-6">
      <div className={TOOL_SUBSECTION_CLASS}>
        <Label
          htmlFor="filePath"
          className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
        >
          文件路径
        </Label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            id="filePath"
            value={filePath}
            onChange={(event) => setFilePath(event.target.value)}
            placeholder="/path/to/video.mp4"
            className={cn(TOOL_INPUT_CLASS, "flex-1")}
          />
          {onBrowseFile ? (
            <Button type="button" variant="secondary" onClick={browseFile} className={TOOL_ICON_BUTTON_CLASS}>
              <FolderOpen className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        <p className={TOOL_NOTE_CLASS}>适合针对单个失败样本重试，任务启动后会自动跳转到日志页面。</p>
      </div>

      <Button
        onClick={() => void onRun(filePath)}
        disabled={pending}
        className={cn(TOOL_PRIMARY_BUTTON_CLASS, "w-full sm:w-auto")}
      >
        {pending ? "正在刮削..." : "开始单文件刮削"}
      </Button>
    </div>
  );
}

export interface BatchNfoTranslatorWorkspaceDetailProps {
  items: BatchTranslateScanItem[];
  scanning?: boolean;
  onApply: (items: BatchTranslateScanItem[], batchSize: number) => Promise<BatchTranslateApplyResultItem[]>;
  onApplyComplete?: (summary: BatchNfoTranslatorApplySummary) => void;
  onBrowseDirectory?: () => Promise<string | null | undefined>;
  onScan: (directory: string) => void | Promise<void>;
}

const getBatchTranslateStatusBadgeClass = (status: BatchTranslateItemApplyStatus): string => {
  switch (status) {
    case "processing":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
    case "success":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    case "partial":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
    case "failed":
      return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
    default:
      return "bg-surface-raised text-muted-foreground border-transparent";
  }
};

export function BatchNfoTranslatorWorkspaceDetail({
  items,
  scanning = false,
  onApply,
  onApplyComplete,
  onBrowseDirectory,
  onScan,
}: BatchNfoTranslatorWorkspaceDetailProps) {
  const [directory, setDirectory] = useState(readStoredBatchTranslateDirectory);
  const [batchSizeInput, setBatchSizeInput] = useState(String(DEFAULT_BATCH_TRANSLATE_SIZE));
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [applyProgress, setApplyProgress] = useState<{
    completed: number;
    total: number;
    currentLabel?: string;
  } | null>(null);
  const [results, setResults] = useState<BatchTranslateApplyResultItem[]>([]);
  const [itemStatusByPath, setItemStatusByPath] = useState<Record<string, BatchTranslateItemApplyStatus>>({});
  const previewRows = items.slice(0, 300);
  const resultByPath = useMemo(() => new Map(results.map((result) => [result.filePath, result])), [results]);
  const pendingFieldCount = useMemo(() => items.reduce((sum, item) => sum + item.pendingFields.length, 0), [items]);
  const selectedItems = useMemo(() => items.filter((item) => selectedPaths.has(item.filePath)), [items, selectedPaths]);
  const allSelected = items.length > 0 && selectedPaths.size === items.length;
  const someSelected = selectedPaths.size > 0 && selectedPaths.size < items.length;
  const normalizedBatchSize = normalizeBatchTranslateSize(batchSizeInput);
  const applyProgressPercent = applyProgress
    ? Math.round((applyProgress.completed / Math.max(applyProgress.total, 1)) * 100)
    : 0;
  const resultSummary = useMemo(() => {
    let successCount = 0;
    let partialCount = 0;
    let failedCount = 0;

    for (const result of results) {
      const status = toBatchTranslateItemApplyStatus(result);
      if (status === "success") successCount += 1;
      else if (status === "partial") partialCount += 1;
      else failedCount += 1;
    }

    return { successCount, partialCount, failedCount };
  }, [results]);

  const setApplyPaused = (nextPaused: boolean) => {
    pausedRef.current = nextPaused;
    setPaused(nextPaused);
  };

  const waitWhileApplyPaused = async () => {
    while (pausedRef.current) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 150));
    }
  };

  useEffect(() => {
    setSelectedPaths(new Set(items.map((item) => item.filePath)));
    setResults([]);
    setItemStatusByPath({});
    setApplyProgress(null);
    pausedRef.current = false;
    setPaused(false);
  }, [items]);

  const toggleItem = (filePath: string) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedPaths(allSelected ? new Set() : new Set(items.map((item) => item.filePath)));
  };

  const handleScan = async () => {
    setResults([]);
    setItemStatusByPath({});
    setApplyProgress(null);
    setApplyPaused(false);
    persistBatchTranslateDirectory(directory);
    await onScan(directory);
  };

  const handleApply = async () => {
    if (selectedItems.length === 0 || applying) return;

    setApplying(true);
    setApplyPaused(false);
    setResults([]);
    setItemStatusByPath(Object.fromEntries(selectedItems.map((item) => [item.filePath, "idle"])));
    setApplyProgress({ completed: 0, total: selectedItems.length });

    const accumulatedResults: BatchTranslateApplyResultItem[] = [];
    let successCount = 0;
    let partialCount = 0;
    let failedCount = 0;

    for (let index = 0; index < selectedItems.length; index += normalizedBatchSize) {
      await waitWhileApplyPaused();
      const chunk = selectedItems.slice(index, index + normalizedBatchSize);
      const chunkLabel = chunk.length === 1 ? chunk[0]?.number : `${chunk[0]?.number ?? "..."} 等 ${chunk.length} 项`;
      setItemStatusByPath((current) => ({
        ...current,
        ...Object.fromEntries(chunk.map((item) => [item.filePath, "processing"])),
      }));
      setApplyProgress({
        completed: accumulatedResults.length,
        currentLabel: chunkLabel,
        total: selectedItems.length,
      });

      let chunkResults: BatchTranslateApplyResultItem[];
      try {
        chunkResults = await onApply(chunk, normalizedBatchSize);
      } catch (error) {
        chunkResults = chunk.map((item) => buildFailedBatchTranslateResult(item, toErrorMessage(error)));
      }

      const returnedResultByPath = new Map(chunkResults.map((result) => [result.filePath, result]));
      const resolvedChunkResults = chunk.map((item) => ({
        filePath: item.filePath,
        result: returnedResultByPath.get(item.filePath) ?? buildFailedBatchTranslateResult(item, "未返回翻译结果"),
      }));
      for (const { result } of resolvedChunkResults) {
        accumulatedResults.push(result);
        const status = toBatchTranslateItemApplyStatus(result);
        if (status === "success") successCount += 1;
        else if (status === "partial") partialCount += 1;
        else failedCount += 1;
      }

      setResults([...accumulatedResults]);
      setItemStatusByPath((current) => ({
        ...current,
        ...Object.fromEntries(
          resolvedChunkResults.map(({ filePath, result }) => [filePath, toBatchTranslateItemApplyStatus(result)]),
        ),
      }));
      setApplyProgress({
        completed: accumulatedResults.length,
        currentLabel: chunkLabel,
        total: selectedItems.length,
      });
    }

    setApplying(false);
    setApplyPaused(false);
    setApplyProgress(null);
    onApplyComplete?.({
      failedCount,
      partialCount,
      successCount,
      totalCount: selectedItems.length,
    });
  };

  const browseDirectory = async () => {
    const selected = await onBrowseDirectory?.();
    if (!selected) return;
    setDirectory(selected);
    persistBatchTranslateDirectory(selected);
  };

  return (
    <div className="space-y-6">
      <div className={TOOL_SUBSECTION_CLASS}>
        <Label
          htmlFor="batch-translate-dir"
          className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
        >
          目标目录
        </Label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            id="batch-translate-dir"
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
            onBlur={(event) => persistBatchTranslateDirectory(event.target.value)}
            placeholder="输入已刮削完成的媒体目录"
            className={cn(TOOL_INPUT_CLASS, "flex-1")}
          />
          {onBrowseDirectory ? (
            <Button
              type="button"
              variant="secondary"
              className={cn(TOOL_SECONDARY_BUTTON_CLASS, "sm:w-auto px-4")}
              onClick={browseDirectory}
            >
              <FolderOpen className="h-4 w-4" />
              <span>浏览目录</span>
            </Button>
          ) : null}
        </div>
      </div>

      <div className={TOOL_SUBSECTION_CLASS}>
        <div className="space-y-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <Label
              htmlFor="batch-translate-size"
              className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
            >
              每批翻译条数
            </Label>
            <span className="text-xs text-muted-foreground">
              合并多个条目统一请求大模型以提升效率。本地模型或网络不稳定建议 1~5 条/批。
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-quiet-capsule bg-surface-floating/80 p-1 border border-black/5 dark:border-white/5">
              <span className="px-2.5 text-xs font-medium text-muted-foreground">预设:</span>
              {BATCH_SIZE_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setBatchSizeInput(String(preset.value))}
                  className={cn(
                    "flex h-8 items-center px-3.5 rounded-quiet-capsule text-xs font-medium transition-all",
                    normalizedBatchSize === preset.value
                      ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                      : "text-muted-foreground hover:bg-surface-low hover:text-foreground",
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="hidden h-6 w-px bg-black/10 dark:bg-white/10 sm:block" />

            <div className="flex items-center gap-2">
              <Label htmlFor="batch-translate-size" className="shrink-0 text-xs font-medium text-muted-foreground">
                自定义:
              </Label>
              <div className="inline-flex h-10 items-center rounded-quiet-capsule bg-surface-low/90 px-4 border border-black/5 dark:border-white/5 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring/30 transition-all">
                <input
                  id="batch-translate-size"
                  type="number"
                  min={MIN_BATCH_TRANSLATE_SIZE}
                  max={MAX_BATCH_TRANSLATE_SIZE}
                  value={batchSizeInput}
                  onBlur={() => setBatchSizeInput(String(normalizedBatchSize))}
                  onChange={(event) => setBatchSizeInput(event.target.value)}
                  className="w-12 bg-transparent text-center font-mono text-sm font-semibold text-foreground focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="ml-2 flex h-4 shrink-0 select-none items-center border-l border-black/10 pl-2 text-xs font-medium text-muted-foreground leading-none dark:border-white/10">
                  条 / 批
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          variant="secondary"
          onClick={() => void handleScan()}
          disabled={scanning || applying}
          className={cn(TOOL_SECONDARY_BUTTON_CLASS, "flex-1")}
        >
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          <span>{scanning ? "正在扫描..." : "扫描待翻译条目"}</span>
        </Button>
        <Button
          onClick={() => void handleApply()}
          disabled={applying || scanning || selectedItems.length === 0}
          className={cn(TOOL_PRIMARY_BUTTON_CLASS, "flex-1")}
        >
          {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          <span>
            {applying
              ? applyProgress
                ? `翻译中 (${applyProgress.completed}/${applyProgress.total})`
                : "正在翻译..."
              : selectedItems.length === items.length
                ? "开始批量翻译"
                : `翻译选中项 (${selectedItems.length})`}
          </span>
        </Button>
        {applying ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setApplyPaused(!paused)}
            className={cn(TOOL_SECONDARY_BUTTON_CLASS, "sm:w-32")}
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            <span>{paused ? "继续" : "暂停"}</span>
          </Button>
        ) : null}
      </div>

      {applying && applyProgress ? (
        <div className={TOOL_SUBSECTION_CLASS}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
              {paused ? "暂停中" : "正在翻译"} {applyProgress.currentLabel ?? "..."} ({applyProgress.completed}/
              {applyProgress.total})
            </span>
            <span className="font-mono">{applyProgressPercent}%</span>
          </div>
          <Progress value={applyProgressPercent} className="h-2 bg-surface-floating" />
        </div>
      ) : null}

      <div className="flex w-full flex-wrap gap-3 md:flex-nowrap">
        <div className="flex-1 min-w-[120px] rounded-quiet-lg bg-surface-low/90 p-3.5 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-[11px] font-semibold uppercase tracking-wider">待处理条目</span>
            <FileText className="h-3.5 w-3.5" />
          </div>
          <div className="text-lg font-bold font-mono">{items.length}</div>
        </div>
        <div className="flex-1 min-w-[120px] rounded-quiet-lg bg-surface-low/90 p-3.5 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-[11px] font-semibold uppercase tracking-wider">已选中</span>
            <Layers className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="text-lg font-bold font-mono text-primary">{selectedItems.length}</div>
        </div>
        <div className="flex-1 min-w-[120px] rounded-quiet-lg bg-surface-low/90 p-3.5 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-[11px] font-semibold uppercase tracking-wider">待处理字段</span>
            <Languages className="h-3.5 w-3.5" />
          </div>
          <div className="text-lg font-bold font-mono">{pendingFieldCount}</div>
        </div>
        {results.length > 0 ? (
          <>
            <div className="flex-1 min-w-[120px] rounded-quiet-lg bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20 p-3.5 space-y-1">
              <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
                <span className="text-[11px] font-semibold uppercase tracking-wider">成功</span>
                <CheckCircle2 className="h-3.5 w-3.5" />
              </div>
              <div className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                {resultSummary.successCount}
              </div>
            </div>
            <div className="flex-1 min-w-[120px] rounded-quiet-lg bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 p-3.5 space-y-1">
              <div className="flex items-center justify-between text-amber-600 dark:text-amber-400">
                <span className="text-[11px] font-semibold uppercase tracking-wider">部分成功</span>
                <AlertCircle className="h-3.5 w-3.5" />
              </div>
              <div className="text-lg font-bold font-mono text-amber-600 dark:text-amber-400">
                {resultSummary.partialCount}
              </div>
            </div>
            <div className="flex-1 min-w-[120px] rounded-quiet-lg bg-red-500/5 dark:bg-red-500/10 border border-red-500/20 p-3.5 space-y-1">
              <div className="flex items-center justify-between text-red-600 dark:text-red-400">
                <span className="text-[11px] font-semibold uppercase tracking-wider">失败</span>
                <XCircle className="h-3.5 w-3.5" />
              </div>
              <div className="text-lg font-bold font-mono text-red-600 dark:text-red-400">
                {resultSummary.failedCount}
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className={TOOL_TABLE_SHELL_CLASS}>
        <div className="max-h-[440px] overflow-y-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-surface-low/95 backdrop-blur-sm z-10 shadow-sm">
              <tr className="text-muted-foreground border-b border-black/5 dark:border-white/5">
                <th className="w-12 px-4 py-3 text-left">
                  <Checkbox
                    checked={someSelected ? "indeterminate" : allSelected}
                    disabled={items.length === 0 || scanning || applying}
                    onCheckedChange={toggleAll}
                  />
                </th>
                <th className="w-28 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">番号</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">标题</th>
                <th className="w-40 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">待处理字段</th>
                <th className="w-28 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">状态</th>
                <th className="w-72 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">NFO 路径</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/5">
              {previewRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Search className="h-8 w-8 opacity-40" />
                      <p className="text-sm font-medium">暂无待翻译条目</p>
                      <p className="text-xs text-muted-foreground">
                        输入媒体目录后点击“扫描待翻译条目”开始寻找 NFO 文件
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                previewRows.map((item) => {
                  const status = itemStatusByPath[item.filePath] ?? "idle";
                  const result = resultByPath.get(item.filePath);
                  const displayFields = result ? result.translatedFields : item.pendingFields;
                  const displayPath = result?.savedNfoPath || item.nfoPath;

                  return (
                    <tr key={item.filePath} className="transition-colors hover:bg-surface-low/45">
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={selectedPaths.has(item.filePath)}
                          disabled={applying || scanning}
                          onCheckedChange={() => toggleItem(item.filePath)}
                        />
                      </td>
                      <td className="px-4 py-3 font-mono font-medium">{item.number}</td>
                      <td className="px-4 py-3 font-medium text-foreground">{item.title}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {displayFields.length === 0 ? (
                            <span className="text-muted-foreground">-</span>
                          ) : (
                            displayFields.map((field) => (
                              <Badge
                                key={`${item.filePath}-${field}`}
                                variant="outline"
                                className="rounded-quiet-capsule px-2 py-0.5 text-[11px] bg-surface-low border-black/10 dark:border-white/10"
                              >
                                {field === "title" ? "标题" : "简介"}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-quiet-capsule px-2.5 py-0.5 text-[11px] font-medium border",
                              getBatchTranslateStatusBadgeClass(status),
                            )}
                          >
                            {buildBatchTranslateApplyStatusLabel(status)}
                          </Badge>
                          {result?.error ? (
                            <div className="text-[11px] font-medium text-destructive leading-tight max-w-xs break-words">
                              {result.error}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="break-all px-4 py-3 font-mono text-[11px] text-muted-foreground">{displayPath}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
