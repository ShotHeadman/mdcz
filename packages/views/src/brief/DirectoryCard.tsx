import type { Configuration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import { formatBytes } from "@mdcz/shared/format";
import type { WorkbenchSetupMode } from "@mdcz/shared/mediaCandidate";
import { maintenancePresetIdSchema } from "@mdcz/shared/serverDtos";
import type { MaintenancePresetId } from "@mdcz/shared/types";
import { Checkbox } from "@mdcz/ui";
import { FolderOpen } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useWorkbenchSetup } from "../adapters/useWorkbenchSetup";
import { useT } from "../i18n";
import { createWorkbenchSetupStore } from "../state/workbenchSetupStore";
import { CandidateList, PathControl } from "../workbench/WorkbenchSetupParts";
import { type BriefCardProps, CardRow, CardShell, findDrop, LibrarySelect, OptionSelect } from "./cardParts";

/**
 * A scrape or maintenance draft over a directory: the workbench's own setup logic, in a store of its own, laid out
 * as a card. Confirm submits the ticked files, the same call the workbench makes from its list.
 */
export function DirectoryCard({
  mode,
  config,
  cell,
  libraries,
  port,
  onChange,
  onConfirmed,
}: BriefCardProps & { mode: WorkbenchSetupMode; config?: Configuration }) {
  const t = useT();
  const recursiveId = useId();
  const [store] = useState(createWorkbenchSetupStore);
  const [showFiles, setShowFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const params = cell.params;
  const directory = typeof params.directory === "string" ? params.directory : "";
  const recursive = typeof params.recursive === "boolean" ? params.recursive : true;
  const libraryId = typeof params.libraryId === "string" ? params.libraryId : "";
  const presetId = params.presetId as MaintenancePresetId | undefined;

  useEffect(() => store.getState().setScanDir(directory), [store, directory]);
  useEffect(() => store.getState().setRecursive(recursive), [store, recursive]);
  useEffect(() => store.getState().setLibraryId(libraryId), [store, libraryId]);

  const setup = useWorkbenchSetup(store, {
    mode,
    config,
    configLoading: !config,
    libraries,
    presetId: presetId ?? "refresh_metadata",
    port: port.setup,
    onStartDirectory: async () => undefined,
    onStartScrape: async (candidates, target) => {
      try {
        const taskId = await port.startScrape({
          executionMode: "batch",
          libraryId: target,
          refs: candidates.map((candidate) => candidate.ref),
        });
        onConfirmed({ kind: "scrape", taskIds: [taskId] });
      } catch (startError) {
        setError(toErrorMessage(startError));
      }
    },
    onStartMaintenance: async (candidates, preset, target) => {
      const rootId = candidates[0]?.ref.rootId;
      if (!rootId) return;
      try {
        const sessionId = await port.startMaintenance({
          rootId,
          presetId: preset,
          refs: candidates.map((candidate) => candidate.ref),
          libraryId: target,
        });
        onConfirmed({ kind: "maintenance", sessionId });
      } catch (startError) {
        setError(toErrorMessage(startError));
      }
    },
  });
  const { runScan, scanReady, draftDirty, committedPlanKey, scanPlan, scanStatus } = setup;

  // Every edit re-runs the dry run, without a model call; only the expanded draft scans. A failed scan waits for Refresh.
  const scannedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!scanReady || draftDirty || committedPlanKey === scanPlan.scanKey || scannedKey.current === scanPlan.scanKey)
      return;
    scannedKey.current = scanPlan.scanKey;
    void runScan();
  }, [scanReady, draftDirty, committedPlanKey, scanPlan.scanKey, runScan]);

  const inLibrary = setup.candidates.filter((candidate) => candidate.inLibrary).length;
  const count = setup.selectedCandidates.length;
  const library = setup.library;
  const confirmLabel =
    mode === "scrape"
      ? t.brief.card.confirm.scrape(count, library?.name ?? "…")
      : t.brief.card.confirm.analyse(count, setup.needsLibrary ? library?.name : undefined);

  return (
    <CardShell
      confirmLabel={confirmLabel}
      confirmDisabled={setup.primaryDisabled || (mode === "maintenance" && !presetId)}
      confirming={setup.startPending}
      error={error}
      onConfirm={() => {
        setError(null);
        void setup.start();
      }}
      footer={
        <label htmlFor={recursiveId} className="inline-flex cursor-pointer items-center gap-2">
          <Checkbox
            id={recursiveId}
            checked={recursive}
            disabled={setup.startPending}
            onCheckedChange={(checked) => onChange({ recursive: checked === true })}
          />
          {t.workbench.includeSubdirs}
        </label>
      }
    >
      {mode === "maintenance" ? (
        <CardRow
          label={t.brief.params.presetId}
          workedOut={cell.workedOut.includes("presetId")}
          dropped={findDrop(cell, "presetId")}
        >
          {(id) => (
            <OptionSelect
              id={id}
              value={presetId}
              placeholder={t.brief.card.choosePreset}
              options={maintenancePresetIdSchema.options.map((value) => ({
                value,
                label: t.domain.maintenancePresets[value].label,
              }))}
              onChange={(value) => onChange({ presetId: value })}
            />
          )}
        </CardRow>
      ) : null}
      <CardRow
        label={t.brief.params.directory}
        workedOut={cell.workedOut.includes("directory")}
        dropped={findDrop(cell, "directory")}
      >
        {(id) => (
          <PathControl
            id={id}
            icon={<FolderOpen className="h-4 w-4" />}
            value={setup.draftDir}
            placeholder={t.workbench.scanDirPlaceholder}
            disabled={setup.startPending}
            onChange={setup.changeDraftDir}
            onCommit={() => onChange({ directory: setup.draftDir.trim() })}
            loadSuggestions={setup.suggestScanDir}
            error={setup.directoryError}
          />
        )}
      </CardRow>
      <CardRow label={t.brief.params.libraryId} dropped={findDrop(cell, "libraryId")}>
        {(id) =>
          setup.needsLibrary ? (
            <LibrarySelect
              id={id}
              libraries={libraries}
              value={library?.id}
              placeholder={t.brief.card.chooseLibrary}
              disabled={setup.startPending}
              onChange={(next) => onChange({ libraryId: next })}
            />
          ) : (
            <p className="text-sm leading-5 text-muted-foreground sm:pt-2.5">{t.brief.card.noLibrary}</p>
          )
        }
      </CardRow>
      <CardRow label={t.brief.card.foundLabel}>
        {() => (
          <div className="space-y-2 text-sm leading-5 sm:pt-2.5">
            <p className="font-numeric">
              {scanStatus === "scanning"
                ? t.brief.card.scanning
                : scanStatus === "error"
                  ? setup.scanError
                  : scanStatus === "success"
                    ? t.brief.card.found(
                        setup.candidates.length,
                        formatBytes(setup.totalSize, { trimTrailingZeros: true }),
                        mode === "scrape" ? inLibrary : 0,
                      )
                    : t.brief.empty}
            </p>
            {scanStatus === "success" && setup.candidates.length > 0 ? (
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => setShowFiles((shown) => !shown)}
              >
                {showFiles ? `▾ ${t.brief.card.hideFiles}` : `▸ ${t.brief.card.showFiles}`}
              </button>
            ) : null}
          </div>
        )}
      </CardRow>
      {showFiles ? (
        <CandidateList
          bare
          className="-mx-5 max-h-[22rem]"
          mode={mode}
          candidates={setup.candidates}
          selectedPaths={setup.selectedPaths}
          totalSize={setup.totalSize}
          scanStatus={scanStatus}
          scanError={setup.scanError}
          warnings={setup.warnings}
          previewStale={setup.previewStale}
          scanDir={setup.scanDir}
          recursive={recursive}
          supportedExtensions={setup.supportedExtensions}
          refreshDisabled={setup.refreshDisabled}
          disabled={setup.startPending}
          formatBytes={formatBytes}
          onRefresh={() => void runScan()}
          onToggle={setup.toggleSelectedPath}
          onSelect={setup.setPathsSelected}
        />
      ) : null}
    </CardShell>
  );
}
