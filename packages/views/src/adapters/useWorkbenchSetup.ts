import type { Configuration } from "@mdcz/shared/config";
import type { DirectorySource } from "@mdcz/shared/directoryTasks";
import { toErrorMessage } from "@mdcz/shared/error";
import {
  isAbsoluteHostPath,
  normalizeComparableHostPath,
  resolveMediaCandidateScanPlan,
  type WorkbenchSetupMode,
} from "@mdcz/shared/mediaCandidate";
import type { MediaLibraryDto } from "@mdcz/shared/mediaLibrary";
import type { ServerPathSuggestResponse } from "@mdcz/shared/serverDtos";
import type { MaintenancePresetId, MediaCandidate } from "@mdcz/shared/types";
import { randomId } from "@mdcz/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getT } from "../i18n";
import type { PathAutocompleteResult } from "../path";
import type { WorkbenchSetupStore } from "../state/workbenchSetupStore";

export interface CandidateScanResult {
  warnings?: { count: number; paths: string[] };
  candidates: MediaCandidate[];
  supportedExtensions: string[];
}

export interface WorkbenchSetupPort {
  /** A native picker; only the desktop app has one. */
  browseDirectory?: () => Promise<string | null>;
  scanCandidates(
    scanDir: string,
    recursive: boolean,
    excludeDirPaths?: readonly string[],
    scanId?: string,
  ): Promise<CandidateScanResult>;
  cancelCandidates(scanId: string): Promise<void>;
  suggestDirectory?: (path: string) => Promise<ServerPathSuggestResponse>;
}

/** Presets that move files organize them into a library; the others write back where the files are. */
const MOVING_PRESETS: ReadonlySet<MaintenancePresetId> = new Set(["local_organize", "rebuild_all"]);

export interface WorkbenchSetupOptions {
  mode: WorkbenchSetupMode;
  config?: Configuration;
  configLoading?: boolean;
  libraries?: MediaLibraryDto[];
  presetId: MaintenancePresetId;
  port: WorkbenchSetupPort;
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

/**
 * The launch logic behind the workbench setup: the scan directory being typed, the dry run of what it holds, the file
 * ticks and the start. The workbench page and a Brief draft are two layouts over it, each with its own store.
 */
export function useWorkbenchSetup(
  store: WorkbenchSetupStore,
  {
    mode,
    config,
    configLoading = false,
    libraries,
    presetId,
    port,
    onStartDirectory,
    onStartScrape,
    onStartMaintenance,
  }: WorkbenchSetupOptions,
) {
  const state = store();
  const {
    scanDir,
    stopPreview,
    previewMode,
    setPreviewMode,
    recursive,
    libraryId,
    candidates,
    selectedPaths,
    scanStatus,
    committedPlanKey,
    setScanDir,
    beginScan,
    applyScanResult,
    failScan,
  } = state;
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

  const runScan = useCallback(async () => {
    if (!scanReady) return;
    const requestId = ++scanRequestRef.current;
    await stopPreview();
    if (requestId !== scanRequestRef.current) return;
    const id = randomId();
    setPreviewMode(true);
    beginScan();
    const completion = (async () => {
      const isCurrentScan = () => scanRequestRef.current === requestId;
      try {
        const result = await port.scanCandidates(scanDir, recursive, scanPlan.excludeDirPaths, id);
        if (!isCurrentScan()) return;
        applyScanResult(scanPlan.scanKey, result.candidates, result.supportedExtensions, {
          warnings: result.warnings,
          mode,
        });
      } catch (error) {
        if (isCurrentScan()) failScan(toErrorMessage(error));
      } finally {
        if (store.getState().activePreview?.id === id) store.setState({ activePreview: null });
      }
    })();
    store.setState({
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
    mode,
    port,
    recursive,
    scanDir,
    scanPlan,
    scanReady,
    setPreviewMode,
    stopPreview,
    store,
  ]);

  useEffect(() => {
    return () => {
      scanRequestRef.current += 1;
      void stopPreview().catch((error) =>
        toast.error(getT().workbench.cancelScanFailed(toErrorMessage(error)), { id: "workbench-scan" }),
      );
      if (store.getState().scanStatus === "scanning") store.setState({ scanStatus: "idle" });
    };
  }, [scanPlan.scanKey, draftDir, stopPreview, store]);

  const chooseScanDir = async (browse: () => Promise<string | null>) => {
    try {
      const selectedPath = (await browse())?.trim() ?? "";
      if (!selectedPath) {
        return;
      }
      setScanDir(selectedPath);
      setDraftDir(selectedPath);
      setDirectoryError("");
    } catch (error) {
      toast.error(getT().workbench.selectScanDirFailed(toErrorMessage(error)), { id: "workbench-scan" });
    }
  };

  const start = useCallback(async () => {
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

  const exitPreview = () => {
    scanRequestRef.current += 1;
    void stopPreview()
      .then(() => {
        setPreviewMode(false);
        store.setState({ scanStatus: "idle" });
      })
      .catch((error) => toast.error(toErrorMessage(error), { id: "workbench-scan" }));
  };

  const suggestDirectory = port.suggestDirectory;
  return {
    ...state,
    draftDir,
    directoryError,
    changeDraftDir: (value: string) => {
      setDraftDir(value);
      setDirectoryError("");
    },
    commitScanDir: () => setScanDir(draftDir.trim()),
    browseScanDir: port.browseDirectory,
    chooseScanDir,
    suggestScanDir: suggestDirectory
      ? async (path: string): Promise<PathAutocompleteResult> => {
          const result = await suggestDirectory(path);
          return {
            accessible: result.accessible,
            error: result.error,
            entries: result.entries.map((entry) => ({ label: entry.label, path: entry.path })),
          };
        }
      : undefined,
    scanPlan,
    scanReady,
    draftDirty,
    needsLibrary,
    library,
    selectedCandidates,
    selectedSize,
    totalSize,
    primaryDisabled,
    // Scanning stays explicit, so a list made for another mode, directory or option asks to be refreshed.
    previewStale:
      previewMode && scanStatus !== "scanning" && scanStatus !== "error" && committedPlanKey !== scanPlan.scanKey,
    refreshDisabled: !scanReady || draftDirty,
    startPending,
    runScan,
    exitPreview,
    start,
  };
}

export type WorkbenchSetupController = ReturnType<typeof useWorkbenchSetup>;
