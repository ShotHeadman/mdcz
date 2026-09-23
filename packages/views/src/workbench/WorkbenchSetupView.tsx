import { getMaintenancePresetMeta, MAINTENANCE_PRESET_OPTIONS } from "@mdcz/shared/maintenancePresets";
import type { MaintenancePresetId, MediaCandidate } from "@mdcz/shared/types";
import { Button, Checkbox, cn } from "@mdcz/ui";
import { AlertCircle, ArrowDown, Check, FolderOpen, FolderOutput, Loader2, Search, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { PathAutocompleteInput, type PathAutocompleteResult } from "../path";
import { FloatingWorkbenchBar } from "./FloatingWorkbenchBar";

export type WorkbenchSetupMode = "scrape" | "maintenance";
export type WorkbenchSetupScanStatus = "idle" | "scanning" | "success" | "error";

export interface WorkbenchSetupViewProps {
  mode: WorkbenchSetupMode;
  previewMode?: boolean;
  onExitPreview?: () => void;
  configLoading?: boolean;
  scanDir: string;
  scanDirError?: string;
  recursive?: boolean;
  onRecursiveChange?: (recursive: boolean) => void;
  onCommitScanDir?: () => void;
  warnings?: { count: number; paths: string[] };
  targetDir?: string;
  candidates: MediaCandidate[];
  selectedPaths: string[];
  selectedSize: number;
  totalSize: number;
  scanStatus: WorkbenchSetupScanStatus;
  scanError?: string;
  scanning: boolean;
  startPending: boolean;
  supportedExtensions: string[];
  presetId: MaintenancePresetId;
  runSummary: string;
  primaryDisabled: boolean;
  isServer?: boolean;
  onSuggestScanDir?: (input: { path: string }) => Promise<PathAutocompleteResult>;
  onSuggestTargetDir?: (input: { path: string }) => Promise<PathAutocompleteResult>;
  formatBytes: (value: number, options?: { trimTrailingZeros?: boolean }) => string;
  onBrowseScanDir: () => void;
  onBrowseTargetDir?: () => void;
  onScanDirChange?: (value: string) => void;
  onTargetDirChange?: (value: string) => void;
  refreshDisabled?: boolean;
  onRefreshScan: () => void;
  onPresetChange: (presetId: MaintenancePresetId) => void;
  onStart: () => void;
  onToggleCandidate: (path: string) => void;
  onToggleAll: (selected: boolean) => void;
}

const RAIL_CARD_CLASS =
  "rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-25px_rgba(0,0,0,0.12)] dark:border-neutral-800 dark:bg-neutral-900";
const MEDIA_GRID_CLASS = "grid grid-cols-[auto_minmax(0,1fr)_84px_76px] gap-4";
const MEDIA_ROW_CLASS =
  "w-full cursor-pointer items-start border-t border-neutral-200 px-5 py-3.5 text-left transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60";
const MEDIA_ROW_META_CLASS = "pt-0.5 font-numeric text-xs leading-5 text-muted-foreground";
const SCAN_FEEDBACK_DELAY_MS = 500;

function useDelayedFlag(active: boolean, delayMs: number) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setVisible(true);
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [active, delayMs]);

  return visible;
}

