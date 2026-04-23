import { toErrorMessage } from "@shared/error";
import type { MaintenancePresetId, MediaCandidate } from "@shared/types";
import { AlertCircle, Check, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { ipc } from "@/client/ipc";
import type { ConfigOutput } from "@/client/types";
import { getMaintenancePresetMeta, MAINTENANCE_PRESET_OPTIONS } from "@/components/maintenance/presetMeta";
import { FloatingWorkbenchBar } from "@/components/shared/FloatingWorkbenchBar";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  filterMediaCandidates,
  mergeMediaCandidates,
  resolveMediaCandidateScanPlan,
  type WorkbenchSetupMode,
} from "@/components/workbench/mediaCandidateScan";
import { cn } from "@/lib/utils";
import { useMaintenanceEntryStore } from "@/store/maintenanceEntryStore";
import { changeMaintenancePreset } from "@/store/maintenanceSession";
import { useWorkbenchSetupStore } from "@/store/workbenchSetupStore";
import { formatBytes } from "@/utils/format";

interface WorkbenchSetupProps {
  mode: WorkbenchSetupMode;
  config?: ConfigOutput;
  configLoading?: boolean;
  onStartScrape: (filePaths: string[], scanDir: string, targetDir: string) => Promise<void>;
  onStartMaintenance: (
    filePaths: string[],
    scanDir: string,
    targetDir: string,
    presetId: MaintenancePresetId,
  ) => Promise<void>;
}

const isAbsolutePath = (path: string): boolean => path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path);

