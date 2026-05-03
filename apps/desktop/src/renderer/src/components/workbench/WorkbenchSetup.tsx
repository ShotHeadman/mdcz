import { toErrorMessage } from "@mdcz/shared/error";
import type { MaintenancePresetId } from "@mdcz/shared/types";
import { WorkbenchSetupView } from "@mdcz/views/workbench";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { ipc } from "@/client/ipc";
import type { ConfigOutput } from "@/client/types";
import {
  filterMediaCandidates,
  mergeMediaCandidates,
  resolveMediaCandidateScanPlan,
  type WorkbenchSetupMode,
} from "@/components/workbench/mediaCandidateScan";
import { useMaintenanceEntryStore } from "@/store/maintenanceEntryStore";
import { changeMaintenancePreset } from "@/store/maintenanceSession";
import { useWorkbenchSetupStore } from "@/store/workbenchSetupStore";
import { formatBytes } from "@/utils/format";
import { resolveSuccessTargetDir } from "./workbenchSetupPaths";

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
  const scanning = scanStatus === "scanning";
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
      formatBytes={formatBytes}
      onBrowseScanDir={handleChooseScanDir}
      onBrowseTargetDir={handleChooseTargetDir}
      onRefreshScan={() => runScan(scanDir, targetDir)}
      onPresetChange={changeMaintenancePreset}
      onStart={handleStart}
      onToggleCandidate={toggleSelectedPath}
      onToggleAll={setAllSelected}
    />
  );
}
