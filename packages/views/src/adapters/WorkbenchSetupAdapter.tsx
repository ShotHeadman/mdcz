import type { Configuration } from "@mdcz/shared/config";
import type { DirectorySource } from "@mdcz/shared/directoryTasks";
import { toErrorMessage } from "@mdcz/shared/error";
import { formatBytes } from "@mdcz/shared/format";
import {
  isAbsoluteHostPath,
  mergeMediaCandidates,
  normalizeComparableHostPath,
  resolveMediaCandidateScanPlan,
  resolveSuccessTargetDir,
  type WorkbenchSetupMode,
} from "@mdcz/shared/mediaCandidate";
import type { ServerPathSuggestResponse } from "@mdcz/shared/serverDtos";
import type { MaintenancePresetId, MediaCandidate } from "@mdcz/shared/types";
import { changeMaintenancePreset, useMaintenanceStore } from "@mdcz/views/state/maintenanceStore";
import { useWorkbenchSetupStore } from "@mdcz/views/state/workbenchSetupStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { PathAutocompleteResult } from "../path";
import { WorkbenchSetupView } from "../workbench";

export interface CandidateScanResult {
  warnings?: { count: number; paths: string[] };
  candidates: MediaCandidate[];
  supportedExtensions: string[];
}

export interface WorkbenchSetupPort {
  browseDirectory(kind: "scan" | "target", currentPath: string): Promise<string | null>;
  scanCandidates(
    scanDir: string,
    recursive: boolean,
    excludeDirPaths?: readonly string[],
    scanId?: string,
  ): Promise<CandidateScanResult>;
  cancelCandidates(scanId: string): Promise<void>;
  isServer?: boolean;
  suggestDirectory?: (input: { kind: "scan" | "target"; path: string }) => Promise<ServerPathSuggestResponse>;
}

export interface WorkbenchSetupAdapterProps {
  mode: WorkbenchSetupMode;
  config?: Configuration;
  configLoading?: boolean;
  port: WorkbenchSetupPort;
  onStartDirectory: (source: DirectorySource, targetDir: string, presetId: MaintenancePresetId) => Promise<void>;
  onStartScrape: (candidates: MediaCandidate[], targetDir: string) => Promise<void>;
  onStartMaintenance: (
    candidates: MediaCandidate[],
    presetId: MaintenancePresetId,
    targetDir?: string,
  ) => Promise<void>;
}

const toPathAutocompleteResult = (result: ServerPathSuggestResponse): PathAutocompleteResult => ({
  accessible: result.accessible,
  error: result.error,
  entries: result.entries.map((entry) => ({ label: entry.label, path: entry.path })),
});

let activePreview: { id: string; port: WorkbenchSetupPort; completion: Promise<void> } | null = null;

const stopPreview = async () => {
  const current = activePreview;
  if (!current) return;
  await current.port.cancelCandidates(current.id);
  await current.completion;
};

