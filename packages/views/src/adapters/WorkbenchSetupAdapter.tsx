import { formatBytes } from "@mdcz/shared/format";
import { isAbsoluteHostPath } from "@mdcz/shared/mediaCandidate";
import { changeMaintenancePreset, useMaintenanceStore } from "@mdcz/views/state/maintenanceStore";
import { useWorkbenchSetupStore } from "@mdcz/views/state/workbenchSetupStore";
import { useEffect, useRef } from "react";
import { WorkbenchSetupView } from "../workbench";
import { useWorkbenchSetup, type WorkbenchSetupOptions } from "./useWorkbenchSetup";

export type { CandidateScanResult, WorkbenchSetupPort } from "./useWorkbenchSetup";

export interface WorkbenchSetupAdapterProps extends Omit<WorkbenchSetupOptions, "presetId"> {
  onManageLibraries: () => void;
}

export function WorkbenchSetupAdapter({ onManageLibraries, ...options }: WorkbenchSetupAdapterProps) {
  const presetId = useMaintenanceStore((state) => state.presetId);
  const setup = useWorkbenchSetup(useWorkbenchSetupStore, { ...options, presetId });
  const { libraries, mode } = options;
  const { libraryId, scanDir, setLibraryId, setScanDir, start } = setup;
  const initializedRef = useRef(false);

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
    useWorkbenchSetupStore.setState({ startTask: start });
    return () => {
      useWorkbenchSetupStore.setState({ startTask: null });
    };
  }, [start]);

  const browseDirectory = setup.browseScanDir;
  return (
    <WorkbenchSetupView
      mode={mode}
      previewMode={setup.previewMode}
      onExitPreview={setup.exitPreview}
      configLoading={options.configLoading}
      scanDir={setup.draftDir}
      scanDirError={setup.directoryError}
      recursive={setup.recursive}
      onRecursiveChange={setup.setRecursive}
      onCommitScanDir={setup.commitScanDir}
      warnings={setup.warnings}
      libraries={setup.needsLibrary ? (libraries ?? []) : undefined}
      libraryId={setup.library?.id}
      onLibraryChange={setLibraryId}
      onManageLibraries={onManageLibraries}
      candidates={setup.candidates}
      selectedPaths={setup.selectedPaths}
      selectedSize={setup.selectedSize}
      totalSize={setup.totalSize}
      scanStatus={setup.scanStatus}
      scanError={setup.scanError}
      previewStale={setup.previewStale}
      startPending={setup.startPending}
      supportedExtensions={setup.supportedExtensions}
      presetId={presetId}
      primaryDisabled={setup.primaryDisabled}
      onSuggestScanDir={setup.suggestScanDir}
      formatBytes={formatBytes}
      onBrowseScanDir={browseDirectory ? () => void setup.chooseScanDir(browseDirectory) : undefined}
      onScanDirChange={setup.changeDraftDir}
      refreshDisabled={setup.refreshDisabled}
      onRefreshScan={() => {
        if (!setup.draftDirty) void setup.runScan();
      }}
      onPresetChange={changeMaintenancePreset}
      onStart={start}
      onToggleCandidate={setup.toggleSelectedPath}
      onSelectCandidates={setup.setPathsSelected}
    />
  );
}

export default WorkbenchSetupAdapter;
