import type { WorkbenchSetupMode } from "@mdcz/shared/mediaCandidate";
import type { MediaLibraryDto } from "@mdcz/shared/mediaLibrary";
import type { MediaCandidate } from "@mdcz/shared/types";
import {
  Button,
  Checkbox,
  cn,
  quietFieldSurfaceClass,
  quietPanelSurfaceClass,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mdcz/ui";
import { AlertCircle, FolderOpen, Loader2, RefreshCw, Search, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { useT } from "../i18n";
import { PathAutocompleteInput, type PathAutocompleteResult } from "../path";

export type WorkbenchSetupScanStatus = "idle" | "scanning" | "success" | "error";
export type FormatBytes = (value: number, options?: { trimTrailingZeros?: boolean }) => string;

const MEDIA_GRID_CLASS = "grid grid-cols-[1rem_minmax(0,1fr)_3rem_4.5rem] gap-3 sm:gap-4";
const MEDIA_ROW_CLASS =
  "w-full cursor-pointer items-start border-t border-border/60 px-5 py-3.5 text-left transition-colors hover:bg-surface-low";
const MEDIA_ROW_META_CLASS = "pt-0.5 font-numeric text-xs leading-5 text-muted-foreground";

export function PathControl({
  id,
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
  /** Set when a label elsewhere names the input; the control then draws no label of its own. */
  id?: string;
  label?: string;
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
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="min-w-0 space-y-2.5">
      {label || labelAction ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label htmlFor={inputId} className="text-sm font-semibold tracking-tight text-foreground">
            {label}
          </label>
          {labelAction}
        </div>
      ) : null}
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
            {useT().workbench.browse}
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
  const t = useT();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <p role="status" className="mb-4 flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {t.workbench.scanningStatus(scopeLabel, elapsedSeconds)}
    </p>
  );
}

function MediaRow({
  candidate,
  selected,
  disabled,
  formatBytes,
  inLibraryLabel,
  onToggle,
}: {
  candidate: MediaCandidate;
  selected: boolean;
  disabled: boolean;
  formatBytes: FormatBytes;
  inLibraryLabel: string;
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
        <div className="truncate text-sm font-bold leading-5 tracking-tight text-foreground">
          {candidate.name}
          {candidate.inLibrary ? (
            <span className="ml-2 text-[10px] font-normal text-muted-foreground">{inLibraryLabel}</span>
          ) : null}
        </div>
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

export function LibraryControl({
  libraries,
  libraryId,
  disabled,
  onChange,
  onManage,
}: {
  libraries: MediaLibraryDto[];
  libraryId?: string;
  disabled: boolean;
  onChange?: (libraryId: string) => void;
  onManage?: () => void;
}) {
  const t = useT();
  const selectId = useId();
  const library = libraries.find((candidate) => candidate.id === libraryId);
  const manage = onManage ? (
    <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={onManage}>
      {t.workbench.manageLibraries}
    </Button>
  ) : null;

  if (libraries.length === 0) {
    return (
      <div className="space-y-2.5">
        <div className="text-sm font-semibold tracking-tight text-foreground">{t.workbench.libraryLabel}</div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-quiet border border-dashed border-border/70 px-4 py-3 text-sm text-muted-foreground">
          <span>{t.workbench.noLibraries}</span>
          {onManage ? (
            <Button type="button" size="sm" onClick={onManage}>
              {t.workbench.createLibrary}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor={selectId} className="text-sm font-semibold tracking-tight text-foreground">
          {t.workbench.libraryLabel}
        </label>
        {manage}
      </div>
      <Select value={libraryId ?? ""} onValueChange={(value) => onChange?.(value)} disabled={disabled}>
        <SelectTrigger id={selectId} className="w-full">
          <SelectValue placeholder={t.workbench.libraryPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {libraries.map((candidate) => (
            <SelectItem key={candidate.id} value={candidate.id}>
              {candidate.name} · {t.libraries.placements[candidate.placement].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {library ? (
        <div className="truncate pl-1 font-mono text-[11px] text-muted-foreground" title={library.outputPath}>
          {library.outputPath || t.libraries.card.noOutput}
        </div>
      ) : null}
    </div>
  );
}

export interface CandidateListProps {
  mode: WorkbenchSetupMode;
  candidates: MediaCandidate[];
  selectedPaths: string[];
  totalSize: number;
  scanStatus: WorkbenchSetupScanStatus;
  scanError?: string;
  warnings?: { count: number; paths: string[] };
  /** The listed files were scanned for different settings and no longer describe what starting would act on. */
  previewStale: boolean;
  scanDir: string;
  recursive: boolean;
  supportedExtensions: string[];
  refreshDisabled: boolean;
  disabled: boolean;
  formatBytes: FormatBytes;
  onRefresh: () => void;
  onToggle: (path: string) => void;
  onSelect: (paths: string[], selected: boolean) => void;
  footer?: ReactNode;
  /** Drawn inside another outline, so the list adds no border of its own. */
  bare?: boolean;
  className?: string;
}

/** The dry run's file list: what a start would act on, with a tick per file. */
export function CandidateList({
  mode,
  candidates,
  selectedPaths,
  totalSize,
  scanStatus,
  scanError,
  warnings,
  previewStale,
  scanDir,
  recursive,
  supportedExtensions,
  refreshDisabled,
  disabled,
  formatBytes,
  onRefresh,
  onToggle,
  onSelect,
  footer,
  bare = false,
  className,
}: CandidateListProps) {
  const t = useT();
  const scanning = scanStatus === "scanning";
  const scopeLabel = recursive ? t.workbench.scopeRecursive : t.workbench.scopeCurrentOnly;
  const selectedPathSet = new Set(selectedPaths);
  const [searchQuery, setSearchQuery] = useState("");
  const filteredCandidates = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const matches = query
      ? candidates.filter(
          (candidate) =>
            candidate.name.toLowerCase().includes(query) ||
            candidate.ref.relativePath.toLowerCase().includes(query) ||
            candidate.extension.toLowerCase().includes(query),
        )
      : candidates;
    // Maintenance acts on library movies, so only a scrape lists the files it still has to do first.
    return mode === "scrape"
      ? matches.toSorted((left, right) => Number(left.inLibrary) - Number(right.inLibrary))
      : matches;
  }, [candidates, mode, searchQuery]);
  const visibleSelectedCount = filteredCandidates.filter((candidate) => selectedPathSet.has(candidate.path)).length;
  const allSelected = filteredCandidates.length > 0 && visibleSelectedCount === filteredCandidates.length;
  const someSelected = visibleSelectedCount > 0 && !allSelected;

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col", className)}>
      {scanning ? <ScanningStatus scopeLabel={scopeLabel} /> : null}
      {scanStatus === "success" && warnings && warnings.count > 0 ? (
        <details className="mb-4 shrink-0 rounded-quiet border border-border/60 bg-surface-low px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">
            {t.workbench.inaccessiblePathsWarning(warnings.count)}
          </summary>
          <ul className="mt-2 max-h-24 space-y-1 overflow-y-auto break-all font-mono text-xs text-muted-foreground">
            {warnings.paths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div
        className={cn(
          "relative flex min-h-0 flex-1 flex-col overflow-hidden",
          bare ? "border-t border-border/60" : cn(quietPanelSurfaceClass, "rounded-quiet-xl"),
        )}
        aria-busy={scanning}
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <Checkbox
              aria-label={t.workbench.selectVisibleFilesAriaLabel}
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              disabled={filteredCandidates.length === 0 || scanning || disabled}
              onCheckedChange={() =>
                onSelect(
                  filteredCandidates.map((candidate) => candidate.path),
                  !allSelected,
                )
              }
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={refreshDisabled || scanning || disabled}
              onClick={onRefresh}
            >
              {t.workbench.refreshFiles}
            </Button>
            <span className="font-numeric text-xs font-semibold text-foreground">
              {t.workbench.selectedOfTotalFiles(selectedPaths.length, candidates.length)}
            </span>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="relative w-44 sm:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                aria-label={t.workbench.searchFilesAriaLabel}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape" || !searchQuery || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setSearchQuery("");
                }}
                placeholder={t.workbench.searchFilesPlaceholder}
                className={cn(
                  quietFieldSurfaceClass,
                  "h-8 w-full rounded-quiet pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground transition-colors focus:border-ring/40 focus:outline-none focus:ring-[3px] focus:ring-ring/15",
                )}
              />
              {searchQuery ? (
                <button
                  type="button"
                  aria-label={t.workbench.clearSearchAriaLabel}
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <span className="text-xs text-muted-foreground">
              {t.workbench.totalSize(formatBytes(totalSize, { trimTrailingZeros: true }))}
            </span>
            {searchQuery ? (
              <span className="text-xs text-muted-foreground">
                {t.workbench.showingItems(filteredCandidates.length)}
              </span>
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
          <span>{t.workbench.colFile}</span>
          <span>{t.workbench.colType}</span>
          <span>{t.workbench.colSize}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {scanStatus === "error" ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-4 px-6 text-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <div>
                <div className="font-semibold">{t.workbench.scanFailed}</div>
                <div className="mt-2 max-w-xl wrap-break-word text-sm text-muted-foreground">{scanError}</div>
              </div>
            </div>
          ) : null}

          {previewStale && scanDir ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
              <RefreshCw className="h-8 w-8" />
              <div className="text-sm font-medium">{t.workbench.previewStale}</div>
              <Button type="button" size="sm" disabled={refreshDisabled || disabled} onClick={onRefresh}>
                {t.workbench.refreshFiles}
              </Button>
            </div>
          ) : null}

          {!scanning && scanStatus !== "error" && !scanDir ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
              <FolderOpen className="h-8 w-8" />
              <div className="text-sm font-medium">{t.workbench.previewHint}</div>
            </div>
          ) : null}

          {scanStatus === "success" && scanDir && candidates.length === 0 && !previewStale ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
              <FolderOpen className="h-8 w-8" />
              <div className="text-sm font-medium">
                {recursive ? t.workbench.noVideosFoundRecursive : t.workbench.noVideosFoundCurrent}
              </div>
              <div className="max-w-xl break-all font-mono text-xs">{scanDir}</div>
              {supportedExtensions.length > 0 ? (
                <div className="text-xs">{t.workbench.supportedTypes(supportedExtensions.join(", "))}</div>
              ) : null}
            </div>
          ) : null}

          {(previewStale ? [] : filteredCandidates).map((candidate) => (
            <MediaRow
              key={candidate.path}
              candidate={candidate}
              selected={selectedPathSet.has(candidate.path)}
              disabled={disabled || scanning}
              formatBytes={formatBytes}
              inLibraryLabel={t.workbench.alreadyInLibrary}
              onToggle={() => onToggle(candidate.path)}
            />
          ))}

          {!scanning && candidates.length > 0 && filteredCandidates.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
              <Search className="h-7 w-7 text-muted-foreground/40" />
              <div className="text-sm font-medium">{t.workbench.noFilesMatching(searchQuery)}</div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-full text-xs"
                onClick={() => setSearchQuery("")}
              >
                {t.workbench.clearSearch}
              </Button>
            </div>
          ) : null}
        </div>
        <div className="shrink-0 px-5 pb-5">{footer}</div>
      </div>
    </div>
  );
}