function getDirBasename(path: string) {
  if (!path) return "";
  const normalized = path.replace(/[/\\]+$/, "");
  const parts = normalized.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function PathControl({
  label,
  icon,
  value,
  placeholder,
  onBrowse,
  onChange,
  onCommit,
  supportsBrowse,
  loadSuggestions,
  error,
}: {
  label: string;
  icon: ReactNode;
  value: string;
  placeholder: string;
  onBrowse: () => void;
  onChange?: (value: string) => void;
  onCommit?: () => void;
  supportsBrowse?: boolean;
  loadSuggestions?: (value: string) => Promise<PathAutocompleteResult>;
  error?: string;
}) {
  const inputId = useId();

  return (
    <div className="min-w-0 space-y-2.5">
      <label htmlFor={inputId} className="block text-sm font-semibold tracking-tight text-foreground">
        {label}
      </label>
      <div className="flex min-w-0 items-center rounded-2xl border border-neutral-200 bg-neutral-50 pl-4 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] transition-all focus-within:border-neutral-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-neutral-500/10 dark:border-neutral-700 dark:bg-neutral-800 dark:focus-within:bg-neutral-800">
        <span className="shrink-0 text-neutral-500 dark:text-neutral-400" aria-hidden="true">
          {icon}
        </span>
        <PathAutocompleteInput
          id={inputId}
          value={value}
          readOnly={!onChange}
          placeholder={placeholder}
          loadSuggestions={loadSuggestions}
          inputClassName="h-14 min-w-0 flex-1 truncate border-0 bg-transparent px-3 font-mono text-sm text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:ring-0"
          onChange={onChange}
          onBlur={onCommit}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.defaultPrevented && !event.nativeEvent.isComposing) onCommit?.();
          }}
        />
        {(supportsBrowse ?? true) ? (
          <Button
            type="button"
            variant="ghost"
            className="mr-1.5 h-10 shrink-0 rounded-xl px-4 text-xs font-semibold text-foreground hover:bg-neutral-200 dark:hover:bg-neutral-700"
            onClick={onBrowse}
          >
            浏览
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ScanningStatus({ scopeLabel }: { scopeLabel: string }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <p role="status" className="mt-2 text-xs text-muted-foreground">
      正在扫描（{scopeLabel}）· 已耗时 {elapsedSeconds} 秒
    </p>
  );
}

function MediaRow({
  candidate,
  selected,
  disabled,
  formatBytes,
  onToggle,
}: {
  candidate: MediaCandidate;
  selected: boolean;
  disabled: boolean;
  formatBytes: (value: number, options?: { trimTrailingZeros?: boolean }) => string;
  onToggle: () => void;
}) {
  const checkboxId = useId();

  return (
    <div className={cn(MEDIA_GRID_CLASS, MEDIA_ROW_CLASS)}>
      <Checkbox id={checkboxId} className="mt-0.5" checked={selected} disabled={disabled} onCheckedChange={onToggle} />
      <label htmlFor={checkboxId} className="contents">
        <div className="min-w-0 space-y-0.5">
          <div className="truncate text-sm font-bold leading-5 tracking-tight text-foreground">{candidate.name}</div>
          {candidate.ref.relativePath.includes("/") ? (
            <div className="truncate font-mono text-[10px]/4 text-muted-foreground">
              {candidate.ref.relativePath.slice(0, candidate.ref.relativePath.lastIndexOf("/"))}
            </div>
          ) : null}
        </div>
        <div className={cn(MEDIA_ROW_META_CLASS, "font-bold uppercase")}>{candidate.extension.replace(/^\./u, "")}</div>
        <div className={MEDIA_ROW_META_CLASS}>{formatBytes(candidate.size, { trimTrailingZeros: true })}</div>
      </label>
    </div>
  );
}

export function WorkbenchSetupView({
  mode,
  previewMode = false,
  onExitPreview,
  configLoading = false,
  scanDir,
  scanDirError,
  recursive = false,
  onRecursiveChange,
  onCommitScanDir,
  warnings,
  targetDir = "",
  candidates,
  selectedPaths,
  selectedSize,
  totalSize,
  scanStatus,
  scanError,
  scanning,
  startPending,
  supportedExtensions,
  presetId,
  runSummary,
  primaryDisabled,
  isServer = false,
  onSuggestScanDir,
  onSuggestTargetDir,
  formatBytes,
  onBrowseScanDir,
  onBrowseTargetDir,
  onScanDirChange,
  onTargetDirChange,
  refreshDisabled = false,
  onRefreshScan,
  onPresetChange,
  onStart,
  onToggleCandidate,
  onToggleAll,
}: WorkbenchSetupViewProps) {
  const selectedPathSet = new Set(selectedPaths);
  const recursiveId = useId();
  const scopeLabel = recursive ? "含子目录" : "仅当前目录";
  const allSelected = candidates.length > 0 && selectedPaths.length === candidates.length;
  const someSelected = selectedPaths.length > 0 && selectedPaths.length < candidates.length;
  const showScanFeedback = useDelayedFlag(scanning, SCAN_FEEDBACK_DELAY_MS);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!previewMode || !onExitPreview) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onExitPreview();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewMode, onExitPreview]);

  const filteredCandidates = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return candidates;
    return candidates.filter(
      (candidate) =>
        candidate.name.toLowerCase().includes(query) ||
        candidate.ref.relativePath.toLowerCase().includes(query) ||
        candidate.extension.toLowerCase().includes(query),
    );
  }, [candidates, searchQuery]);
  const summary = runSummary || (candidates.length > 0 ? formatBytes(totalSize, { trimTrailingZeros: true }) : "");

  return (
    <div className="relative h-full overflow-hidden bg-neutral-50 text-foreground dark:bg-neutral-950">
      <div className={cn("relative h-full", previewMode ? "overflow-hidden" : "overflow-y-auto")}>
        <main
          className={cn(
            "mx-auto w-full max-w-6xl px-5 pt-[clamp(2.5rem,7vh,5rem)] md:px-10 lg:px-12",
            previewMode ? "flex h-full flex-col pb-6" : "pb-36",
          )}
        >
          {!previewMode ? (
            <div className="relative">
              <section className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
                <div className="relative flex flex-col">
                  <span
                    className="font-numeric text-4xl font-black tracking-tight text-neutral-300 dark:text-neutral-700"
                    aria-hidden="true"
                  >
                    01
                  </span>
                  {mode === "maintenance" ? (
                    <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                      {MAINTENANCE_PRESET_OPTIONS.map((option) => {
                        const active = option.id === presetId;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            className={cn(
                              RAIL_CARD_CLASS,
                              "flex min-h-24 flex-col items-start justify-between px-4 py-4 text-left transition-all duration-300 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-neutral-500/20",
                              active ? "border-neutral-500 ring-2 ring-neutral-500/10" : "hover:border-neutral-400",
                            )}
                            onClick={() => onPresetChange(option.id)}
                          >
                            <div className="flex w-full items-start justify-between gap-3">
                              <div className="text-sm font-bold tracking-tight">{option.label}</div>
                              <span
                                className={cn(
                                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                                  active
                                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                                    : "border-neutral-400",
                                )}
                              >
                                {active ? <Check className="h-3 w-3" /> : null}
                              </span>
                            </div>
                            <p className="mt-3 text-xs leading-5 text-muted-foreground">
                              {getMaintenancePresetMeta(option.id).description}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                <div className="relative flex min-h-[26rem] flex-col justify-center overflow-visible rounded-[2rem] border border-neutral-200 bg-white p-6 shadow-[0_24px_70px_-35px_rgba(0,0,0,0.16)] md:min-h-[30rem] md:p-10 lg:min-h-[32rem] lg:p-12 dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="space-y-6 md:space-y-8">
                    <div>
                      <PathControl
                        label="扫描目录"
                        icon={<FolderOpen className="h-5 w-5" />}
                        value={scanDir}
                        error={scanDirError}
                        placeholder={configLoading ? "正在读取配置..." : "请选择需要扫描的媒体目录"}
                        onBrowse={onBrowseScanDir}
                        onChange={onScanDirChange}
                        onCommit={onCommitScanDir}
                        supportsBrowse={!isServer}
                        loadSuggestions={onSuggestScanDir ? (value) => onSuggestScanDir({ path: value }) : undefined}
                      />
                      <label
                        htmlFor={recursiveId}
                        className="mt-4 inline-flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-2 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                      >
                        <Checkbox
                          id={recursiveId}
                          checked={recursive}
                          onCheckedChange={(checked) => onRecursiveChange?.(checked === true)}
                        />
                        包含子目录
                      </label>
                    </div>
                    {mode === "scrape" || presetId === "local_organize" || presetId === "rebuild_all" ? (
                      <div>
                        <div className="mb-4 flex h-7 items-center pl-6" aria-hidden="true">
                          <span className="h-full border-l border-dashed border-neutral-300 dark:border-neutral-600" />
                          <ArrowDown className="-ml-2 mt-6 h-4 w-4 rounded-full bg-white text-neutral-400 dark:bg-neutral-900" />
                        </div>
                        <PathControl
                          label="输出目录"
                          icon={<FolderOutput className="h-5 w-5" />}
                          value={targetDir}
                          placeholder={configLoading ? "正在读取配置..." : "请选择输出目录"}
                          onBrowse={onBrowseTargetDir ?? (() => undefined)}
                          onChange={onTargetDirChange}
                          supportsBrowse={!isServer}
                          loadSuggestions={
                            onSuggestTargetDir ? (value) => onSuggestTargetDir({ path: value }) : undefined
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            </div>
          ) : null}
          {previewMode ? (
            <section className="grid flex-1 min-h-0 items-start gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-8">
              <div>
                <span
                  className="font-numeric text-4xl font-black tracking-tight text-neutral-300 dark:text-neutral-700"
                  aria-hidden="true"
                >
                  02
                </span>
                <div className={cn(RAIL_CARD_CLASS, "mt-8 flex flex-col gap-3 p-4")}>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground">
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                      <span>扫描目录</span>
                    </div>
                    <div className="truncate text-xs font-bold text-foreground" title={scanDir}>
                      {getDirBasename(scanDir)}
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground/75" title={scanDir}>
                      {scanDir}
                    </div>
                  </div>

                  {(mode === "scrape" || presetId === "local_organize" || presetId === "rebuild_all") && targetDir ? (
                    <>
                      <div className="flex items-center gap-2 py-0.5">
                        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                        <ArrowDown className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground">
                          <FolderOutput className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                          <span>输出目录</span>
                        </div>
                        <div className="truncate text-xs font-bold text-foreground" title={targetDir}>
                          {getDirBasename(targetDir)}
                        </div>
                        <div className="truncate font-mono text-[10px] text-muted-foreground/75" title={targetDir}>
                          {targetDir}
                        </div>
                      </div>
                    </>
                  ) : null}

                  <div className="flex flex-wrap gap-1.5 border-t border-neutral-100 pt-3 dark:border-neutral-800/80">
                    <span className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                      {scopeLabel}
                    </span>
                    {mode === "maintenance" ? (
                      <span className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                        {MAINTENANCE_PRESET_OPTIONS.find((option) => option.id === presetId)?.label}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex max-h-full min-h-0 min-w-0 flex-col">
                {scanning ? <ScanningStatus scopeLabel={scopeLabel} /> : null}
                {!scanning && scanStatus === "success" && warnings && warnings.count > 0 ? (
                  <p role="status" className="mb-4 shrink-0 break-all text-sm text-amber-600">
                    部分路径无法访问，已跳过 {warnings.count} 项：{warnings.paths.join("、")}
                  </p>
                ) : null}
                <div
                  className="relative flex max-h-full flex-col overflow-hidden rounded-[2rem] border border-neutral-200 bg-white shadow-[0_24px_70px_-35px_rgba(0,0,0,0.16)] dark:border-neutral-800 dark:bg-neutral-900"
                  aria-busy={scanning}
                >
                  <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-5 py-3.5 dark:border-neutral-800">
                    <div className="flex flex-wrap items-center gap-3">
                      <Checkbox
                        checked={allSelected ? true : someSelected ? "indeterminate" : false}
                        disabled={candidates.length === 0 || scanning}
                        onCheckedChange={() => onToggleAll(!allSelected)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={refreshDisabled || scanning || startPending}
                        onClick={onRefreshScan}
                      >
                        刷新文件
                      </Button>
                      <span className="font-numeric text-xs font-semibold text-foreground">
                        已选 {selectedPaths.length} / {candidates.length} 个文件
                      </span>
                      {selectedSize > 0 ? (
                        <span className="font-numeric text-xs font-bold text-muted-foreground">
                          {formatBytes(selectedSize, { trimTrailingZeros: true })}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="relative w-44 sm:w-56">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="搜索文件..."
                          className="h-8 w-full rounded-full border border-neutral-200 bg-neutral-50 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground transition-colors focus:border-neutral-400 focus:bg-white focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:focus:border-neutral-500"
                        />
                        {searchQuery ? (
                          <button
                            type="button"
                            aria-label="清空搜索"
                            onClick={() => setSearchQuery("")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                      {summary ? (
                        <span className="hidden text-xs text-muted-foreground md:inline">{summary}</span>
                      ) : null}
                    </div>
                  </div>
                  <div
                    className={cn(
                      MEDIA_GRID_CLASS,
                      "shrink-0 bg-neutral-100 px-5 py-4 font-numeric text-[10px]/4 font-bold uppercase tracking-[0.16em] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
                    )}
                  >
                    <span />
                    <span>文件</span>
                    <span>类型</span>
                    <span>大小</span>
                  </div>

                  {scanning && candidates.length === 0 && !showScanFeedback ? <div className="min-h-64" /> : null}

                  {scanning && candidates.length === 0 && showScanFeedback ? (
                    <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <div className="text-sm font-medium">正在扫描媒体文件（{scopeLabel}）</div>
                      <div className="max-w-md break-all font-mono text-xs">{scanDir}</div>
                    </div>
                  ) : null}

                  {scanning && candidates.length > 0 && showScanFeedback ? (
                    <div className="pointer-events-none absolute inset-x-4 top-12 z-10 flex justify-center">
                      <div className="flex items-center gap-2 rounded-quiet-capsule bg-surface-floating/95 px-3 py-2 text-xs font-medium text-muted-foreground shadow-[0_12px_32px_-24px_rgba(0,0,0,0.5)] ring-1 ring-border/45 backdrop-blur">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        正在扫描媒体文件...
                      </div>
                    </div>
                  ) : null}

                  {scanStatus === "error" && !scanning ? (
                    <div className="flex min-h-64 flex-col items-center justify-center gap-4 px-6 text-center">
                      <AlertCircle className="h-8 w-8 text-destructive" />
                      <div>
                        <div className="font-semibold">扫描失败</div>
                        <div className="mt-2 max-w-xl wrap-break-word text-sm text-muted-foreground">{scanError}</div>
                      </div>
                    </div>
                  ) : null}

                  {!scanning && scanStatus !== "error" && !scanDir ? (
                    <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
                      <FolderOpen className="h-8 w-8" />
                      <div className="text-sm font-medium">选择目录后，点击“选择文件”查看可处理的媒体文件。</div>
                    </div>
                  ) : null}

                  {!scanning && scanStatus === "success" && scanDir && candidates.length === 0 ? (
                    <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
                      <FolderOpen className="h-8 w-8" />
                      <div className="text-sm font-medium">
                        {recursive ? "未找到支持的视频" : "当前目录未找到视频，可勾选“包含子目录”"}
                      </div>
                      <div className="max-w-xl break-all font-mono text-xs">{scanDir}</div>
                      {supportedExtensions.length > 0 ? (
                        <div className="text-xs">支持类型: {supportedExtensions.join(", ")}</div>
                      ) : null}
                    </div>
                  ) : null}

                  {filteredCandidates.length > 0 ? (
                    <div
                      className={cn("min-h-0 flex-auto overflow-y-auto transition-opacity", scanning && "opacity-55")}
                    >
                      {filteredCandidates.map((candidate) => (
                        <MediaRow
                          key={candidate.path}
                          candidate={candidate}
                          selected={selectedPathSet.has(candidate.path)}
                          disabled={startPending || scanning}
                          formatBytes={formatBytes}
                          onToggle={() => onToggleCandidate(candidate.path)}
                        />
                      ))}
                    </div>
                  ) : null}

                  {candidates.length > 0 && filteredCandidates.length === 0 ? (
                    <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
                      <Search className="h-7 w-7 text-muted-foreground/40" />
                      <div className="text-sm font-medium">未找到匹配“{searchQuery}”的文件</div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="rounded-full text-xs"
                        onClick={() => setSearchQuery("")}
                      >
                        清空搜索
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}
        </main>
      </div>

      {scanDir ? (
        <FloatingWorkbenchBar contentClassName="mx-auto flex w-fit items-center gap-3 rounded-full border border-neutral-200/90 bg-white/95 p-3 shadow-[0_22px_60px_-20px_rgba(0,0,0,0.22)] backdrop-blur-md transition-all duration-300 dark:border-neutral-800 dark:bg-neutral-900/95">
          {previewMode ? (
            <Button
              type="button"
              variant="outline"
              disabled={startPending}
              className="h-11 rounded-2xl border border-neutral-200 bg-white px-6 text-sm font-semibold text-foreground shadow-sm hover:border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
              onClick={onExitPreview}
            >
              返回
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={refreshDisabled || scanning || startPending}
              className="h-11 rounded-2xl border border-neutral-200 bg-white px-6 text-sm font-semibold text-foreground shadow-sm hover:border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
              onClick={onRefreshScan}
            >
              选择文件
            </Button>
          )}
          <Button
            type="button"
            disabled={primaryDisabled}
            className="h-11 rounded-2xl border border-neutral-900 bg-neutral-900 px-8 text-sm font-bold text-white shadow-sm hover:bg-neutral-800 dark:border-white dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
            onClick={onStart}
          >
            {startPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            开始
          </Button>
        </FloatingWorkbenchBar>
      ) : null}
    </div>
  );
}
