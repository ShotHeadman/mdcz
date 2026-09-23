import { defaultConfiguration } from "@mdcz/shared/config";
import type { MediaCandidate } from "@mdcz/shared/types";
import {
  type CandidateScanResult,
  WorkbenchSetupAdapter,
  type WorkbenchSetupPort,
} from "@mdcz/views/adapters/WorkbenchSetupAdapter";
import { MediaBrowserList } from "@mdcz/views/common";
import { ScrapeStartErrorDialog } from "@mdcz/views/scrape";
import { useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { useWorkbenchSetupStore } from "@mdcz/views/state/workbenchSetupStore";
import { WorkbenchSetupView } from "@mdcz/views/workbench";
import { ipc } from "@renderer/client/ipc";
import ScrapeCompletionDialog from "@renderer/components/workbench/ScrapeCompletionDialog";
import { StrictMode } from "react";
import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { buildScrapeSnapshot } from "../../unit/renderer/scrapeTestSupport";

vi.mock("@renderer/client/ipc", () => ({
  ipc: { scraper: { confirmUncensored: vi.fn() } },
}));

const rootDir = "/media";

test("submits directories without scanning and keeps explicit previews cancellable and scoped", async () => {
  useWorkbenchSetupStore.setState(useWorkbenchSetupStore.getInitialState(), true);
  const config = {
    ...defaultConfiguration,
    paths: {
      ...defaultConfiguration.paths,
      mediaPath: rootDir,
      successOutputFolder: "/output",
      defaultScanExcludeDirs: [],
    },
  };
  const requests: Array<{ resolve: (result: CandidateScanResult) => void; reject: (error: Error) => void }> = [];
  const scanCandidates = vi.fn(
    () => new Promise<CandidateScanResult>((resolve, reject) => requests.push({ resolve, reject })),
  );
  const cancelCandidates = vi.fn(async () => {
    requests.at(-1)?.reject(new Error("cancelled"));
  });
  const port: WorkbenchSetupPort = {
    isServer: true,
    browseDirectory: async () => null,
    scanCandidates,
    cancelCandidates,
  };
  const onStart = vi.fn(async () => undefined);
  const onStartDirectory = vi.fn(async () => undefined);
  const props = { config, port, onStartDirectory, onStartScrape: onStart, onStartMaintenance: onStart };
  const screen = await render(<WorkbenchSetupAdapter {...props} mode="scrape" configLoading />);
  await screen.rerender(<WorkbenchSetupAdapter {...props} mode="scrape" />);
  const start = screen.getByRole("button", { name: "开始", exact: true });
  await expect.element(start).toBeEnabled();
  expect(scanCandidates).not.toHaveBeenCalled();
  await start.click();
  expect(onStartDirectory).toHaveBeenCalledWith(
    { kind: "directory", scanDir: rootDir, recursive: true },
    "/output",
    "inspect_local",
  );
  onStartDirectory.mockRejectedValueOnce(new Error("目录不存在或无法访问"));
  await start.click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("目录不存在或无法访问");
  const input = screen.getByPlaceholder("请选择需要扫描的媒体目录");
  await input.fill("/next");
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  await expect.element(start).toBeDisabled();
  await userEvent.keyboard("{Enter}");
  await screen.getByRole("checkbox", { name: "包含子目录" }).click();
  expect(scanCandidates).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "选择文件" }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(scanCandidates).toHaveBeenLastCalledWith("/next", false, [], expect.any(String));
  await expect.element(input).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "返回" }).click();
  await expect.element(input).toBeVisible();
  await input.fill("/changed");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => cancelCandidates.mock.calls.length).toBe(1);
  expect(requests).toHaveLength(1);
  await screen.getByRole("button", { name: "选择文件" }).click();
  await expect.poll(() => requests.length).toBe(2);
  const candidate = (name: string): MediaCandidate => ({
    path: `/changed/${name}.mp4`,
    name: `${name}.mp4`,
    size: 10,
    extension: "mp4",
    lastModified: null,
    ref: { rootId: "changed", relativePath: `${name}.mp4` },
  });
  const first = candidate("ONE-001");
  const second = candidate("TWO-002");
  const added = candidate("NEW-003");
  requests[1].resolve({ candidates: [first, second], supportedExtensions: ["mp4"] });
  await expect.element(screen.getByText("已选 2 / 2 个文件")).toBeVisible();
  await screen.getByRole("checkbox", { name: /TWO-002/ }).click();
  await screen.getByRole("button", { name: "刷新文件" }).click();
  await expect.poll(() => requests.length).toBe(3);
  requests[2].resolve({ candidates: [first, second, added], supportedExtensions: ["mp4"] });
  await expect.element(screen.getByText("已选 1 / 3 个文件")).toBeVisible();
  await start.click();
  expect(onStart).toHaveBeenCalledWith([first], "/output");
  await screen.getByRole("button", { name: "刷新文件" }).click();
  await expect.poll(() => requests.length).toBe(4);
  await screen.getByRole("button", { name: "返回" }).click();
  await expect.element(screen.getByRole("button", { name: "选择文件" })).toBeVisible();
  await screen.rerender(<WorkbenchSetupAdapter {...props} mode="maintenance" />);
  expect(requests).toHaveLength(4);
  await start.click();
  expect(onStartDirectory).toHaveBeenLastCalledWith(
    { kind: "directory", scanDir: "/changed", recursive: false },
    "/changed",
    "inspect_local",
  );
  await screen.getByRole("button", { name: "选择文件" }).click();
  await expect.poll(() => requests.length).toBe(5);
  expect(useWorkbenchSetupStore.getState().activePreview).not.toBeNull();
  await screen.unmount();
  await expect.poll(() => cancelCandidates.mock.calls.length).toBe(3);
  await expect.poll(() => useWorkbenchSetupStore.getState().activePreview).toBeNull();
  const remounted = await render(<WorkbenchSetupAdapter {...props} mode="maintenance" />);
  expect(requests).toHaveLength(5);
  await expect.element(remounted.getByRole("button", { name: "开始", exact: true })).toBeDisabled();
  await remounted.unmount();
  useWorkbenchSetupStore.setState({ activePreview: { id: "reset-preview", stop: async () => undefined } });
  useWorkbenchSetupStore.setState(useWorkbenchSetupStore.getInitialState(), true);
  expect(useWorkbenchSetupStore.getState().activePreview).toBeNull();
});

