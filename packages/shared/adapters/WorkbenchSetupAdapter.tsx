import type { PathAutocompleteResult } from "@mdcz/views/path";
import { WorkbenchSetupView } from "@mdcz/views/workbench";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import type { Configuration } from "../config";
import { toErrorMessage } from "../error";
import { formatBytes } from "../format";
import {
  filterMediaCandidates,
  mergeMediaCandidates,
  resolveMediaCandidateScanPlan,
  resolveSuccessTargetDir,
  type WorkbenchSetupMode,
} from "../mediaCandidate";
import type { ServerPathSuggestResponse } from "../serverDtos";
import { useMaintenanceEntryStore } from "../stores/maintenanceEntryStore";
import { changeMaintenancePreset } from "../stores/maintenanceSession";
import { useWorkbenchSetupStore } from "../stores/workbenchSetupStore";
import type { MaintenancePresetId, MediaCandidate } from "../types";

export interface CandidateScanResult {
  candidates: MediaCandidate[];
  supportedExtensions: string[];
}

export interface WorkbenchSetupPort {
  browseDirectory(kind: "scan" | "target", currentPath: string): Promise<string | null>;
  scanCandidates(scanDir: string, excludeDirPath?: string): Promise<CandidateScanResult>;
  savePaths(scanDir: string, targetDir: string): Promise<void>;
  suggestDirectory?: (input: { kind: "scan" | "target"; path: string }) => Promise<ServerPathSuggestResponse>;
  supportsPathBrowse?: boolean;
}

export interface WorkbenchSetupAdapterProps {
  mode: WorkbenchSetupMode;
  config?: Configuration;
  configLoading?: boolean;
  port: WorkbenchSetupPort;
  onStartScrape: (filePaths: string[], scanDir: string, targetDir: string) => Promise<void>;
  onStartMaintenance: (
    filePaths: string[],
    scanDir: string,
    targetDir: string,
    presetId: MaintenancePresetId,
  ) => Promise<void>;
}

const toPathAutocompleteResult = (result: ServerPathSuggestResponse): PathAutocompleteResult => ({
  accessible: result.accessible,
  error: result.error,
  entries: result.entries.map((entry) => ({ label: entry.label, path: entry.path })),
});

export function WorkbenchSetupAdapter({
  mode,
  config,
  configLoading = false,
  port,
  onStartScrape,
  onStartMaintenance,
}: WorkbenchSetupAdapterProps) {
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
  const scanning = scanStatus === "scanning";
  const primaryDisabled =
    startPending || scanning || scanStatus === "error" || candidates.length === 0 || selectedPaths.length === 0;
  const runSummary =
    candidates.length > 0
      ? `${candidates.length} 个文件 · ${formatBytes(totalSize, { trimTrailingZeros: true })} · ${extensionCount} 种类型 · ${
          config?.translate?.enableTranslation ? "翻译已开启" : "翻译关闭"
        }`
      : "";
  const suggestDirectory = port.suggestDirectory;

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
          port.scanCandidates(trimmedDir, scanPlan.excludeDirPath),
          ...scanPlan.extraScanDirs.map((dirPath) => port.scanCandidates(dirPath)),
        ]);
        const nextCandidates = mergeMediaCandidates(
          filterMediaCandidates(primaryResult.candidates, scanPlan.filterDirPaths),
          ...extraResults.map((result) => filterMediaCandidates(result.candidates, scanPlan.filterDirPaths)),
        );
        const nextSupportedExtensions = [
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
        applyScanResult(trimmedDir, scanPlan.scanKey, nextCandidates, nextSupportedExtensions);
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
    [applyScanResult, beginScan, config, failScan, mode, port, targetDir],
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

  const handleChooseScanDir = async () => {
    try {
      const selectedPath = (await port.browseDirectory("scan", scanDir))?.trim() ?? "";
      if (!selectedPath) {
        return;
      }
      setScanDir(selectedPath);
      if (!targetDir) {
        setTargetDir(resolveSuccessTargetDir(selectedPath, config?.paths?.successOutputFolder));
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
      if (scanDir) {
        void runScan(scanDir, selectedPath);
      }
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
      await port.savePaths(scanDir, targetDir);
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
    <WorkbenchSetupView
      mode={mode}
      configLoading={configLoading}
      scanDir={scanDir}
      targetDir={targetDir}
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
      supportsPathBrowse={port.supportsPathBrowse}
      onSuggestScanDir={
        suggestDirectory
          ? async (input) => toPathAutocompleteResult(await suggestDirectory({ kind: "scan", path: input.path }))
          : undefined
      }
      onSuggestTargetDir={
        suggestDirectory
          ? async (input) => toPathAutocompleteResult(await suggestDirectory({ kind: "target", path: input.path }))
          : undefined
      }
      formatBytes={formatBytes}
      onBrowseScanDir={handleChooseScanDir}
      onBrowseTargetDir={handleChooseTargetDir}
      onScanDirChange={(value) => {
        setScanDir(value);
        if (!targetDir) {
          setTargetDir(resolveSuccessTargetDir(value, config?.paths?.successOutputFolder));
        }
      }}
      onTargetDirChange={setTargetDir}
      onRefreshScan={() => runScan(scanDir, targetDir)}
      onPresetChange={changeMaintenancePreset}
      onStart={handleStart}
      onToggleCandidate={toggleSelectedPath}
      onToggleAll={setAllSelected}
    />
  );
}

export default WorkbenchSetupAdapter;
