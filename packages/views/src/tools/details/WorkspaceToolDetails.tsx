import { toErrorMessage } from "@mdcz/shared/error";
import type { BatchTranslateApplyResultItem, BatchTranslateScanItem } from "@mdcz/shared/ipcTypes";
import type { MediaRootDto } from "@mdcz/shared/serverDtos";
import {
  Badge,
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Progress,
} from "@mdcz/ui";
import { FolderOpen, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const TOOL_ICON_BUTTON_CLASS =
  "h-11 w-11 shrink-0 rounded-quiet-sm bg-surface-low text-foreground hover:bg-surface-raised/75";
const TOOL_INPUT_CLASS =
  "h-11 rounded-quiet-sm border-none bg-surface-low/90 px-4 shadow-none focus-visible:ring-2 focus-visible:ring-ring/30";
const TOOL_NOTE_CLASS = "text-xs leading-6 text-muted-foreground";
const TOOL_PRIMARY_BUTTON_CLASS =
  "h-11 rounded-quiet-capsule bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90";
const TOOL_SECONDARY_BUTTON_CLASS =
  "h-11 rounded-quiet-capsule bg-surface-low px-5 text-sm font-semibold text-foreground hover:bg-surface-raised/75";
const TOOL_SUBSECTION_CLASS = "space-y-4 rounded-quiet-lg bg-surface-low/90 p-4 md:p-5";
const TOOL_TABLE_SHELL_CLASS = "overflow-hidden rounded-quiet-lg bg-surface-floating/96";

const DEFAULT_BATCH_TRANSLATE_SIZE = 20;
const MIN_BATCH_TRANSLATE_SIZE = 1;
const MAX_BATCH_TRANSLATE_SIZE = 20;

type BatchTranslateItemApplyStatus = "idle" | "processing" | "success" | "partial" | "failed";

type BatchNfoTranslatorApplySummary = {
  successCount: number;
  partialCount: number;
  failedCount: number;
  totalCount: number;
};

const normalizeBatchTranslateSize = (value: unknown): number => {
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

const CLEANUP_PRESET_EXTENSIONS = [".html", ".url", ".txt", ".nfo", ".jpg", ".png", ".torrent", ".ass", ".srt"];

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

export interface FileCleanerCandidateView {
  path: string;
  ext?: string;
  size?: number | null;
  lastModified?: string | null;
}

export interface FileCleanerScanInput {
  extensions: string[];
  includeSubdirs: boolean;
  relativePath: string;
  rootId: string;
  targetPath: string;
}

export interface FileCleanerWorkspaceDetailProps {
  candidates: FileCleanerCandidateView[];
  deleting?: boolean;
  formatBytes: (bytes: number, options?: { fractionDigits?: number }) => string;
  progress?: number;
  roots?: MediaRootDto[];
  scanning?: boolean;
  onBrowseDirectory?: () => Promise<string | null | undefined>;
  onDelete: () => void | Promise<void>;
  onScan: (input: FileCleanerScanInput) => void | Promise<void>;
}

function normalizeExtension(ext: string) {
  const value = ext.trim().toLowerCase();
  if (!value) return "";
  return value.startsWith(".") ? value : `.${value}`;
}

function extensionFromPath(path: string) {
  const name = path.split(/[\\/]+/u).at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : normalizeExtension(name.slice(dot));
}

export function FileCleanerWorkspaceDetail({
  candidates,
  deleting = false,
  formatBytes,
  progress = 0,
  roots,
  scanning = false,
  onBrowseDirectory,
  onDelete,
  onScan,
}: FileCleanerWorkspaceDetailProps) {
  const [targetPath, setTargetPath] = useState("");
  const [rootId, setRootId] = useState("");
  const [relativePath, setRelativePath] = useState("");
  const [extensions, setExtensions] = useState<string[]>([".html", ".url"]);
  const [customExtension, setCustomExtension] = useState("");
  const [includeSubdirs, setIncludeSubdirs] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const previewRows = candidates.slice(0, 400);
  const totalSize = useMemo(
    () => candidates.reduce((sum, item) => sum + (Number.isFinite(item.size) ? (item.size ?? 0) : 0), 0),
    [candidates],
  );
  const usesMediaRoots = Boolean(roots?.length);

  const toggleExtension = (extension: string) => {
    const normalized = normalizeExtension(extension);
    if (!normalized) return;
    setExtensions((prev) =>
      prev.includes(normalized) ? prev.filter((current) => current !== normalized) : [...prev, normalized],
    );
  };

  const addCustomExtension = () => {
    const normalized = normalizeExtension(customExtension);
    if (!normalized || extensions.includes(normalized)) {
      setCustomExtension("");
      return;
    }
    setExtensions((prev) => [...prev, normalized]);
    setCustomExtension("");
  };

  const browseDirectory = async () => {
    const selected = await onBrowseDirectory?.();
    if (selected) setTargetPath(selected);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
        <div className={cn(TOOL_SUBSECTION_CLASS, "flex-1")}>
          <Label
            htmlFor={usesMediaRoots ? "clean-root" : "clean-path"}
            className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
          >
            扫描目录
          </Label>
          {usesMediaRoots ? (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <select
                id="clean-root"
                className={TOOL_INPUT_CLASS}
                value={rootId}
                onChange={(event) => setRootId(event.target.value)}
              >
                <option value="">选择媒体目录</option>
                {roots?.map((root) => (
                  <option key={root.id} value={root.id}>
                    {root.displayName}
                  </option>
                ))}
              </select>
              <Input
                value={relativePath}
                onChange={(event) => setRelativePath(event.target.value)}
                placeholder="可选：相对路径"
                className={TOOL_INPUT_CLASS}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                id="clean-path"
                value={targetPath}
                onChange={(event) => setTargetPath(event.target.value)}
                placeholder="/path/to/library"
                className={cn(TOOL_INPUT_CLASS, "flex-1")}
              />
              {onBrowseDirectory ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className={TOOL_ICON_BUTTON_CLASS}
                  onClick={browseDirectory}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          )}
        </div>

        <Button
          variant="secondary"
          onClick={() => void onScan({ targetPath, rootId, relativePath, extensions, includeSubdirs })}
          disabled={scanning}
          className={cn(TOOL_SECONDARY_BUTTON_CLASS, "w-full xl:w-auto")}
        >
          {scanning ? "正在扫描..." : "开始扫描"}
        </Button>
      </div>

      <div className={TOOL_SUBSECTION_CLASS}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            文件类型过滤
          </Label>
          <div className="flex items-center gap-2">
            <Checkbox
              id="include-subdirs"
              checked={includeSubdirs}
              onCheckedChange={(checked) => setIncludeSubdirs(Boolean(checked))}
            />
            <Label htmlFor="include-subdirs" className="cursor-pointer text-sm text-foreground">
              包含子目录
            </Label>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {CLEANUP_PRESET_EXTENSIONS.map((ext) => (
            <button
              key={ext}
              type="button"
              onClick={() => toggleExtension(ext)}
              className={cn(
                "rounded-quiet-capsule px-3.5 py-2 text-xs font-mono transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                extensions.includes(ext)
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-floating text-muted-foreground hover:bg-surface-raised/70",
              )}
            >
              {ext}
            </button>
          ))}
        </div>

        <div className="flex max-w-md gap-2">
          <Input
            value={customExtension}
            onChange={(event) => setCustomExtension(event.target.value)}
            placeholder="自定义扩展名, 如 .bak"
            className={TOOL_INPUT_CLASS}
          />
          <Button variant="secondary" size="sm" onClick={addCustomExtension} className="rounded-quiet-capsule px-4">
            添加
          </Button>
        </div>
      </div>

      {deleting ? (
        <div className={TOOL_SUBSECTION_CLASS}>
          <div className="flex justify-between text-xs font-semibold text-muted-foreground">
            <span>正在删除文件...</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="h-2 bg-surface-floating" />
        </div>
      ) : null}

      <div className={TOOL_TABLE_SHELL_CLASS}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-low/90 text-muted-foreground">
                <th className="w-20 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">类型</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">文件路径</th>
                <th className="w-24 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">大小</th>
                <th className="w-40 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">最后修改</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/5">
              {previewRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground italic">
                    暂无待清理文件
                  </td>
                </tr>
              ) : (
                previewRows.map((item) => (
                  <tr key={item.path} className="transition-colors hover:bg-surface-low/45">
                    <td className="px-4 py-3 font-mono text-foreground/70">
                      {item.ext || extensionFromPath(item.path) || "-"}
                    </td>
                    <td className="max-w-md truncate px-4 py-3 font-mono" title={item.path}>
                      {item.path}
                    </td>
                    <td className="px-4 py-3 font-numeric text-muted-foreground">
                      {Number.isFinite(item.size) ? formatBytes(item.size ?? 0, { fractionDigits: 2 }) : "-"}
                    </td>
                    <td className="px-4 py-3 font-numeric text-[11px] text-muted-foreground">
                      {item.lastModified ?? "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-quiet-lg bg-surface-low/90 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">匹配文件</span>
          <span className="font-numeric font-semibold text-foreground">{candidates.length}</span>
          <span className="text-muted-foreground">总大小</span>
          <span className="font-numeric font-semibold text-destructive">
            {formatBytes(totalSize, { fractionDigits: 2 })}
          </span>
        </div>

        <Button
          variant="destructive"
          onClick={() => setConfirmOpen(true)}
          disabled={candidates.length === 0 || deleting}
          className="h-11 rounded-quiet-capsule px-6 text-sm font-semibold"
        >
          <Trash2 className="h-4 w-4" />
          确认清理
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="rounded-quiet-lg border-none bg-surface-floating shadow-[0_24px_60px_rgba(15,23,42,0.12)]">
          <DialogHeader>
            <DialogTitle>确认清理文件</DialogTitle>
            <DialogDescription>
              将永久删除 <span className="font-bold text-foreground">{candidates.length}</span> 个文件 (约{" "}
              <span className="font-bold text-destructive">{formatBytes(totalSize, { fractionDigits: 2 })}</span>
              )。此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
              className="rounded-quiet-capsule"
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void onDelete();
                setConfirmOpen(false);
              }}
              disabled={deleting}
              className="rounded-quiet-capsule px-8"
            >
              {deleting ? "正在清理..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

export function BatchNfoTranslatorWorkspaceDetail({
  items,
  scanning = false,
  onApply,
  onApplyComplete,
  onBrowseDirectory,
  onScan,
}: BatchNfoTranslatorWorkspaceDetailProps) {
  const [directory, setDirectory] = useState("");
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_TRANSLATE_SIZE);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
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
  const resultRows = results.slice(0, 300);
  const pendingFieldCount = useMemo(() => items.reduce((sum, item) => sum + item.pendingFields.length, 0), [items]);
  const selectedItems = useMemo(() => items.filter((item) => selectedPaths.has(item.filePath)), [items, selectedPaths]);
  const selectedPendingFieldCount = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.pendingFields.length, 0),
    [selectedItems],
  );
  const allSelected = items.length > 0 && selectedPaths.size === items.length;
  const someSelected = selectedPaths.size > 0 && selectedPaths.size < items.length;
  const normalizedBatchSize = normalizeBatchTranslateSize(batchSize);
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

      const resultByPath = new Map(chunkResults.map((result) => [result.filePath, result]));
      for (const item of chunk) {
        const result = resultByPath.get(item.filePath) ?? buildFailedBatchTranslateResult(item, "未返回翻译结果");
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
          chunk.map((item) => {
            const result = resultByPath.get(item.filePath) ?? buildFailedBatchTranslateResult(item, "未返回翻译结果");
            return [item.filePath, toBatchTranslateItemApplyStatus(result)];
          }),
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
    if (selected) setDirectory(selected);
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
            placeholder="输入已刮削完成的媒体目录"
            className={cn(TOOL_INPUT_CLASS, "flex-1")}
          />
          {onBrowseDirectory ? (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className={TOOL_ICON_BUTTON_CLASS}
              onClick={browseDirectory}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        <p className={TOOL_NOTE_CLASS}>该工具使用当前配置中的 LLM 模型、Base URL 与 API Key，独立于主刮削翻译流程。</p>
      </div>

      <div className={cn(TOOL_SUBSECTION_CLASS, "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between")}>
        <div className="max-w-2xl space-y-2">
          <Label
            htmlFor="batch-translate-size"
            className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
          >
            每批翻译条数
          </Label>
          <p className={TOOL_NOTE_CLASS}>
            1 为逐项翻译；20 为最多合并 20 条待翻译内容后请求大模型统一翻译，本地模型不稳定时建议调小。
          </p>
        </div>
        <div className="flex items-center gap-2 sm:shrink-0">
          <Input
            id="batch-translate-size"
            type="number"
            min={MIN_BATCH_TRANSLATE_SIZE}
            max={MAX_BATCH_TRANSLATE_SIZE}
            value={batchSize}
            onBlur={() => setBatchSize(normalizedBatchSize)}
            onChange={(event) => setBatchSize(normalizeBatchTranslateSize(event.target.value))}
            className={cn(TOOL_INPUT_CLASS, "w-28")}
          />
          <span className="text-sm text-muted-foreground">条/批</span>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          variant="secondary"
          onClick={() => void handleScan()}
          disabled={scanning || applying}
          className={cn(TOOL_SECONDARY_BUTTON_CLASS, "flex-1")}
        >
          {scanning ? "正在扫描..." : "扫描待翻译条目"}
        </Button>
        <Button
          onClick={() => void handleApply()}
          disabled={applying || scanning || selectedItems.length === 0}
          className={cn(TOOL_PRIMARY_BUTTON_CLASS, "flex-1")}
        >
          {applying
            ? applyProgress
              ? `翻译中 (${applyProgress.completed}/${applyProgress.total})`
              : "正在翻译..."
            : selectedItems.length === items.length
              ? "开始批量翻译并回写"
              : `翻译选中项 (${selectedItems.length})`}
        </Button>
        {applying ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setApplyPaused(!paused)}
            className={cn(TOOL_SECONDARY_BUTTON_CLASS, "sm:w-32")}
          >
            {paused ? "继续" : "暂停"}
          </Button>
        ) : null}
      </div>

      {applying && applyProgress ? (
        <div className={TOOL_SUBSECTION_CLASS}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-muted-foreground">
            <span>
              {paused ? "暂停中" : "正在翻译"} {applyProgress.currentLabel ?? "..."} ({applyProgress.completed}/
              {applyProgress.total})
            </span>
            <span>{applyProgressPercent}%</span>
          </div>
          <Progress value={applyProgressPercent} className="h-2 bg-surface-floating" />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">待处理条目</span>
        <Badge variant="secondary" className="rounded-quiet-capsule px-2.5 py-1">
          {items.length}
        </Badge>
        <span className="text-muted-foreground">已选中</span>
        <Badge variant="secondary" className="rounded-quiet-capsule px-2.5 py-1">
          {selectedItems.length}
        </Badge>
        <span className="text-muted-foreground">待处理字段</span>
        <Badge variant="secondary" className="rounded-quiet-capsule px-2.5 py-1">
          {pendingFieldCount}
        </Badge>
        {selectedItems.length < items.length ? (
          <>
            <span className="text-muted-foreground">选中字段</span>
            <Badge variant="secondary" className="rounded-quiet-capsule px-2.5 py-1">
              {selectedPendingFieldCount}
            </Badge>
          </>
        ) : null}
        {results.length > 0 ? (
          <>
            <span className="text-muted-foreground">已完成</span>
            <Badge variant="secondary" className="rounded-quiet-capsule px-2.5 py-1">
              {results.length}
            </Badge>
            <span className="text-muted-foreground">成功</span>
            <Badge variant="secondary" className="rounded-quiet-capsule px-2.5 py-1">
              {resultSummary.successCount}
            </Badge>
            {resultSummary.partialCount > 0 ? (
              <>
                <span className="text-muted-foreground">部分成功</span>
                <Badge variant="secondary" className="rounded-quiet-capsule px-2.5 py-1">
                  {resultSummary.partialCount}
                </Badge>
              </>
            ) : null}
            {resultSummary.failedCount > 0 ? (
              <>
                <span className="text-muted-foreground">失败</span>
                <Badge variant="secondary" className="rounded-quiet-capsule px-2.5 py-1">
                  {resultSummary.failedCount}
                </Badge>
              </>
            ) : null}
          </>
        ) : null}
      </div>

      <div className={TOOL_TABLE_SHELL_CLASS}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-low/90 text-muted-foreground">
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
                <th className="w-72 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">NFO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/5">
              {previewRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground italic">
                    暂无待翻译条目
                  </td>
                </tr>
              ) : (
                previewRows.map((item) => (
                  <tr key={item.filePath} className="transition-colors hover:bg-surface-low/45">
                    <td className="px-4 py-3">
                      <Checkbox
                        checked={selectedPaths.has(item.filePath)}
                        disabled={applying || scanning}
                        onCheckedChange={() => toggleItem(item.filePath)}
                      />
                    </td>
                    <td className="px-4 py-3 font-mono font-medium">{item.number}</td>
                    <td className="px-4 py-3">{item.title}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {item.pendingFields.map((field) => (
                          <Badge
                            key={`${item.filePath}-${field}`}
                            variant="secondary"
                            className="rounded-quiet-capsule px-2.5 py-1"
                          >
                            {field === "title" ? "标题" : "简介"}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className="rounded-quiet-capsule px-2.5 py-1">
                        {buildBatchTranslateApplyStatusLabel(itemStatusByPath[item.filePath] ?? "idle")}
                      </Badge>
                    </td>
                    <td className="break-all px-4 py-3 font-mono text-[11px] text-muted-foreground">{item.nfoPath}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {results.length > 0 ? (
        <div className="space-y-3">
          <Label className="px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            最近一次执行结果
          </Label>
          <div className={TOOL_TABLE_SHELL_CLASS}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-low/90 text-muted-foreground">
                    <th className="w-24 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">状态</th>
                    <th className="w-28 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">番号</th>
                    <th className="w-36 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">已写回字段</th>
                    <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">结果</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/5">
                  {resultRows.map((item) => {
                    const partial = !item.success && item.translatedFields.length > 0;
                    return (
                      <tr
                        key={`${item.filePath}-${item.nfoPath}`}
                        className="transition-colors hover:bg-surface-low/45"
                      >
                        <td className="px-4 py-3">
                          <Badge variant="secondary" className="rounded-quiet-capsule px-2.5 py-1">
                            {item.success ? "成功" : partial ? "部分成功" : "失败"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-mono font-medium">{item.number}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {item.translatedFields.length === 0 ? (
                              <span className="text-muted-foreground">-</span>
                            ) : (
                              item.translatedFields.map((field) => (
                                <Badge
                                  key={`${item.nfoPath}-${field}`}
                                  variant="secondary"
                                  className="rounded-quiet-capsule px-2.5 py-1"
                                >
                                  {field === "title" ? "标题" : "简介"}
                                </Badge>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            {item.savedNfoPath ? (
                              <div className="break-all font-mono text-[11px] text-muted-foreground">
                                {item.savedNfoPath}
                              </div>
                            ) : null}
                            {item.error ? <div className="text-destructive">{item.error}</div> : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
