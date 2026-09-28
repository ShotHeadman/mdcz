import { MaintenanceBatchBarView, type MaintenanceBatchBarViewProps, PathPlanView } from "@mdcz/views/maintenance";
import { WorkbenchSetupView } from "@mdcz/views/workbench";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

const createBatchBarProps = (overrides: Partial<MaintenanceBatchBarViewProps> = {}): MaintenanceBatchBarViewProps => ({
  activeExecution: false,
  canPauseMaintenance: false,
  canReturnToSetup: true,
  canRunPrimaryAction: true,
  canRunReplacement: true,
  entriesCount: 1,
  executeDialogOpen: false,
  groupedSelectedEntries: [],
  hasPreviewResults: false,
  onExecute: vi.fn(),
  onExecuteDialogOpenChange: vi.fn(),
  onPauseToggle: vi.fn(),
  onPreview: vi.fn(async () => undefined),
  onReturnToSetup: vi.fn(),
  onStop: vi.fn(),
  paused: false,
  presetId: "import_local",
  presetLabel: "本地导入",
  previewPending: false,
  progressValue: 0,
  readyCount: 1,
  recentResults: [],
  selectedCount: 1,
  stopping: false,
  ...overrides,
});

function PresetSelectionHarness() {
  const [presetId, setPresetId] = useState<"import_local" | "refresh_metadata" | "local_organize" | "rebuild_all">(
    "import_local",
  );

  return (
    <>
      <output aria-label="当前维护预设">{presetId}</output>
      <WorkbenchSetupView
        mode="maintenance"
        scanDir="/media"
        candidates={[]}
        selectedPaths={[]}
        selectedSize={0}
        totalSize={0}
        scanStatus="success"
        startPending={false}
        supportedExtensions={[".mp4"]}
        presetId={presetId}
        primaryDisabled
        formatBytes={() => "0 B"}
        onBrowseScanDir={() => undefined}
        onRefreshScan={() => undefined}
        onPresetChange={setPresetId}
        onStart={() => undefined}
        onToggleCandidate={() => undefined}
        onSelectCandidates={() => undefined}
      />
    </>
  );
}

function LocalPresetHarness({
  presetId,
  onExecute,
}: {
  presetId: "import_local" | "local_organize";
  onExecute: () => void;
}) {
  const [hasPreviewResults, setHasPreviewResults] = useState(false);
  return (
    <MaintenanceBatchBarView
      {...createBatchBarProps({
        presetId,
        hasPreviewResults,
        onPreview: async () => {
          setHasPreviewResults(true);
          return undefined;
        },
        onExecute,
      })}
    />
  );
}

function ReplacementHarness({ onExecute }: { onExecute: () => void }) {
  const [open, setOpen] = useState(false);
  const pathDiff = {
    changed: true,
    currentDir: "/media",
    currentVideoPath: "/media/SSIS-497.mp4",
    fileId: "entry-1",
    targetDir: "/media/JAV_output/SSIS-497",
    targetVideoPath: "/media/JAV_output/SSIS-497/SSIS-497.mp4",
  };
  return (
    <>
      <MaintenanceBatchBarView
        {...createBatchBarProps({
          presetId: "rebuild_all",
          presetLabel: "全量重整",
          hasPreviewResults: true,
          executeDialogOpen: open,
          onExecuteDialogOpenChange: setOpen,
          onExecute,
          groupedSelectedEntries: [
            {
              id: "entry-1",
              title: "SSIS-497",
              subtitle: "Remote Title",
              ready: true,
              diffCount: 1,
              hasPathChange: true,
              changedPathItems: [{ fileId: "entry-1", fileName: "SSIS-497.mp4", pathDiff }],
            },
          ],
        })}
      />
      <PathPlanView pathDiff={pathDiff} />
    </>
  );
}

test("maintenance setup selects all four presets through semantic buttons", async () => {
  const screen = await render(<PresetSelectionHarness />);
  const current = screen.getByLabelText("当前维护预设");
  await expect.element(screen.getByText("输出目录")).not.toBeInTheDocument();

  for (const [label, presetId] of [
    ["本地导入", "import_local"],
    ["原地更新", "refresh_metadata"],
    ["本地整理", "local_organize"],
    ["全量重整", "rebuild_all"],
  ] as const) {
    await screen.getByRole("button", { name: new RegExp(label, "u") }).click();
    await expect.element(current).toHaveTextContent(presetId);
  }
});

test("local presets preview before applying with their own actions", async () => {
  for (const [presetId, previewLabel, executeLabel] of [
    ["import_local", "生成导入预览", "导入到媒体库"],
    ["local_organize", "生成整理预览", "执行整理"],
  ] as const) {
    const onExecute = vi.fn();
    const screen = await render(<LocalPresetHarness presetId={presetId} onExecute={onExecute} />);
    await expect.element(screen.getByRole("button", { name: "数据替换" })).not.toBeInTheDocument();
    await screen.getByRole("button", { name: previewLabel }).click();
    await screen.getByRole("button", { name: executeLabel }).click();
    expect(onExecute).toHaveBeenCalledOnce();
    await screen.unmount();
  }
});

test("diff presets expose replacement confirmation and changed path evidence", async () => {
  const onExecute = vi.fn();
  const screen = await render(<ReplacementHarness onExecute={onExecute} />);

  await expect.element(screen.getByText("当前路径").first()).toBeVisible();
  await expect.element(screen.getByText("/media/SSIS-497.mp4").first()).toBeVisible();
  await screen.getByRole("button", { name: "数据替换" }).click();
  await expect.element(screen.getByRole("dialog", { name: "确认数据替换" })).toBeVisible();
  await expect.element(screen.getByText("路径将调整")).toBeVisible();
  await screen.getByRole("button", { name: "开始批量执行 1 项" }).click();
  expect(onExecute).toHaveBeenCalledOnce();
});