test("scopes task dialogs to their result lifecycle without clearing the selected result", async () => {
  useUIStore.getState().setSelectedResultId("successful-item");
  const onClose = vi.fn();
  const error =
    "目标目录已存在同名影片\n待处理：/output/ABF-981-source.mp4\n目标路径：/output/ABF-981.mp4\n\n" +
    "多部影片目标文件名重复\n待处理：/output/ABC-123-source.mp4\n目标路径：/output/ABC-123.mp4";
  const screen = await render(<ScrapeStartErrorDialog error={error} onClose={onClose} />);
  await expect.element(screen.getByRole("dialog", { name: "刮削任务未能完成" })).toBeVisible();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("/output/ABF-981.mp4");
  await expect.element(screen.getByRole("alert")).toHaveTextContent("/output/ABC-123.mp4");
  await expect.element(screen.getByRole("alert")).toHaveTextContent("目标目录已存在同名影片");
  await expect.element(screen.getByRole("alert")).toHaveTextContent("多部影片目标文件名重复");
  await expect.element(screen.getByRole("button", { name: "保留两份" })).not.toBeInTheDocument();
  expect(useUIStore.getState().selectedResultId).toBe("successful-item");
  await screen.getByRole("button", { name: "我知道了" }).click();
  expect(onClose).toHaveBeenCalledOnce();
  await screen.unmount();

  useScrapeStore.setState(useScrapeStore.getInitialState(), true);
  const completion = await render(
    <StrictMode>
      <ScrapeCompletionDialog />
    </StrictMode>,
  );
  const dialog = completion.getByRole("dialog", { name: "确认无码类型" });
  await expect.element(dialog).not.toBeInTheDocument();
  const snapshot = buildScrapeSnapshot({
    ambiguousUncensoredItems: [
      {
        id: "ambiguous-1",
        ref: { rootId: "root-1", relativePath: "ABC-001.mp4" },
        fileId: "file-1",
        fileName: "ABC-001.mp4",
        number: "ABC-001",
        title: null,
        nfoRelativePath: null,
      },
    ],
  });
  for (const status of ["queued", "discovering", "running", "paused", "stopping"] as const) {
    useScrapeStore.getState().setSnapshot({ ...snapshot, task: { ...snapshot.task, status, completedAt: null } });
    await expect.element(dialog).not.toBeInTheDocument();
  }
  useScrapeStore.getState().setSnapshot(snapshot);
  await expect.element(dialog).toBeVisible();
  await completion.getByRole("button", { name: "跳过", exact: true }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  useScrapeStore.getState().setSnapshot(structuredClone(snapshot));
  await expect.element(dialog).not.toBeInTheDocument();

  useScrapeStore.getState().setSnapshot({ ...snapshot, task: { ...snapshot.task, id: "task-2" } });
  await expect.element(dialog).toBeVisible();
  vi.mocked(ipc.scraper.confirmUncensored).mockRejectedValueOnce(new Error("写入失败"));
  await completion.getByRole("button", { name: "确认", exact: true }).click();
  await expect.element(completion.getByText("写入失败", { exact: true })).toBeVisible();
  vi.mocked(ipc.scraper.confirmUncensored).mockResolvedValueOnce({ updatedCount: 1, items: [] });
  await completion.getByRole("button", { name: "确认", exact: true }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  expect(ipc.scraper.confirmUncensored).toHaveBeenLastCalledWith({
    items: [{ fileId: "file-1", choice: "uncensored" }],
  });
  expect(useUIStore.getState().selectedResultId).toBe("successful-item");
  await completion.unmount();
  useScrapeStore.setState(useScrapeStore.getInitialState(), true);
  useUIStore.getState().setSelectedResultId(null);
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
      scanStatus="idle"
      scanning={false}
      startPending={false}
      supportedExtensions={[".mp4"]}
      presetId="inspect_local"
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
