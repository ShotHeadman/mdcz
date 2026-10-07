import type { Configuration } from "@mdcz/shared/config";
import type { DirectorySource } from "@mdcz/shared/directoryTasks";
import { toErrorMessage } from "@mdcz/shared/error";
import { formatBytes } from "@mdcz/shared/format";
import {
  isAbsoluteHostPath,
  normalizeComparableHostPath,
  resolveMediaCandidateScanPlan,
  type WorkbenchSetupMode,
} from "@mdcz/shared/mediaCandidate";
import type { MediaLibraryDto } from "@mdcz/shared/mediaLibrary";
import type { ServerPathSuggestResponse } from "@mdcz/shared/serverDtos";
import type { MaintenancePresetId, MediaCandidate } from "@mdcz/shared/types";
import { changeMaintenancePreset, useMaintenanceStore } from "@mdcz/views/state/maintenanceStore";
import { useWorkbenchSetupStore } from "@mdcz/views/state/workbenchSetupStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getT } from "../i18n";
import type { PathAutocompleteResult } from "../path";
import { WorkbenchSetupView } from "../workbench";

export interface CandidateScanResult {
  warnings?: { count: number; paths: string[] };
  candidates: MediaCandidate[];
  supportedExtensions: string[];
}

export interface WorkbenchSetupPort {
  browseDirectory(currentPath: string): Promise<string | null>;
  scanCandidates(
    scanDir: string,
    recursive: boolean,
    excludeDirPaths?: readonly string[],
    scanId?: string,
  ): Promise<CandidateScanResult>;
  cancelCandidates(scanId: string): Promise<void>;
  isServer?: boolean;
  suggestDirectory?: (path: string) => Promise<ServerPathSuggestResponse>;
}

/** Presets that move files organize them into a library; the others write back where the files are. */
const MOVING_PRESETS: ReadonlySet<MaintenancePresetId> = new Set(["local_organize", "rebuild_all"]);

