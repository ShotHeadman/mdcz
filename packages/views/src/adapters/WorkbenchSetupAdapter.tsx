import type { Configuration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import { formatBytes } from "@mdcz/shared/format";
import {
  mergeMediaCandidates,
  resolveMediaCandidateScanPlan,
  resolveSuccessTargetDir,
  type WorkbenchSetupMode,
} from "@mdcz/shared/mediaCandidate";
import type { ServerPathSuggestResponse } from "@mdcz/shared/serverDtos";
import type { MaintenancePresetId, MediaCandidate } from "@mdcz/shared/types";
import { useMaintenanceEntryStore } from "@mdcz/views/state/maintenanceEntryStore";
import { changeMaintenancePreset } from "@mdcz/views/state/maintenanceSession";
import { useWorkbenchSetupStore } from "@mdcz/views/state/workbenchSetupStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import type { PathAutocompleteResult } from "../path";
import { WorkbenchSetupView } from "../workbench";

export interface CandidateScanResult {
  candidates: MediaCandidate[];
  supportedExtensions: string[];
}

export interface WorkbenchSetupPort {
  browseDirectory(kind: "scan" | "target", currentPath: string): Promise<string | null>;
  scanCandidates(scanDir: string, excludeDirPaths?: readonly string[]): Promise<CandidateScanResult>;
  savePaths(scanDir: string, targetDir: string): Promise<void>;
  isServer?: boolean;
  suggestDirectory?: (input: { kind: "scan" | "target"; path: string }) => Promise<ServerPathSuggestResponse>;
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
    lastScannedPlanKey,
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
      lastScannedPlanKey: state.lastScannedPlanKey,
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
    async (dirPath: string) => {
      const trimmedDir = dirPath.trim();
      if (!trimmedDir) {
        return;
      }

      const scanPlan = resolveMediaCandidateScanPlan(mode, trimmedDir, config);
      const requestId = scanRequestRef.current + 1;
      scanRequestRef.current = requestId;
      beginScan(trimmedDir, scanPlan.scanKey);

      try {
        const [primaryResult, ...extraResults] = await Promise.all([
          port.scanCandidates(trimmedDir, scanPlan.excludeDirPaths),
          ...scanPlan.extraScanDirs.map((dirPath) => port.scanCandidates(dirPath, scanPlan.excludeDirPaths)),
        ]);
        const nextCandidates = mergeMediaCandidates(
          primaryResult.candidates,
          ...extraResults.map((result) => result.candidates),
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
          liveState.lastScannedPlanKey !== scanPlan.scanKey
        ) {
          return;
        }
        applyScanResult(trimmedDir, scanPlan.scanKey, nextCandidates, nextSupportedExtensions);
      } catch (error) {
        const liveState = useWorkbenchSetupStore.getState();
        if (
          scanRequestRef.current !== requestId ||
          liveState.scanDir !== trimmedDir ||
          liveState.lastScannedPlanKey !== scanPlan.scanKey
        ) {
          return;
        }
        failScan(trimmedDir, scanPlan.scanKey, toErrorMessage(error));
      }
    },
    [applyScanResult, beginScan, config, failScan, mode, port],
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
    const expectedPlanKey = resolveMediaCandidateScanPlan(mode, scanDir, config).scanKey;

    if (!scanDir || (lastScannedDir === scanDir && lastScannedPlanKey === expectedPlanKey)) {
      return;
    }

    void runScan(scanDir);
  }, [config, lastScannedDir, lastScannedPlanKey, mode, runScan, scanDir]);

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
      isServer={port.isServer}
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
      onRefreshScan={() => runScan(scanDir)}
      onPresetChange={changeMaintenancePreset}
      onStart={handleStart}
      onToggleCandidate={toggleSelectedPath}
      onToggleAll={setAllSelected}
    />
  );
}

export default WorkbenchSetupAdapter;
