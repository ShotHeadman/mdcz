import { getMaintenancePresetMeta, MAINTENANCE_PRESET_OPTIONS } from "@mdcz/shared/maintenancePresets";
import type { MaintenancePresetId, MediaCandidate } from "@mdcz/shared/types";
import { Button, Checkbox, cn, quietFieldSurfaceClass, quietPanelSurfaceClass } from "@mdcz/ui";
import { AlertCircle, ArrowDown, Check, FolderOpen, FolderOutput, Loader2, Search, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { PathAutocompleteInput, type PathAutocompleteResult } from "../path";

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
  startPending: boolean;
  supportedExtensions: string[];
  presetId: MaintenancePresetId;
  primaryDisabled: boolean;
  isServer?: boolean;
  onSuggestScanDir?: (path: string) => Promise<PathAutocompleteResult>;
  onSuggestTargetDir?: (path: string) => Promise<PathAutocompleteResult>;
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
  onSelectCandidates: (paths: string[], selected: boolean) => void;
}

const RAIL_CARD_CLASS = cn(quietPanelSurfaceClass, "rounded-quiet-lg");
const MEDIA_GRID_CLASS = "grid grid-cols-[1rem_minmax(0,1fr)_3rem_4.5rem] gap-3 sm:gap-4";
const MEDIA_ROW_CLASS =
  "w-full cursor-pointer items-start border-t border-border/60 px-5 py-3.5 text-left transition-colors hover:bg-surface-low";
const MEDIA_ROW_META_CLASS = "pt-0.5 font-numeric text-xs leading-5 text-muted-foreground";

