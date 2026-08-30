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
  presetLabel: "读取本地",
  previewPending: false,
  progressValue: 0,
  readyCount: 1,
  recentResults: [],
  selectedCount: 1,
  stopping: false,
  supportsExecution: false,
  usesDiffView: false,
  ...overrides,
});

function PresetSelectionHarness() {
  const [presetId, setPresetId] = useState<"read_local" | "refresh_data" | "organize_files" | "rebuild_all">(
    "read_local",
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
        extensionCount={0}
        scanStatus="success"
        scanning={false}
        startPending={false}
        supportedExtensions={[".mp4"]}
        presetId={presetId}
        runSummary=""
        primaryDisabled
        formatBytes={() => "0 B"}
        onBrowseScanDir={() => undefined}
        onRefreshScan={() => undefined}
        onPresetChange={setPresetId}
        onStart={() => undefined}
        onToggleCandidate={() => undefined}
        onToggleAll={() => undefined}
      />
    </>
  );
}

function OrganizeHarness({ onExecute }: { onExecute: () => void }) {
  const [hasPreviewResults, setHasPreviewResults] = useState(false);
  return (
    <MaintenanceBatchBarView
      {...createBatchBarProps({
        presetLabel: "整理目录",
        supportsExecution: true,
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
          presetLabel: "全量重整",
          supportsExecution: true,
          usesDiffView: true,
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

  for (const [label, presetId] of [
    ["读取本地", "read_local"],
    ["刷新数据", "refresh_data"],
    ["整理目录", "organize_files"],
    ["全量重整", "rebuild_all"],
  ] as const) {
    await screen.getByRole("button", { name: new RegExp(label, "u") }).click();
    await expect.element(current).toHaveTextContent(presetId);
  }
});

test("read-local short circuits execution while organize previews before applying", async () => {
  const readLocal = await render(<MaintenanceBatchBarView {...createBatchBarProps()} />);
  await expect.element(readLocal.getByRole("button", { name: "返回工作台初始页面" })).toBeVisible();
  await expect.element(readLocal.getByRole("button", { name: /生成|执行|数据替换/u })).not.toBeInTheDocument();
  await readLocal.unmount();

  const onExecute = vi.fn();
  const organize = await render(<OrganizeHarness onExecute={onExecute} />);
  await organize.getByRole("button", { name: "生成整理预览" }).click();
  await organize.getByRole("button", { name: "执行整理" }).click();
  expect(onExecute).toHaveBeenCalledOnce();
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
