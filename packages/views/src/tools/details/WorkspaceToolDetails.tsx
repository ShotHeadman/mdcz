import { toErrorMessage } from "@mdcz/shared/error";
import type { BatchTranslateApplyResultItem, BatchTranslateMode, BatchTranslateScanItem } from "@mdcz/shared/ipcTypes";
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
import { type Messages, useT } from "../../i18n";

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

const buildBatchTranslateApplyStatusLabel = (status: BatchTranslateItemApplyStatus, t: Messages): string => {
  return t.tools.batchTranslateStatus[status];
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
  const t = useT();
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
          {t.tools.filePath}
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
        <p className={TOOL_NOTE_CLASS}>{t.tools.singleFileScrapeNote}</p>
      </div>

      <Button
        onClick={() => void onRun(filePath)}
        disabled={pending}
        className={cn(TOOL_PRIMARY_BUTTON_CLASS, "w-full sm:w-auto")}
      >
        {pending ? t.tools.scraping : t.tools.startSingleFileScrape}
      </Button>
    </div>
  );
}

export interface BatchNfoTranslatorWorkspaceDetailProps {
  items: BatchTranslateScanItem[];
  scanning?: boolean;
  onApply: (
    items: BatchTranslateScanItem[],
    batchSize: number,
    mode: BatchTranslateMode,
  ) => Promise<BatchTranslateApplyResultItem[]>;
  onApplyComplete?: (summary: BatchNfoTranslatorApplySummary) => void;
  onBrowseDirectory?: () => Promise<string | null | undefined>;
  onScan: (directory: string, mode: BatchTranslateMode) => void | Promise<void>;
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
  const t = useT();
  const [directory, setDirectory] = useState(readStoredBatchTranslateDirectory);
  const [batchSizeInput, setBatchSizeInput] = useState(String(DEFAULT_BATCH_TRANSLATE_SIZE));
  const [mode, setMode] = useState<BatchTranslateMode>("untranslated");
  // Apply must translate with the mode that produced the listed items.
  const [scannedMode, setScannedMode] = useState<BatchTranslateMode>("untranslated");
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
    setScannedMode(mode);
    await onScan(directory, mode);
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
      const chunkLabel =
        chunk.length === 1
          ? chunk[0]?.number
          : t.tools.batchTranslateChunkLabel(chunk[0]?.number ?? "...", chunk.length);
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
        chunkResults = await onApply(chunk, normalizedBatchSize, scannedMode);
      } catch (error) {
        chunkResults = chunk.map((item) => buildFailedBatchTranslateResult(item, toErrorMessage(error)));
      }

      const returnedResultByPath = new Map(chunkResults.map((result) => [result.filePath, result]));
      const resolvedChunkResults = chunk.map((item) => ({
        filePath: item.filePath,
        result:
          returnedResultByPath.get(item.filePath) ??
          buildFailedBatchTranslateResult(item, t.tools.noTranslationReturned),
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

  const batchSizePresets = [
    { label: t.tools.presetItemSingle, value: 1 },
    { label: t.tools.presetItems(5), value: 5 },
    { label: t.tools.presetItems(10), value: 10 },
    { label: t.tools.presetItemsMerged(20), value: 20 },
  ];

  return (
    <div className="space-y-6">
      <div className={TOOL_SUBSECTION_CLASS}>
        <Label
          htmlFor="batch-translate-dir"
          className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
        >
          {t.tools.targetDirectory}
        </Label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            id="batch-translate-dir"
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
            onBlur={(event) => persistBatchTranslateDirectory(event.target.value)}
            placeholder={t.tools.batchTranslateDirPlaceholder}
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
              <span>{t.tools.browseDirectory}</span>
            </Button>
          ) : null}
        </div>
      </div>

      <div className={TOOL_SUBSECTION_CLASS}>
        <div className="space-y-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {t.tools.batchTranslateMode}
            </span>
            <span className="text-xs text-muted-foreground">{t.tools.batchTranslateModeHelp[mode]}</span>
          </div>
          <div className="flex w-fit items-center gap-1.5 rounded-quiet-capsule bg-surface-floating/80 p-1 border border-black/5 dark:border-white/5">
            {(["untranslated", "all", "restore"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
                className={cn(
                  "flex h-8 items-center px-3.5 rounded-quiet-capsule text-xs font-medium transition-all",
                  mode === option
                    ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                    : "text-muted-foreground hover:bg-surface-low hover:text-foreground",
                )}
              >
                {t.tools.batchTranslateModeOptions[option]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {mode !== "restore" && (
        <div className={TOOL_SUBSECTION_CLASS}>
          <div className="space-y-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <Label
                htmlFor="batch-translate-size"
                className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
              >
                {t.tools.batchTranslateBatchSize}
              </Label>
              <span className="text-xs text-muted-foreground">{t.tools.batchTranslateBatchSizeHelp}</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 rounded-quiet-capsule bg-surface-floating/80 p-1 border border-black/5 dark:border-white/5">
                <span className="px-2.5 text-xs font-medium text-muted-foreground">{t.tools.presetPrefix}</span>
                {batchSizePresets.map((preset) => (
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
                  {t.tools.customPrefix}
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
                    {t.tools.itemsPerBatch}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          variant="secondary"
          onClick={() => void handleScan()}
          disabled={scanning || applying}
          className={cn(TOOL_SECONDARY_BUTTON_CLASS, "flex-1")}
        >
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          <span>{scanning ? t.tools.scanning : t.tools.scanPendingItems}</span>
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
                ? t.tools.translatingProgress(applyProgress.completed, applyProgress.total)
                : t.tools.translating
              : scannedMode === "restore"
                ? selectedItems.length === items.length
                  ? t.tools.startRestore
                  : t.tools.restoreSelected(selectedItems.length)
                : selectedItems.length === items.length
                  ? t.tools.startBatchTranslate
                  : t.tools.translateSelected(selectedItems.length)}
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
            <span>{paused ? t.common.resume : t.common.pause}</span>
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
              {paused ? t.tools.paused : t.tools.translating} {applyProgress.currentLabel ?? "..."} (
              {applyProgress.completed}/{applyProgress.total})
            </span>
            <span className="font-mono">{applyProgressPercent}%</span>
          </div>
          <Progress value={applyProgressPercent} className="h-2 bg-surface-floating" />
        </div>
      ) : null}

      <div className="flex w-full flex-wrap gap-3 md:flex-nowrap">
        <div className="flex-1 min-w-[120px] rounded-quiet-lg bg-surface-low/90 p-3.5 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-[11px] font-semibold uppercase tracking-wider">{t.tools.pendingItems}</span>
            <FileText className="h-3.5 w-3.5" />
          </div>
          <div className="text-lg font-bold font-mono">{items.length}</div>
        </div>
        <div className="flex-1 min-w-[120px] rounded-quiet-lg bg-surface-low/90 p-3.5 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-[11px] font-semibold uppercase tracking-wider">{t.tools.selected}</span>
            <Layers className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="text-lg font-bold font-mono text-primary">{selectedItems.length}</div>
        </div>
        <div className="flex-1 min-w-[120px] rounded-quiet-lg bg-surface-low/90 p-3.5 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-[11px] font-semibold uppercase tracking-wider">{t.tools.pendingFields}</span>
            <Languages className="h-3.5 w-3.5" />
          </div>
          <div className="text-lg font-bold font-mono">{pendingFieldCount}</div>
        </div>
        {results.length > 0 ? (
          <>
            <div className="flex-1 min-w-[120px] rounded-quiet-lg bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20 p-3.5 space-y-1">
              <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
                <span className="text-[11px] font-semibold uppercase tracking-wider">{t.common.success}</span>
                <CheckCircle2 className="h-3.5 w-3.5" />
              </div>
              <div className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                {resultSummary.successCount}
              </div>
            </div>
            <div className="flex-1 min-w-[120px] rounded-quiet-lg bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 p-3.5 space-y-1">
              <div className="flex items-center justify-between text-amber-600 dark:text-amber-400">
                <span className="text-[11px] font-semibold uppercase tracking-wider">{t.tools.partialSuccess}</span>
                <AlertCircle className="h-3.5 w-3.5" />
              </div>
              <div className="text-lg font-bold font-mono text-amber-600 dark:text-amber-400">
                {resultSummary.partialCount}
              </div>
            </div>
            <div className="flex-1 min-w-[120px] rounded-quiet-lg bg-red-500/5 dark:bg-red-500/10 border border-red-500/20 p-3.5 space-y-1">
              <div className="flex items-center justify-between text-red-600 dark:text-red-400">
                <span className="text-[11px] font-semibold uppercase tracking-wider">{t.common.failed}</span>
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
                <th className="w-28 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">
                  {t.tools.movieCode}
                </th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">{t.tools.title}</th>
                <th className="w-40 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">
                  {t.tools.pendingFields}
                </th>
                <th className="w-28 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">{t.tools.status}</th>
                <th className="w-72 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">
                  {t.tools.nfoPath}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/5">
              {previewRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Search className="h-8 w-8 opacity-40" />
                      <p className="text-sm font-medium">{t.tools.noPendingTranslateItems}</p>
                      <p className="text-xs text-muted-foreground">{t.tools.noPendingTranslateItemsHelp}</p>
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
                                {field === "title" ? t.tools.fieldTitle : t.tools.fieldPlot}
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
                            {buildBatchTranslateApplyStatusLabel(status, t)}
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
