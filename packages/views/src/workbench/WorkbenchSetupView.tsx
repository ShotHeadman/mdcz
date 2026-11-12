import type { MediaLibraryDto } from "@mdcz/shared/mediaLibrary";
import { maintenancePresetIdSchema } from "@mdcz/shared/serverDtos";
import type { MaintenancePresetId, MediaCandidate } from "@mdcz/shared/types";
import {
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  quietPanelSurfaceClass,
} from "@mdcz/ui";
import { ArrowDown, Check, FolderOpen, FolderOutput, Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useT } from "../i18n";
import type { PathAutocompleteResult } from "../path";
import {
  CandidateList,
  type FormatBytes,
  LibraryControl,
  PathControl,
  type WorkbenchSetupScanStatus,
} from "./WorkbenchSetupParts";

export type WorkbenchSetupMode = "scrape" | "maintenance";

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
  /** Undefined when the task writes back where files are, without a library. */
  libraries?: MediaLibraryDto[];
  libraryId?: string;
  onLibraryChange?: (libraryId: string) => void;
  onManageLibraries?: () => void;
  candidates: MediaCandidate[];
  selectedPaths: string[];
  selectedSize: number;
  totalSize: number;
  scanStatus: WorkbenchSetupScanStatus;
  scanError?: string;
  /** The listed files were scanned for different settings and no longer describe what starting would act on. */
  previewStale?: boolean;
  startPending: boolean;
  supportedExtensions: string[];
  presetId: MaintenancePresetId;
  primaryDisabled: boolean;
  onSuggestScanDir?: (path: string) => Promise<PathAutocompleteResult>;
  formatBytes: FormatBytes;
  onBrowseScanDir?: () => void;
  onScanDirChange?: (value: string) => void;
  refreshDisabled?: boolean;
  onRefreshScan: () => void;
  onPresetChange: (presetId: MaintenancePresetId) => void;
  onStart: () => void;
  onToggleCandidate: (path: string) => void;
  onSelectCandidates: (paths: string[], selected: boolean) => void;
}

const RAIL_CARD_CLASS = cn(quietPanelSurfaceClass, "rounded-quiet-lg");