export interface WorkbenchSetupAdapterProps {
  mode: WorkbenchSetupMode;
  config?: Configuration;
  configLoading?: boolean;
  libraries?: MediaLibraryDto[];
  port: WorkbenchSetupPort;
  onManageLibraries: () => void;
  onStartDirectory: (
    source: DirectorySource,
    libraryId: string | undefined,
    presetId: MaintenancePresetId,
  ) => Promise<void>;
  onStartScrape: (candidates: MediaCandidate[], libraryId: string) => Promise<void>;
  onStartMaintenance: (
    candidates: MediaCandidate[],
    presetId: MaintenancePresetId,
    libraryId?: string,
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
  libraries,
  port,
  onManageLibraries,
  onStartDirectory,
  onStartScrape,
  onStartMaintenance,
}: WorkbenchSetupAdapterProps) {
  const {
    scanDir,
    stopPreview,
    previewMode,
    setPreviewMode,
    recursive,
    warnings,
    setRecursive,
    libraryId,
    candidates,
    selectedPaths,
    scanStatus,
    scanError,
    committedPlanKey,
    supportedExtensions,
    setScanDir,
    setLibraryId,
    beginScan,
    applyScanResult,
    failScan,
    toggleSelectedPath,
    setPathsSelected,
  } = useWorkbenchSetupStore();
  const presetId = useMaintenanceStore((state) => state.presetId);
  const [draftDir, setDraftDir] = useState(scanDir);
  const [directoryError, setDirectoryError] = useState("");
  useEffect(() => setDraftDir(scanDir), [scanDir]);
  const scanPlan = useMemo(
    () => resolveMediaCandidateScanPlan(mode, scanDir, recursive, config),
    [mode, scanDir, recursive, config],
  );
  const scanReady = Boolean(config && !configLoading && scanDir);
  const [startPending, setStartPending] = useState(false);
  const startingRef = useRef(false);
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
  const needsLibrary = mode === "scrape" || MOVING_PRESETS.has(presetId);
  const library = libraries?.find((candidate) => candidate.id === libraryId);
  const draftDirty =
    Boolean(draftDir.trim()) !== Boolean(scanDir.trim()) ||
    normalizeComparableHostPath(draftDir) !== normalizeComparableHostPath(scanDir);
  const primaryDisabled =
    startPending ||
    !scanReady ||
    draftDirty ||
    (previewMode &&
      (committedPlanKey !== scanPlan.scanKey || scanStatus !== "success" || selectedCandidates.length === 0)) ||
    (needsLibrary && !library);
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
        const result = await port.scanCandidates(scanDir, recursive, scanPlan.excludeDirPaths, id);
        if (!isCurrentScan()) return;
        applyScanResult(scanPlan.scanKey, result.candidates, result.supportedExtensions, result.warnings);
      } catch (error) {
        if (isCurrentScan()) failScan(toErrorMessage(error));
      } finally {
        if (useWorkbenchSetupStore.getState().activePreview?.id === id)
          useWorkbenchSetupStore.setState({ activePreview: null });
      }
    })();
    useWorkbenchSetupStore.setState({
      activePreview: {
        id,
        stop: async () => {
          await port.cancelCandidates(id);
          await completion;
        },
      },
    });
    await completion;
  }, [
    applyScanResult,
    beginScan,
    failScan,
    port,
    recursive,
    scanDir,
    scanPlan,
    scanReady,
    setPreviewMode,
    stopPreview,
  ]);

  // The first library is the default target, and its directory the default scan: new videos arrive in its source,
  // while maintenance works on what it already holds.
  useEffect(() => {
    if (!libraries || initializedRef.current) return;
    const initial = libraries.find((candidate) => candidate.id === libraryId) ?? libraries[0];
    if (initial && initial.id !== libraryId) setLibraryId(initial.id);
    const defaultScanDir = initial
      ? mode === "maintenance"
        ? initial.outputPath || initial.sourcePath
        : initial.sourcePath
      : "";
    if (defaultScanDir && (!scanDir || !isAbsoluteHostPath(scanDir))) setScanDir(defaultScanDir);
    initializedRef.current = true;
  }, [libraries, libraryId, mode, scanDir, setLibraryId, setScanDir]);

  useEffect(() => {
    return () => {
      scanRequestRef.current += 1;
      void stopPreview().catch((error) => toast.error(getT().workbench.cancelScanFailed(toErrorMessage(error))));
      if (useWorkbenchSetupStore.getState().scanStatus === "scanning")
        useWorkbenchSetupStore.setState({ scanStatus: "idle" });
    };
  }, [scanPlan.scanKey, draftDir, stopPreview]);

  const handleChooseScanDir = async () => {
    try {
      const selectedPath = (await port.browseDirectory(scanDir))?.trim() ?? "";
      if (!selectedPath) {
        return;
      }
      setScanDir(selectedPath);
      setDraftDir(selectedPath);
      setDirectoryError("");
    } catch (error) {
      toast.error(getT().workbench.selectScanDirFailed(toErrorMessage(error)));
    }
  };

  const handleStart = useCallback(async () => {
    if (primaryDisabled || startingRef.current) {
      return;
    }

    startingRef.current = true;
    setStartPending(true);
    try {
      if (!previewMode) {
        if (!isAbsoluteHostPath(scanDir)) {
          setDirectoryError(getT().workbench.enterFullPath);
          return;
        }
        setDirectoryError("");
        scanRequestRef.current += 1;
        await stopPreview();
        try {
          await onStartDirectory({ kind: "directory", scanDir, recursive }, library?.id, presetId);
        } catch (error) {
          setDirectoryError(toErrorMessage(error));
        }
      } else if (mode === "maintenance") {
        await onStartMaintenance(selectedCandidates, presetId, needsLibrary ? library?.id : undefined);
      } else if (library) {
        await onStartScrape(selectedCandidates, library.id);
      }
    } finally {
      startingRef.current = false;
      setStartPending(false);
    }
  }, [
    primaryDisabled,
    previewMode,
    scanDir,
    recursive,
    stopPreview,
    onStartDirectory,
    library,
    needsLibrary,
    presetId,
    mode,
    onStartMaintenance,
    selectedCandidates,
    onStartScrape,
  ]);

  useEffect(() => {
    useWorkbenchSetupStore.setState({ startTask: handleStart });
    return () => {
      useWorkbenchSetupStore.setState({ startTask: null });
    };
  }, [handleStart]);

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
      scanDirError={directoryError}
      recursive={recursive}
      onRecursiveChange={setRecursive}
      onCommitScanDir={() => setScanDir(draftDir.trim())}
      warnings={warnings}
      libraries={needsLibrary ? (libraries ?? []) : undefined}
      libraryId={library?.id}
      onLibraryChange={setLibraryId}
      onManageLibraries={onManageLibraries}
      candidates={candidates}
      selectedPaths={selectedPaths}
      selectedSize={selectedSize}
      totalSize={totalSize}
      scanStatus={scanStatus}
      scanError={scanError}
      startPending={startPending}
      supportedExtensions={supportedExtensions}
      presetId={presetId}
      primaryDisabled={primaryDisabled}
      isServer={port.isServer}
      onSuggestScanDir={
        suggestDirectory ? async (path) => toPathAutocompleteResult(await suggestDirectory(path)) : undefined
      }
      formatBytes={formatBytes}
      onBrowseScanDir={handleChooseScanDir}
      onScanDirChange={(value) => {
        setDraftDir(value);
        setDirectoryError("");
      }}
      refreshDisabled={!scanReady || draftDirty}
      onRefreshScan={() => {
        if (!draftDirty) void runScan();
      }}
      onPresetChange={changeMaintenancePreset}
      onStart={handleStart}
      onToggleCandidate={toggleSelectedPath}
      onSelectCandidates={setPathsSelected}
    />
  );
}

export default WorkbenchSetupAdapter;
