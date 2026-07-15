import { MAINTENANCE_PRESET_OPTIONS } from "@mdcz/shared/maintenancePresets";
import type { MaintenancePresetId } from "@mdcz/shared/types";
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
            relativePath: "/media/ABC-123.mp4",
            relativeDirectory: "",
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

  expect(MAINTENANCE_PRESET_OPTIONS.map((option) => option.id)).toEqual([
    "read_local",
    "refresh_data",
    "organize_files",
    "rebuild_all",
  ]);

  for (const option of MAINTENANCE_PRESET_OPTIONS) {
    const screen = await renderPreset(option.id);
    await expect.element(screen.getByText("维护预设")).toBeVisible();
    await expect.element(screen.getByText(option.label)).toBeVisible();
    await expect.element(screen.getByText(option.description)).toBeVisible();
    await screen.unmount();
  }

  const refresh = await renderPreset("refresh_data");
  await expect.element(refresh.getByText("联网刷新元数据，对比NFO差异")).toBeVisible();
  await refresh.unmount();

  const rebuild = await renderPreset("rebuild_all");
  await expect.element(rebuild.getByText("重新获取数据并按现有设置修改目录结构")).toBeVisible();
  await rebuild.unmount();

  const organize = await renderPreset("organize_files");
  await expect.element(organize.getByText("按规则重新组织文件目录结构")).toBeVisible();
  await organize.unmount();

  const readLocal = await renderPreset("read_local");
  await expect.element(readLocal.getByText("扫描本地文件，读取现有 NFO 与资源状态")).toBeVisible();
});