function getDirBasename(path: string) {
  if (!path) return "";
  const normalized = path.replace(/[/\\]+$/, "");
  const parts = normalized.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function PathControl({
  label,
  labelAction,
  icon,
  value,
  placeholder,
  onBrowse,
  onChange,
  onCommit,
  loadSuggestions,
  error,
  disabled,
}: {
  label: string;
  labelAction?: ReactNode;
  icon: ReactNode;
  value: string;
  placeholder: string;
  onBrowse?: () => void;
  onChange?: (value: string) => void;
  onCommit?: () => void;
  loadSuggestions?: (value: string) => Promise<PathAutocompleteResult>;
  error?: string;
  disabled: boolean;
}) {
  const inputId = useId();

  return (
    <div className="min-w-0 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor={inputId} className="text-sm font-semibold tracking-tight text-foreground">
          {label}
        </label>
        {labelAction}
      </div>
      <div
        className={cn(
          quietFieldSurfaceClass,
          "flex min-w-0 items-center rounded-quiet pl-4 transition-colors focus-within:border-ring/40 focus-within:ring-[3px] focus-within:ring-ring/15",
        )}
      >
        <span className="shrink-0 text-muted-foreground" aria-hidden="true">
          {icon}
        </span>
        <PathAutocompleteInput
          id={inputId}
          value={value}
          readOnly={!onChange}
          disabled={disabled}
          placeholder={placeholder}
          loadSuggestions={loadSuggestions}
          inputClassName="h-14 min-w-0 flex-1 truncate border-0 bg-transparent px-3 font-mono text-sm text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:ring-0"
          onChange={onChange}
          onBlur={onCommit}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.defaultPrevented && !event.nativeEvent.isComposing) onCommit?.();
          }}
        />
        {onBrowse ? (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="mr-1.5 h-10 shrink-0 rounded-quiet bg-surface px-4 text-xs font-semibold"
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
    <p role="status" className="mb-4 flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
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
    <label
      htmlFor={checkboxId}
      className={cn(MEDIA_GRID_CLASS, MEDIA_ROW_CLASS, disabled && "cursor-default opacity-60")}
    >
      <Checkbox
        id={checkboxId}
        aria-label={candidate.name}
        className="mt-0.5"
        checked={selected}
        disabled={disabled}
        onCheckedChange={onToggle}
      />
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
  targetDir,
  candidates,
  selectedPaths,
  selectedSize,
  totalSize,
  scanStatus,
  scanError,
  startPending,
  supportedExtensions,
  presetId,
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
  onSelectCandidates,
}: WorkbenchSetupViewProps) {
  const scanning = scanStatus === "scanning";
  const selectedPathSet = new Set(selectedPaths);
  const recursiveId = useId();
  const scopeLabel = recursive ? "含子目录" : "仅当前目录";
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!previewMode || !onExitPreview || startPending) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing) {
        event.preventDefault();
        onExitPreview();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewMode, onExitPreview, startPending]);

  useEffect(() => {
    if (!previewMode) setSearchQuery("");
  }, [previewMode]);

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
  const visibleSelectedCount = filteredCandidates.filter((candidate) => selectedPathSet.has(candidate.path)).length;
  const allSelected = filteredCandidates.length > 0 && visibleSelectedCount === filteredCandidates.length;
  const someSelected = visibleSelectedCount > 0 && !allSelected;
  const actions = (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-border/60 pt-5">
      <p className="mr-auto text-xs leading-5 text-muted-foreground">
        {previewMode ? (
          <>
            已选 {selectedPaths.length} 个文件 · {formatBytes(selectedSize, { trimTrailingZeros: true })}
          </>
        ) : (
          <>处理目录内全部视频 · {scopeLabel}</>
        )}
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={startPending || (!previewMode && (refreshDisabled || scanning))}
        onClick={previewMode ? onExitPreview : onRefreshScan}
      >
        {previewMode ? "返回配置" : "预览文件"}
      </Button>
      <Button type="button" disabled={primaryDisabled} onClick={onStart}>
        {startPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {mode === "scrape" ? "开始刮削" : "开始维护"}
      </Button>
    </div>
  );
  return (
    <div
      className={cn(
        "relative h-full bg-surface-canvas text-foreground",
        previewMode ? "overflow-hidden" : "overflow-y-auto",
      )}
    >
      <main
        className={cn(
          "mx-auto w-full px-5 pb-6 pt-6 md:px-10 lg:px-12 lg:pt-10",
          !previewMode && mode === "scrape" ? "max-w-3xl" : "max-w-6xl",
          previewMode && "flex h-full flex-col",
        )}
      >
        <nav aria-label="工作台步骤" className="mb-6 flex shrink-0 flex-wrap justify-end gap-2 text-sm">
          <button
            type="button"
            disabled={!previewMode || startPending}
            onClick={onExitPreview}
            aria-current={!previewMode ? "step" : undefined}
            className={cn(
              "rounded-quiet px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              !previewMode
                ? "font-semibold"
                : "text-muted-foreground enabled:cursor-pointer enabled:hover:text-foreground",
            )}
          >
            01 配置目录
          </button>
          <span
            aria-current={previewMode ? "step" : undefined}
            className={cn("px-2 py-1", previewMode ? "font-semibold" : "text-muted-foreground")}
          >
            02 预览文件<span className="ml-1 text-xs text-muted-foreground">可选</span>
          </span>
        </nav>
        {!previewMode ? (
          <section
            className={cn(
              "grid items-start gap-5 lg:gap-8",
              mode === "maintenance" && "lg:grid-cols-[13rem_minmax(0,1fr)]",
            )}
          >
            {mode === "maintenance" ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                {MAINTENANCE_PRESET_OPTIONS.map((option) => {
                  const active = option.id === presetId;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={active}
                      disabled={startPending}
                      className={cn(
                        RAIL_CARD_CLASS,
                        "flex min-h-24 flex-col items-start justify-between px-4 py-4 text-left transition-all duration-300 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20",
                        active ? "border-ring/50 ring-2 ring-ring/10" : "hover:border-ring/40",
                      )}
                      onClick={() => onPresetChange(option.id)}
                    >
                      <div className="flex w-full items-start justify-between gap-3">
                        <div className="text-sm font-bold tracking-tight">{option.label}</div>
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                            active ? "border-primary bg-primary text-primary-foreground" : "border-border",
                          )}
                        >
                          {active ? <Check className="h-3 w-3" /> : null}
                        </span>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-muted-foreground">{option.description}</p>
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className={cn(quietPanelSurfaceClass, "relative min-w-0 space-y-6 rounded-quiet-xl p-6 md:p-8")}>
              <div className="space-y-6 md:space-y-8">
                <PathControl
                  label="扫描目录"
                  disabled={startPending}
                  labelAction={
                    <label
                      htmlFor={recursiveId}
                      className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
                    >
                      <Checkbox
                        id={recursiveId}
                        checked={recursive}
                        disabled={startPending}
                        onCheckedChange={(checked) => onRecursiveChange?.(checked === true)}
                      />
                      包含子目录
                    </label>
                  }
                  icon={<FolderOpen className="h-5 w-5" />}
                  value={scanDir}
                  error={scanDirError}
                  placeholder={configLoading ? "正在读取配置..." : "请选择需要扫描的媒体目录"}
                  onBrowse={isServer ? undefined : onBrowseScanDir}
                  onChange={onScanDirChange}
                  onCommit={onCommitScanDir}
                  loadSuggestions={onSuggestScanDir}
                />
                {targetDir !== undefined ? (
                  <div>
                    <div className="mb-4 flex h-7 items-center pl-6" aria-hidden="true">
                      <span className="h-full border-l border-dashed border-border" />
                      <ArrowDown className="-ml-2 mt-6 h-4 w-4 rounded-full bg-surface text-muted-foreground" />
                    </div>
                    <PathControl
                      label="输出目录"
                      disabled={startPending}
                      icon={<FolderOutput className="h-5 w-5" />}
                      value={targetDir}
                      placeholder={configLoading ? "正在读取配置..." : "请选择输出目录"}
                      onBrowse={isServer ? undefined : onBrowseTargetDir}
                      onChange={onTargetDirChange}
                      loadSuggestions={onSuggestTargetDir}
                    />
                  </div>
                ) : null}
              </div>
              {actions}
            </div>
          </section>
        ) : (
          <section className="grid flex-1 min-h-0 grid-rows-[minmax(0,1fr)] gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
            <div className="hidden min-h-0 overflow-y-auto lg:block">
              <div className={cn(RAIL_CARD_CLASS, "flex flex-col gap-3 p-4")}>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground">
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span>扫描目录</span>
                  </div>
                  <div className="truncate text-xs font-bold text-foreground" title={scanDir}>
                    {getDirBasename(scanDir)}
                  </div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground/75" title={scanDir}>
                    {scanDir}
                  </div>
                </div>

                {targetDir !== undefined ? (
                  <>
                    <div className="flex items-center gap-2 py-0.5">
                      <div className="h-px flex-1 bg-border/60" />
                      <ArrowDown className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                      <div className="h-px flex-1 bg-border/60" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground">
                        <FolderOutput className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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

                <div className="flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
                  <span className="inline-flex items-center rounded-quiet bg-surface-low px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {scopeLabel}
                  </span>
                  {mode === "maintenance" ? (
                    <span className="inline-flex items-center rounded-quiet bg-surface-low px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {getMaintenancePresetMeta(presetId).label}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex min-h-0 min-w-0 flex-col">
              {scanning ? <ScanningStatus scopeLabel={scopeLabel} /> : null}
              {scanStatus === "success" && warnings && warnings.count > 0 ? (
                <details className="mb-4 shrink-0 rounded-quiet border border-border/60 bg-surface-low px-4 py-3 text-sm">
                  <summary className="cursor-pointer font-medium">部分路径无法访问，已跳过 {warnings.count} 项</summary>
                  <ul className="mt-2 max-h-24 space-y-1 overflow-y-auto break-all font-mono text-xs text-muted-foreground">
                    {warnings.paths.map((path) => (
                      <li key={path}>{path}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <div
                className={cn(
                  quietPanelSurfaceClass,
                  "relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-quiet-xl",
                )}
                aria-busy={scanning}
              >
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-3.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <Checkbox
                      aria-label="选择当前可见文件"
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      disabled={filteredCandidates.length === 0 || scanning || startPending}
                      onCheckedChange={() =>
                        onSelectCandidates(
                          filteredCandidates.map((candidate) => candidate.path),
                          !allSelected,
                        )
                      }
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
                  </div>

                  <div className="flex min-w-0 flex-wrap items-center gap-3">
                    <div className="relative w-44 sm:w-56">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        aria-label="搜索文件"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Escape" || !searchQuery || event.nativeEvent.isComposing) return;
                          event.preventDefault();
                          event.stopPropagation();
                          setSearchQuery("");
                        }}
                        placeholder="搜索文件..."
                        className={cn(
                          quietFieldSurfaceClass,
                          "h-8 w-full rounded-quiet pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground transition-colors focus:border-ring/40 focus:outline-none focus:ring-[3px] focus:ring-ring/15",
                        )}
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
                    <span className="text-xs text-muted-foreground">
                      总大小 {formatBytes(totalSize, { trimTrailingZeros: true })}
                    </span>
                    {searchQuery ? (
                      <span className="text-xs text-muted-foreground">显示 {filteredCandidates.length} 项</span>
                    ) : null}
                  </div>
                </div>
                <div
                  className={cn(
                    MEDIA_GRID_CLASS,
                    "shrink-0 bg-surface-low px-5 py-4 font-numeric text-[10px]/4 font-bold uppercase tracking-[0.16em] text-muted-foreground",
                  )}
                >
                  <span />
                  <span>文件</span>
                  <span>类型</span>
                  <span>大小</span>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {scanStatus === "error" ? (
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
                      <div className="text-sm font-medium">选择目录后，点击“预览文件”查看可处理的媒体文件。</div>
                    </div>
                  ) : null}

                  {scanStatus === "success" && scanDir && candidates.length === 0 ? (
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

                  {!scanning && candidates.length > 0 && filteredCandidates.length === 0 ? (
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
                <div className="shrink-0 px-5 pb-5">{actions}</div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