function getDirBasename(path: string) {
  if (!path) return "";
  const normalized = path.replace(/[/\\]+$/, "");
  const parts = normalized.split(/[/\\]/);
  return parts[parts.length - 1] || path;
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
  libraries,
  libraryId,
  onLibraryChange,
  onManageLibraries,
  candidates,
  selectedPaths,
  selectedSize,
  totalSize,
  scanStatus,
  scanError,
  previewStale = false,
  startPending,
  supportedExtensions,
  presetId,
  primaryDisabled,
  onSuggestScanDir,
  formatBytes,
  onBrowseScanDir,
  onScanDirChange,
  refreshDisabled = false,
  onRefreshScan,
  onPresetChange,
  onStart,
  onToggleCandidate,
  onSelectCandidates,
}: WorkbenchSetupViewProps) {
  const t = useT();
  const scanning = scanStatus === "scanning";
  const recursiveId = useId();
  const scopeLabel = recursive ? t.workbench.scopeRecursive : t.workbench.scopeCurrentOnly;
  const [confirmingStart, setConfirmingStart] = useState(false);
  const startsWholeDirectory = mode === "scrape" && !previewMode;
  const library = libraries?.find((candidate) => candidate.id === libraryId);

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

  const actions = (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-border/60 pt-5">
      {previewMode ? (
        <p className="mr-auto text-xs leading-5 text-muted-foreground">
          {t.workbench.selectedFilesSummary(
            selectedPaths.length,
            formatBytes(selectedSize, { trimTrailingZeros: true }),
          )}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        disabled={startPending || (!previewMode && (refreshDisabled || scanning))}
        onClick={previewMode ? onExitPreview : onRefreshScan}
      >
        {previewMode ? t.workbench.backToConfig : t.workbench.previewFiles}
      </Button>
      <Button
        type="button"
        disabled={primaryDisabled}
        onClick={startsWholeDirectory ? () => setConfirmingStart(true) : onStart}
      >
        {startPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {mode === "scrape" ? t.workbench.startScrape : t.workbench.startMaintenance}
      </Button>
      <Dialog open={confirmingStart} onOpenChange={setConfirmingStart}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.workbench.startWholeDirectoryTitle}</DialogTitle>
            <DialogDescription>{t.workbench.startWholeDirectoryDescription(scanDir, scopeLabel)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingStart(false)}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={() => {
                setConfirmingStart(false);
                onStart();
              }}
            >
              {t.workbench.startScrape}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
        <nav
          aria-label={t.workbench.stepsNavAriaLabel}
          className="mb-6 flex shrink-0 flex-wrap justify-end gap-2 text-sm"
        >
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
            {t.workbench.step01}
          </button>
          <span
            aria-current={previewMode ? "step" : undefined}
            className={cn("px-2 py-1", previewMode ? "font-semibold" : "text-muted-foreground")}
          >
            {t.workbench.step02}
            <span className="ml-1 text-xs text-muted-foreground">{t.workbench.optional}</span>
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
                {maintenancePresetIdSchema.options.map((id) => {
                  const active = id === presetId;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={active}
                      disabled={startPending}
                      className={cn(
                        RAIL_CARD_CLASS,
                        "flex min-h-24 flex-col items-start justify-between px-4 py-4 text-left transition-all duration-300 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20",
                        active ? "border-ring/50 ring-2 ring-ring/10" : "hover:border-ring/40",
                      )}
                      onClick={() => onPresetChange(id)}
                    >
                      <div className="flex w-full items-start justify-between gap-3">
                        <div className="text-sm font-bold tracking-tight">{t.domain.maintenancePresets[id].label}</div>
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                            active ? "border-primary bg-primary text-primary-foreground" : "border-border",
                          )}
                        >
                          {active ? <Check className="h-3 w-3" /> : null}
                        </span>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-muted-foreground">
                        {t.domain.maintenancePresets[id].description}
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className={cn(quietPanelSurfaceClass, "relative min-w-0 space-y-6 rounded-quiet-xl p-6 md:p-8")}>
              <div className="space-y-6 md:space-y-8">
                <PathControl
                  label={t.workbench.scanDirLabel}
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
                      {t.workbench.includeSubdirs}
                    </label>
                  }
                  icon={<FolderOpen className="h-5 w-5" />}
                  value={scanDir}
                  error={scanDirError}
                  placeholder={configLoading ? t.workbench.loadingConfig : t.workbench.scanDirPlaceholder}
                  onBrowse={onBrowseScanDir}
                  onChange={onScanDirChange}
                  onCommit={onCommitScanDir}
                  loadSuggestions={onSuggestScanDir}
                />
                {libraries !== undefined ? (
                  <div>
                    <div className="mb-4 flex h-7 items-center pl-6" aria-hidden="true">
                      <span className="h-full border-l border-dashed border-border" />
                      <ArrowDown className="-ml-2 mt-6 h-4 w-4 rounded-full bg-surface text-muted-foreground" />
                    </div>
                    <LibraryControl
                      libraries={libraries}
                      libraryId={libraryId}
                      disabled={startPending}
                      onChange={onLibraryChange}
                      onManage={onManageLibraries}
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
                    <span>{t.workbench.scanDirLabel}</span>
                  </div>
                  <div className="truncate text-xs font-bold text-foreground" title={scanDir}>
                    {getDirBasename(scanDir)}
                  </div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground/75" title={scanDir}>
                    {scanDir}
                  </div>
                </div>

                {library ? (
                  <>
                    <div className="flex items-center gap-2 py-0.5">
                      <div className="h-px flex-1 bg-border/60" />
                      <ArrowDown className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                      <div className="h-px flex-1 bg-border/60" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground">
                        <FolderOutput className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span>{t.workbench.libraryLabel}</span>
                      </div>
                      <div className="truncate text-xs font-bold text-foreground">{library.name}</div>
                      <div
                        className="truncate font-mono text-[10px] text-muted-foreground/75"
                        title={library.outputPath}
                      >
                        {library.outputPath || t.libraries.card.noOutput}
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
                      {t.domain.maintenancePresets[presetId].label}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <CandidateList
              mode={mode}
              candidates={candidates}
              selectedPaths={selectedPaths}
              totalSize={totalSize}
              scanStatus={scanStatus}
              scanError={scanError}
              warnings={warnings}
              previewStale={previewStale}
              scanDir={scanDir}
              recursive={recursive}
              supportedExtensions={supportedExtensions}
              refreshDisabled={refreshDisabled}
              disabled={startPending}
              formatBytes={formatBytes}
              onRefresh={onRefreshScan}
              onToggle={onToggleCandidate}
              onSelect={onSelectCandidates}
              footer={actions}
            />
          </section>
        )}
      </main>
    </div>
  );
}
