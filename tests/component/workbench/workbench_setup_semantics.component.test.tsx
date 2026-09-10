import { defaultConfiguration } from "@mdcz/shared/config";
import { MAINTENANCE_PRESET_OPTIONS } from "@mdcz/shared/maintenancePresets";
import type { MaintenancePresetId, MediaCandidate } from "@mdcz/shared/types";
import {
  type CandidateScanResult,
  WorkbenchSetupAdapter,
  type WorkbenchSetupPort,
} from "@mdcz/views/adapters/WorkbenchSetupAdapter";
import { MediaBrowserList } from "@mdcz/views/common";
import { ScrapeStartErrorDialog } from "@mdcz/views/scrape";
import { useWorkbenchSetupStore } from "@mdcz/views/state/workbenchSetupStore";
import { WorkbenchSetupView } from "@mdcz/views/workbench";
import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

const rootDir = "/media";

test("serializes latest scan intent, ignores stale results, and starts only the selected snapshot", async () => {
  useWorkbenchSetupStore.setState(useWorkbenchSetupStore.getInitialState(), true);
  const config = {
    ...defaultConfiguration,
    paths: {
      ...defaultConfiguration.paths,
      mediaPath: rootDir,
      successOutputFolder: "/output",
      defaultScanExcludeDirs: [],
      softlinkPath: "/extras",
    },
    behavior: { ...defaultConfiguration.behavior, scrapeSoftlinkPath: true },
  };
  const requests: Array<{ resolve: (result: CandidateScanResult) => void; reject: (error: Error) => void }> = [];
  const scanCandidates = vi.fn(
    () => new Promise<CandidateScanResult>((resolve, reject) => requests.push({ resolve, reject })),
  );
  const port: WorkbenchSetupPort = { isServer: true, browseDirectory: async () => null, scanCandidates };
  const onStart = vi.fn(async () => undefined);
  const props = { config, port, onStartScrape: onStart, onStartMaintenance: onStart };
  const screen = await render(<WorkbenchSetupAdapter {...props} mode="scrape" configLoading />);
  expect(scanCandidates).not.toHaveBeenCalled();
  await screen.rerender(<WorkbenchSetupAdapter {...props} mode="scrape" />);
  await expect.poll(() => requests.length).toBe(1);
  expect(scanCandidates).toHaveBeenLastCalledWith(rootDir, false, []);
  await screen.getByRole("checkbox", { name: "包含子目录" }).click();
  expect(requests).toHaveLength(1);
  const input = screen.getByPlaceholder("请选择需要扫描的媒体目录");
  await input.fill("/next");
  expect(requests).toHaveLength(1);
  await expect.element(screen.getByRole("button", { name: "开始", exact: true })).toBeDisabled();
  await userEvent.keyboard("{Enter}");
  expect(requests).toHaveLength(1);
  requests[0].resolve({ candidates: [], supportedExtensions: ["mp4"] });
  await expect.poll(() => requests.length).toBe(2);
  expect(scanCandidates).toHaveBeenLastCalledWith("/next", true, []);
  requests[1].resolve({ candidates: [], supportedExtensions: ["mp4"] });
  await expect.poll(() => requests.length).toBe(3);
  expect(scanCandidates).toHaveBeenLastCalledWith("/extras", true, []);
  await screen.rerender(<WorkbenchSetupAdapter {...props} mode="maintenance" />);
  expect(requests).toHaveLength(3);
  requests[2].reject(new Error("obsolete request failure"));
  await expect.poll(() => requests.length).toBe(4);
  expect(scanCandidates).toHaveBeenLastCalledWith("/next", true, []);
  expect(useWorkbenchSetupStore.getState().scanStatus).toBe("scanning");
  expect(useWorkbenchSetupStore.getState().scanError).toBe("");
  const candidate = (name: string): MediaCandidate => ({
    path: `/next/${name}.mp4`,
    name: `${name}.mp4`,
    size: 10,
    extension: "mp4",
    lastModified: null,
    ref: { rootId: "next", relativePath: `${name}.mp4` },
  });
  const first = candidate("ONE-001");
  const second = candidate("TWO-002");
  const added = candidate("NEW-003");
  requests[3].resolve({ candidates: [first, second], supportedExtensions: ["mp4"] });
  await expect.element(screen.getByText("已选 2 / 2 个文件")).toBeVisible();
  await screen.getByRole("checkbox", { name: /TWO-002/ }).click();
  await input.fill("/next/");
  await userEvent.keyboard("{Enter}");
  expect(requests).toHaveLength(4);
  await expect.element(screen.getByText("已选 1 / 2 个文件")).toBeVisible();
  await screen.getByRole("button", { name: "重新扫描" }).click();
  await expect.poll(() => requests.length).toBe(5);
  await screen.getByRole("checkbox", { name: "包含子目录" }).click();
  await screen.getByRole("checkbox", { name: "包含子目录" }).click();
  expect(requests).toHaveLength(5);
  requests[4].resolve({ candidates: [], supportedExtensions: ["mp4"] });
  await expect.poll(() => requests.length).toBe(6);
  expect(useWorkbenchSetupStore.getState().candidates).toEqual([first, second]);
  expect(scanCandidates).toHaveBeenLastCalledWith("/next", true, []);
  requests[5].resolve({ candidates: [first, second, added], supportedExtensions: ["mp4"] });
  await expect.element(screen.getByText("已选 1 / 3 个文件")).toBeVisible();
  await screen.getByRole("button", { name: "开始", exact: true }).click();
  expect(onStart).toHaveBeenCalledWith([first], "read_local", undefined);
  await input.fill("/uncommitted");
  await expect.element(screen.getByRole("button", { name: "开始", exact: true })).toBeDisabled();
  await expect.element(screen.getByRole("button", { name: "重新扫描" })).toBeDisabled();
  expect(requests).toHaveLength(6);
  await input.fill("/next");
  await userEvent.keyboard("{Enter}");
  expect(requests).toHaveLength(6);
  await screen.getByRole("button", { name: "重新扫描" }).click();
  await expect.poll(() => requests.length).toBe(7);
  requests[6].reject(new Error("mount I/O failed"));
  await expect.element(screen.getByText("mount I/O failed")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "开始", exact: true })).toBeDisabled();
  await screen.getByRole("button", { name: "重新扫描" }).click();
  await expect.poll(() => requests.length).toBe(8);
  await screen.unmount();
  const remounted = await render(<WorkbenchSetupAdapter {...props} mode="maintenance" />);
  expect(requests).toHaveLength(8);
  await expect.element(remounted.getByRole("button", { name: "开始", exact: true })).toBeDisabled();
  requests[7].reject(new Error("unmounted request failure"));
  await expect.poll(() => requests.length).toBe(9);
  expect(useWorkbenchSetupStore.getState().scanStatus).toBe("scanning");
  expect(useWorkbenchSetupStore.getState().scanError).toBe("");
  requests[8].resolve({ candidates: [first], supportedExtensions: ["mp4"] });
  await expect.element(remounted.getByText("已选 1 / 1 个文件")).toBeVisible();
  expect(useWorkbenchSetupStore.getState().scanError).toBe("");
  await remounted.unmount();
  useWorkbenchSetupStore.setState(useWorkbenchSetupStore.getInitialState(), true);
});

