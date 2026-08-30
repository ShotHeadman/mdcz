import { MAINTENANCE_PRESET_OPTIONS } from "@mdcz/shared/maintenancePresets";
import type { MaintenancePresetId } from "@mdcz/shared/types";
import { MediaBrowserList } from "@mdcz/views/common";
import { WorkbenchSetupView } from "@mdcz/views/workbench";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

const rootDir = "/media";
const successDir = "/media/JAV_output";

test("server workbench setup hides browse buttons and keeps path autocomplete", async () => {
  const screen = await render(
    <WorkbenchSetupView
      mode="scrape"
      scanDir=""
      targetDir=""
      candidates={[]}
      selectedPaths={[]}
      selectedSize={0}
      totalSize={0}
      extensionCount={0}
      scanStatus="idle"
      scanning={false}
      startPending={false}
      supportedExtensions={[".mp4"]}
      presetId="read_local"
      runSummary=""
      primaryDisabled
      isServer
      formatBytes={() => "0 B"}
      onBrowseScanDir={() => undefined}
      onBrowseTargetDir={() => undefined}
      onRefreshScan={() => undefined}
      onPresetChange={() => undefined}
      onStart={() => undefined}
      onToggleCandidate={() => undefined}
      onToggleAll={() => undefined}
      onScanDirChange={() => undefined}
      onTargetDirChange={() => undefined}
      onSuggestScanDir={async () => ({
        path: "",
        parentPath: "",
        exists: false,
        accessible: true,
        entries: [],
      })}
      onSuggestTargetDir={async () => ({
        path: "",
        parentPath: "",
        exists: false,
        accessible: true,
        entries: [],
      })}
    />,
  );

  await expect.element(screen.getByRole("button", { name: "浏览" })).not.toBeInTheDocument();
  expect(screen.container.querySelector("datalist")).toBeNull();
  expect(screen.container.querySelectorAll('input[aria-autocomplete="list"]').length).toBe(2);
});

test("maintenance setup exposes unique copy for each preset branch", async () => {
  const renderPreset = async (presetId: MaintenancePresetId) =>
    await render(
      <WorkbenchSetupView
        mode="maintenance"
        scanDir={rootDir}
        targetDir={successDir}
        candidates={[
          {
            path: "/media/ABC-123.mp4",
            name: "ABC-123.mp4",
            size: 1,
            lastModified: null,
            extension: ".mp4",
            ref: { rootId: "test-root", relativePath: "ABC-123.mp4" },
          },
        ]}
        selectedPaths={["/media/ABC-123.mp4"]}
        selectedSize={1}
        totalSize={1}
        extensionCount={1}
        scanStatus="success"
        scanning={false}
        startPending={false}
        supportedExtensions={[".mp4"]}
        presetId={presetId}
        runSummary="1 个文件"
        primaryDisabled={false}
        isServer={false}
        formatBytes={() => "1 B"}
        onBrowseScanDir={() => undefined}
        onBrowseTargetDir={() => undefined}
        onRefreshScan={() => undefined}
        onPresetChange={() => undefined}
        onStart={() => undefined}
        onToggleCandidate={() => undefined}
        onToggleAll={() => undefined}
        onScanDirChange={() => undefined}
        onTargetDirChange={() => undefined}
      />,
    );

  expect(MAINTENANCE_PRESET_OPTIONS.map((option) => [option.id, option.label])).toEqual([
    ["read_local", "读取本地"],
    ["refresh_data", "刷新数据"],
    ["organize_files", "整理目录"],
    ["rebuild_all", "全量重整"],
  ]);

  for (const option of MAINTENANCE_PRESET_OPTIONS) {
    const screen = await renderPreset(option.id);
    await expect.element(screen.getByText("维护预设")).toBeVisible();
    await expect.element(screen.getByText(option.label)).toBeVisible();
    await expect.element(screen.getByText(option.description)).toBeVisible();
    await screen.unmount();
  }
});

test("media browser list renders processing items with spinner state", async () => {
  const screen = await render(
    <MediaBrowserList
      items={[
        {
          id: "ABC-123",
          title: "ABC-123",
          subtitle: "ABC-123.mp4",
          status: "processing",
          active: false,
          menuContent: null,
          onClick: () => undefined,
        },
      ]}
      filter="all"
      onFilterChange={() => undefined}
      stats={[{ label: "总计", value: "1" }]}
    />,
  );

  await expect.element(screen.getByText("ABC-123", { exact: true })).toBeVisible();
  expect(screen.container.querySelector(".animate-spin")).not.toBeNull();
});