export function WorkbenchSetupAdapter({
  mode,
  config,
  configLoading = false,
  port,
  onStartDirectory,
  onStartScrape,
  onStartMaintenance,
}: WorkbenchSetupAdapterProps) {
  const {
    scanDir,
    previewMode,
    setPreviewMode,
    recursive,
    warnings,
    setRecursive,
    targetDir,
    candidates,
    selectedPaths,
    scanStatus,
    scanError,
    committedPlanKey,
    supportedExtensions,
    setScanDir,
    setTargetDir,
    beginScan,
    applyScanResult,
    failScan,
    toggleSelectedPath,
    setAllSelected,
  } = useWorkbenchSetupStore();
  const presetId = useMaintenanceStore((state) => state.presetId);
  const [draftDir, setDraftDir] = useState(scanDir);
  useEffect(() => setDraftDir(scanDir), [scanDir]);
  const scanPlan = useMemo(
    () => resolveMediaCandidateScanPlan(mode, scanDir, recursive, config),
    [mode, scanDir, recursive, config],
  );
  const scanReady = Boolean(config && !configLoading && scanDir);
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
    () => new Set(candidates.map((candidate) => candidate.extension.replace(/^\./u, "").toLowerCase())).size,
    [candidates],
  );
  const scanning = scanStatus === "scanning";
  const needsTarget = mode === "scrape" || presetId === "organize_files" || presetId === "rebuild_all";
  const draftDirty =
    Boolean(draftDir.trim()) !== Boolean(scanDir.trim()) ||
    normalizeComparableHostPath(draftDir) !== normalizeComparableHostPath(scanDir);
  const primaryDisabled =
    startPending ||
    !scanReady ||
    draftDirty ||
    (previewMode &&
      (committedPlanKey !== scanPlan.scanKey || scanStatus !== "success" || selectedCandidates.length === 0)) ||
    (needsTarget && !targetDir.trim());
  const runSummary =
    candidates.length > 0
      ? `${candidates.length} 个文件 · ${formatBytes(totalSize, { trimTrailingZeros: true })} · ${extensionCount} 种类型 · ${
          config?.translate?.enableTranslation ? "翻译已开启" : "翻译关闭"
        }`
      : "";
  const suggestDirectory = port.suggestDirectory;

  const runScan = useCallback(async () => {
    if (!scanReady) return;
    const requestId = ++scanRequestRef.current;
    await stopPreview();
    if (requestId !== scanRequestRef.current) return;
    setPreviewMode(true);
    beginScan();
    const id = crypto.randomUUID();
    const completion = (async () => {
      const isCurrentScan = () => scanRequestRef.current === requestId;
      try {
        const results: CandidateScanResult[] = [];
        for (const directory of [scanDir, ...scanPlan.extraScanDirs]) {
          if (!isCurrentScan()) return;
          results.push(await port.scanCandidates(directory, recursive, scanPlan.excludeDirPaths, id));
        }
        if (!isCurrentScan()) return;
        applyScanResult(
          scanPlan.scanKey,
          mergeMediaCandidates(...results.map((result) => result.candidates)),
          [...new Set(results.flatMap((result) => result.supportedExtensions))],
          {
            count: results.reduce((count, result) => count + (result.warnings?.count ?? 0), 0),
            paths: results.flatMap((result) => result.warnings?.paths ?? []).slice(0, 5),
          },
        );
      } catch (error) {
        if (isCurrentScan()) failScan(toErrorMessage(error));
      } finally {
        if (activePreview?.id === id) activePreview = null;
      }
    })();
    activePreview = { id, port, completion };
    await completion;
  }, [applyScanResult, beginScan, failScan, port, recursive, scanDir, scanPlan, scanReady, setPreviewMode]);

  useEffect(() => {
    if (!config || initializedRef.current) {
      return;
    }

    const nextScanDir = config.paths?.mediaPath?.trim() ?? "";
    const nextTargetDir =
      mode === "maintenance"
        ? scanDir || nextScanDir
        : nextScanDir
          ? resolveSuccessTargetDir(nextScanDir, config.paths?.successOutputFolder)
          : "";
    if (nextScanDir && (!scanDir || !isAbsoluteHostPath(scanDir))) {
      setScanDir(nextScanDir);
    }
    if (nextTargetDir && (!targetDir || !isAbsoluteHostPath(targetDir))) {
      setTargetDir(nextTargetDir);
    }
    initializedRef.current = true;
  }, [config, mode, scanDir, setScanDir, setTargetDir, targetDir]);

  useEffect(() => {
    return () => {
      scanRequestRef.current += 1;
      void stopPreview().catch((error) => toast.error(`停止预览失败: ${toErrorMessage(error)}`));
      if (useWorkbenchSetupStore.getState().scanStatus === "scanning")
        useWorkbenchSetupStore.setState({ scanStatus: "idle" });
    };
  }, [scanPlan.scanKey, draftDir]);

  const handleChooseScanDir = async () => {
    try {
      const selectedPath = (await port.browseDirectory("scan", scanDir))?.trim() ?? "";
      if (!selectedPath) {
        return;
      }
      setScanDir(selectedPath);
      setDraftDir(selectedPath);
      if (!targetDir || !isAbsoluteHostPath(targetDir)) {
        setTargetDir(
          mode === "maintenance"
            ? selectedPath
            : resolveSuccessTargetDir(selectedPath, config?.paths?.successOutputFolder),
        );
      }
    } catch (error) {
      toast.error(`选择扫描目录失败: ${toErrorMessage(error)}`);
    }
  };

  const handleChooseTargetDir = async () => {
    try {
      const selectedPath = (await port.browseDirectory("target", targetDir))?.trim() ?? "";
      if (!selectedPath) {
        return;
      }
      setTargetDir(selectedPath);
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
      if (!previewMode) {
        scanRequestRef.current += 1;
        await stopPreview();
        await onStartDirectory({ kind: "directory", scanDir, recursive }, needsTarget ? targetDir : scanDir, presetId);
      } else if (mode === "maintenance") {
        await onStartMaintenance(selectedCandidates, presetId, needsTarget ? targetDir : undefined);
      } else {
        await onStartScrape(selectedCandidates, targetDir);
      }
    } finally {
      setStartPending(false);
    }
  };

  return (
    <WorkbenchSetupView
      mode={mode}
      previewMode={previewMode}
      onExitPreview={() => {
        scanRequestRef.current += 1;
        void stopPreview()
          .then(() => {
            setPreviewMode(false);
            useWorkbenchSetupStore.setState({ scanStatus: "idle" });
          })
          .catch((error) => toast.error(toErrorMessage(error)));
      }}
      configLoading={configLoading}
      scanDir={draftDir}
      recursive={recursive}
      onRecursiveChange={setRecursive}
      onCommitScanDir={() => {
        const nextScanDir = draftDir.trim();
        setScanDir(nextScanDir);
        if (!targetDir || !isAbsoluteHostPath(targetDir)) {
          setTargetDir(
            mode === "maintenance"
              ? nextScanDir
              : resolveSuccessTargetDir(nextScanDir, config?.paths?.successOutputFolder),
          );
        }
      }}
      extraScanDirs={scanPlan.extraScanDirs}
      warnings={warnings}
      targetDir={needsTarget ? targetDir : undefined}
      candidates={candidates}
      selectedPaths={selectedPaths}
      selectedSize={selectedSize}
      totalSize={totalSize}
      extensionCount={extensionCount}
      scanStatus={scanStatus}
      scanError={scanError}
      scanning={scanning}
      startPending={startPending}
      supportedExtensions={supportedExtensions}
      presetId={presetId}
      runSummary={runSummary}
      primaryDisabled={primaryDisabled}
      isServer={port.isServer}
      onSuggestScanDir={
        suggestDirectory
          ? async (input) => toPathAutocompleteResult(await suggestDirectory({ kind: "scan", path: input.path }))
          : undefined
      }
      onSuggestTargetDir={
        needsTarget && suggestDirectory
          ? async (input) => toPathAutocompleteResult(await suggestDirectory({ kind: "target", path: input.path }))
          : undefined
      }
      formatBytes={formatBytes}
      onBrowseScanDir={handleChooseScanDir}
      onBrowseTargetDir={needsTarget ? handleChooseTargetDir : undefined}
      onScanDirChange={(value) => {
        setDraftDir(value);
      }}
      onTargetDirChange={needsTarget ? setTargetDir : undefined}
      refreshDisabled={!scanReady || draftDirty}
      onRefreshScan={() => {
        if (!draftDirty) void runScan();
      }}
      onPresetChange={changeMaintenancePreset}
      onStart={handleStart}
      onToggleCandidate={toggleSelectedPath}
      onToggleAll={setAllSelected}
    />
  );
}

export default WorkbenchSetupAdapter;