test("shows the complete startup rejection in one dialog", async () => {
  const onClose = vi.fn();
  const error =
    "目标路径存在冲突，本次未改动任何文件。\n\n" +
    "目标目录已存在同名影片\n待处理：/output/ABF-981-source.mp4\n冲突文件：/output/ABF-981.mp4\n\n" +
    "批次内多部影片目标文件名重复\n待处理：/output/ABC-123-source.mp4\n冲突文件：/output/ABC-123.mp4";
  const screen = await render(<ScrapeStartErrorDialog error={error} onClose={onClose} />);
  await expect.element(screen.getByRole("dialog", { name: "目标路径存在冲突" })).toBeVisible();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("/output/ABF-981.mp4");
  await expect.element(screen.getByRole("alert")).toHaveTextContent("/output/ABC-123.mp4");
  await expect.element(screen.getByRole("alert")).toHaveTextContent("目标目录已存在同名影片");
  await expect.element(screen.getByRole("alert")).toHaveTextContent("批次内多部影片目标文件名重复");
  await expect.element(screen.getByRole("button", { name: "保留两份" })).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "我知道了" }).click();
  expect(onClose).toHaveBeenCalledOnce();
});

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
        onRefreshScan={() => undefined}
        onPresetChange={() => undefined}
        onStart={() => undefined}
        onToggleCandidate={() => undefined}
        onToggleAll={() => undefined}
        onScanDirChange={() => undefined}
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
    if (option.id === "read_local") {
      await expect.element(screen.getByText("输出目录")).not.toBeInTheDocument();
    }
    await screen.unmount();
  }
});

test("media browser list distinguishes processing and paused queue states", async () => {
  const processing = await render(
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

  await expect.element(processing.getByText("ABC-123", { exact: true })).toBeVisible();
  expect(processing.container.querySelector(".animate-spin")).not.toBeNull();
  processing.unmount();

  const paused = await render(
    <MediaBrowserList
      items={[
        {
          id: "ABC-123",
          title: "ABC-123",
          subtitle: "ABC-123.mp4",
          status: "paused",
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

  await expect.element(paused.getByLabelText("已暂停")).toBeVisible();
  expect(paused.container.querySelector(".animate-spin")).toBeNull();
});