const joinPath = (base: string, child: string): string => {
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/u, "")}${separator}${child.replace(/^[\\/]+/u, "")}`;
};

const resolveSuccessTargetDir = (scanDir: string, successOutputFolder: string | undefined): string => {
  const target = successOutputFolder?.trim() ?? "";
  if (!target) {
    return "";
  }
  if (isAbsolutePath(target) || !scanDir.trim()) {
    return target;
  }
  return joinPath(scanDir, target);
};

function SectionLabel({ children, className }: { children: string; className?: string }) {
  return (
    <h2
      className={cn(
        "mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground",
        className,
      )}
    >
      <span className="h-2 w-2 rounded-full bg-foreground" />
      {children}
    </h2>
  );
}

function PathControl({
  label,
  value,
  placeholder,
  onBrowse,
}: {
  label: string;
  value: string;
  placeholder: string;
  onBrowse: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1 rounded-quiet-sm bg-surface-low px-4 py-3 font-mono text-xs text-foreground/90">
          <div className="truncate">{value || placeholder}</div>
        </div>
        <Button type="button" className="h-11 rounded-quiet-sm px-4 text-xs font-bold" onClick={onBrowse}>
          浏览
        </Button>
      </div>
    </div>
  );
}

const MEDIA_GRID_CLASS = "grid grid-cols-[auto_minmax(0,1fr)_84px_76px] gap-4";
const MEDIA_ROW_CLASS =
  "w-full cursor-pointer items-start px-4 py-3 text-left transition-colors hover:bg-surface-low/70";
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

function MediaRow({
  candidate,
  selected,
  disabled,
  onToggle,
}: {
  candidate: MediaCandidate;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const checkboxId = useId();

  return (
    <div className={cn(MEDIA_GRID_CLASS, MEDIA_ROW_CLASS)}>
      <Checkbox id={checkboxId} className="mt-0.5" checked={selected} disabled={disabled} onCheckedChange={onToggle} />
      <label htmlFor={checkboxId} className="contents">
        <div className="min-w-0 space-y-0.5">
          <div className="truncate text-sm font-bold leading-5 tracking-tight text-foreground">{candidate.name}</div>
          <div className="truncate font-mono text-[10px]/4 text-muted-foreground">
            {candidate.relativeDirectory || "."}
          </div>
        </div>
        <div className={cn(MEDIA_ROW_META_CLASS, "font-bold uppercase")}>{candidate.extension}</div>
        <div className={MEDIA_ROW_META_CLASS}>{formatBytes(candidate.size, { trimTrailingZeros: true })}</div>
      </label>
    </div>
  );
}

export default function WorkbenchSetup({
  mode,
  config,
  configLoading = false,
  onStartScrape,
  onStartMaintenance,
}: WorkbenchSetupProps) {
  const {
    scanDir,
    targetDir,
    candidates,
    selectedPaths,
    scanStatus,
    scanError,
    lastScannedDir,
    lastScannedExcludeDir,
    supportedExtensions,
    setScanDir,
    setTargetDir,
    beginScan,
    applyScanResult,
    failScan,
    toggleSelectedPath,
    setAllSelected,
  } = useWorkbenchSetupStore(
    useShallow((state) => ({
      scanDir: state.scanDir,
      targetDir: state.targetDir,
      candidates: state.candidates,
      selectedPaths: state.selectedPaths,
      scanStatus: state.scanStatus,
      scanError: state.scanError,
      lastScannedDir: state.lastScannedDir,
      lastScannedExcludeDir: state.lastScannedExcludeDir,
      supportedExtensions: state.supportedExtensions,
      setScanDir: state.setScanDir,
      setTargetDir: state.setTargetDir,
      beginScan: state.beginScan,
      applyScanResult: state.applyScanResult,
      failScan: state.failScan,
      toggleSelectedPath: state.toggleSelectedPath,
      setAllSelected: state.setAllSelected,
    })),
  );
  const presetId = useMaintenanceEntryStore((state) => state.presetId);
  const [startPending, setStartPending] = useState(false);
  const scanRequestRef = useRef(0);
  const initializedRef = useRef(false);

  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const selectedCandidates = useMemo(
    () => candidates.filter((candidate) => selectedPathSet.has(candidate.path)),
    [candidates, selectedPathSet],
  );
  const totalSize = useMemo(() => candidates.reduce((sum, candidate) => sum + candidate.size, 0), [candidates]);
  const selectedSize = useMemo(
    () => selectedCandidates.reduce((sum, candidate) => sum + candidate.size, 0),
    [selectedCandidates],
  );
  const extensionCount = useMemo(
    () => new Set(candidates.map((candidate) => candidate.extension.toLowerCase())).size,
    [candidates],
  );
  const allSelected = candidates.length > 0 && selectedPaths.length === candidates.length;
  const someSelected = selectedPaths.length > 0 && selectedPaths.length < candidates.length;
  const scanning = scanStatus === "scanning";
  const showScanFeedback = useDelayedFlag(scanning, SCAN_FEEDBACK_DELAY_MS);
  const primaryDisabled =
    startPending || scanning || scanStatus === "error" || candidates.length === 0 || selectedPaths.length === 0;
  const runSummary =
    candidates.length > 0
      ? `${candidates.length} 个文件 · ${formatBytes(totalSize, { trimTrailingZeros: true })} · ${extensionCount} 种类型 · ${
          config?.translate?.enableTranslation ? "翻译已开启" : "翻译关闭"
        }`
      : "";

  const runScan = useCallback(
    async (dirPath: string, nextTargetDir?: string) => {
      const trimmedDir = dirPath.trim();
      if (!trimmedDir) {
        return;
      }

      const targetDirForScan = nextTargetDir ?? targetDir;
      const scanPlan = resolveMediaCandidateScanPlan(mode, trimmedDir, targetDirForScan, config);

      const requestId = scanRequestRef.current + 1;
      scanRequestRef.current = requestId;
      beginScan(trimmedDir, scanPlan.scanKey);

      try {
        const [primaryResult, ...extraResults] = await Promise.all([
          ipc.file.listMediaCandidates(trimmedDir, scanPlan.excludeDirPath),
          ...scanPlan.extraScanDirs.map((dirPath) => ipc.file.listMediaCandidates(dirPath)),
        ]);
        const candidates = mergeMediaCandidates(
          filterMediaCandidates(primaryResult.candidates, scanPlan.filterDirPaths),
          ...extraResults.map((result) => filterMediaCandidates(result.candidates, scanPlan.filterDirPaths)),
        );
        const supportedExtensions = [
          ...new Set(
            [primaryResult.supportedExtensions, ...extraResults.map((result) => result.supportedExtensions)].flat(),
          ),
        ];
        const liveState = useWorkbenchSetupStore.getState();
        if (
          scanRequestRef.current !== requestId ||
          liveState.scanDir !== trimmedDir ||
          liveState.lastScannedExcludeDir !== scanPlan.scanKey
        ) {
          return;
        }
        applyScanResult(trimmedDir, scanPlan.scanKey, candidates, supportedExtensions);
      } catch (error) {
        const liveState = useWorkbenchSetupStore.getState();
        if (
          scanRequestRef.current !== requestId ||
          liveState.scanDir !== trimmedDir ||
          liveState.lastScannedExcludeDir !== scanPlan.scanKey
        ) {
          return;
        }
        failScan(trimmedDir, scanPlan.scanKey, toErrorMessage(error));
      }
    },
    [applyScanResult, beginScan, config, failScan, mode, targetDir],
  );

  useEffect(() => {
    if (!config || initializedRef.current) {
      return;
    }

    const nextScanDir = config.paths?.mediaPath?.trim() ?? "";
    const nextTargetDir = resolveSuccessTargetDir(nextScanDir, config.paths?.successOutputFolder);
    if (nextScanDir && !scanDir) {
      setScanDir(nextScanDir);
    }
    if (nextTargetDir && !targetDir) {
      setTargetDir(nextTargetDir);
    }
    initializedRef.current = true;
  }, [config, scanDir, setScanDir, setTargetDir, targetDir]);

  useEffect(() => {
    const expectedExcludeDir = resolveMediaCandidateScanPlan(mode, scanDir, targetDir, config).scanKey;

    if (!scanDir || (lastScannedDir === scanDir && lastScannedExcludeDir === expectedExcludeDir)) {
      return;
    }

    void runScan(scanDir, targetDir);
  }, [config, lastScannedDir, lastScannedExcludeDir, mode, runScan, scanDir, targetDir]);

  const chooseDirectory = async (onChoose: (path: string) => void) => {
    const selection = await ipc.file.browse("directory");
    const selectedPath = selection.paths?.[0]?.trim() ?? "";
    if (!selectedPath) {
      return;
    }
    onChoose(selectedPath);
  };

  const handleChooseScanDir = async () => {
    try {
      await chooseDirectory((selectedPath) => {
        setScanDir(selectedPath);
        if (!targetDir) {
          setTargetDir(resolveSuccessTargetDir(selectedPath, config?.paths?.successOutputFolder));
        }
      });
    } catch (error) {
      toast.error(`选择扫描目录失败: ${toErrorMessage(error)}`);
    }
  };

  const handleChooseTargetDir = async () => {
    try {
      await chooseDirectory((selectedPath) => {
        setTargetDir(selectedPath);
        if (scanDir) {
          void runScan(scanDir, selectedPath);
        }
      });
    } catch (error) {
      toast.error(`选择目标目录失败: ${toErrorMessage(error)}`);
    }
  };

  const handleStart = async () => {
    if (primaryDisabled) {
      return;
    }

    setStartPending(true);
    try {
      if (mode === "maintenance") {
        await onStartMaintenance(selectedPaths, scanDir, targetDir, presetId);
      } else {
        await onStartScrape(selectedPaths, scanDir, targetDir);
      }
    } finally {
      setStartPending(false);
    }
  };

  return (
    <div className="relative h-full overflow-hidden bg-surface-canvas text-foreground">
      <div className="h-full overflow-y-auto">
        <main className="mx-auto w-full max-w-6xl px-6 pb-36 pt-10 md:px-10 lg:px-12">
          <section className="mb-10">
            <SectionLabel>源目录设置</SectionLabel>
            <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
              <PathControl
                label="扫描目录"
                value={scanDir}
                placeholder={configLoading ? "正在读取配置..." : "请选择需要扫描的媒体目录"}
                onBrowse={handleChooseScanDir}
              />
              <PathControl
                label="成功输出目录"
                value={targetDir}
                placeholder={configLoading ? "正在读取配置..." : "请选择成功输出目录"}
                onBrowse={handleChooseTargetDir}
              />
            </div>
          </section>

          {mode === "maintenance" && (
            <section className="mb-10">
              <SectionLabel>维护预设</SectionLabel>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {MAINTENANCE_PRESET_OPTIONS.map((option) => {
                  const active = option.id === presetId;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={cn(
                        "flex min-h-24 flex-col items-start justify-between rounded-quiet-sm bg-surface-floating px-4 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                        active ? "ring-1 ring-foreground/25" : "hover:bg-surface-low",
                      )}
                      onClick={() => changeMaintenancePreset(option.id)}
                    >
                      <div className="flex w-full items-start justify-between gap-3">
                        <div className="text-sm font-bold tracking-tight">{option.label}</div>
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                            active ? "border-foreground bg-foreground text-background" : "border-muted-foreground/30",
                          )}
                        >
                          {active && <Check className="h-3 w-3" />}
                        </span>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-muted-foreground">
                        {getMaintenancePresetMeta(option.id).description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  disabled={candidates.length === 0 || scanning}
                  onCheckedChange={() => setAllSelected(!allSelected)}
                />
                <SectionLabel className="mb-0">目录文件</SectionLabel>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {runSummary && <span>{runSummary}</span>}
                {scanDir && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-quiet-sm"
                    disabled={scanning}
                    onClick={() => runScan(scanDir, targetDir)}
                  >
                    <RefreshCw className={cn("h-4 w-4", scanning && "animate-spin")} />
                    重新扫描
                  </Button>
                )}
              </div>
            </div>

            <div className="relative overflow-hidden rounded-quiet bg-surface-floating" aria-busy={scanning}>
              <div
                className={cn(
                  MEDIA_GRID_CLASS,
                  "px-4 py-3 font-numeric text-[10px]/4 font-bold uppercase tracking-[0.16em] text-muted-foreground",
                )}
              >
                <span />
                <span>文件</span>
                <span>类型</span>
                <span>大小</span>
              </div>

              {scanning && candidates.length === 0 && !showScanFeedback && <div className="min-h-64" />}

              {scanning && candidates.length === 0 && showScanFeedback && (
                <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <div className="text-sm font-medium">正在递归扫描媒体文件</div>
                  <div className="max-w-md break-all font-mono text-xs">{scanDir}</div>
                </div>
              )}

              {scanning && candidates.length > 0 && showScanFeedback && (
                <div className="pointer-events-none absolute inset-x-4 top-12 z-10 flex justify-center">
                  <div className="flex items-center gap-2 rounded-quiet-capsule bg-surface-floating/95 px-3 py-2 text-xs font-medium text-muted-foreground shadow-[0_12px_32px_-24px_rgba(0,0,0,0.5)] ring-1 ring-border/45 backdrop-blur">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    正在刷新目录
                  </div>
                </div>
              )}

              {scanStatus === "error" && !scanning && (
                <div className="flex min-h-64 flex-col items-center justify-center gap-4 px-6 text-center">
                  <AlertCircle className="h-8 w-8 text-destructive" />
                  <div>
                    <div className="font-semibold">扫描失败</div>
                    <div className="mt-2 max-w-xl wrap-break-word text-sm text-muted-foreground">{scanError}</div>
                  </div>
                </div>
              )}

              {!scanning && scanStatus !== "error" && !scanDir && (
                <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
                  <FolderOpen className="h-8 w-8" />
                  <div className="text-sm font-medium">选择扫描目录后，会在这里列出可处理的媒体文件。</div>
                </div>
              )}

              {!scanning && scanStatus === "success" && scanDir && candidates.length === 0 && (
                <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
                  <FolderOpen className="h-8 w-8" />
                  <div className="text-sm font-medium">未找到支持的媒体文件</div>
                  <div className="max-w-xl break-all font-mono text-xs">{scanDir}</div>
                  {supportedExtensions.length > 0 && (
                    <div className="text-xs">支持类型: {supportedExtensions.join(", ")}</div>
                  )}
                </div>
              )}

              {candidates.length > 0 && (
                <div className={cn("max-h-[48vh] overflow-y-auto transition-opacity", scanning && "opacity-55")}>
                  {candidates.map((candidate) => (
                    <MediaRow
                      key={candidate.path}
                      candidate={candidate}
                      selected={selectedPathSet.has(candidate.path)}
                      disabled={startPending || scanning}
                      onToggle={() => toggleSelectedPath(candidate.path)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>
      </div>

      {scanDir && (
        <FloatingWorkbenchBar contentClassName="mx-auto flex w-fit max-w-[min(92vw,26rem)] items-center justify-between gap-3 px-3 py-2.5 md:max-w-[26rem] md:px-4">
          <div className="min-w-0 font-numeric text-sm font-extrabold tracking-tight">
            {selectedPaths.length} / {candidates.length} 个文件
            {selectedSize > 0 && (
              <span className="ml-2 text-xs font-bold text-muted-foreground">
                {formatBytes(selectedSize, { trimTrailingZeros: true })}
              </span>
            )}
          </div>
          <Button
            type="button"
            disabled={primaryDisabled}
            className="h-10 shrink-0 rounded-quiet-capsule px-5 text-sm font-bold"
            onClick={handleStart}
          >
            {startPending && <Loader2 className="h-4 w-4 animate-spin" />}
            开始
          </Button>
        </FloatingWorkbenchBar>
      )}
    </div>
  );
}
