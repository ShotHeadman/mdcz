import type { ServiceContainer } from "@main/container";
import { createScraperHandlers } from "@main/ipc/handlers/scraper";
import { Website } from "@mdcz/shared/enums";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import { describe, expect, it, vi } from "vitest";

vi.mock("@egoist/tipc/main", () => {
  type MockProcedure = {
    input: () => MockProcedure;
    action: <TInput, TResult>(
      action: (args: { context: unknown; input: TInput }) => Promise<TResult>,
    ) => {
      action: (args: { context: unknown; input: TInput }) => Promise<TResult>;
    };
  };
  const createProcedure = (): MockProcedure => ({
    input: () => createProcedure(),
    action: (action) => ({ action }),
  });

  return {
    tipc: {
      create: () => ({ procedure: createProcedure() }),
    },
  };
});

const actionArgs = <TInput>(input: TInput) => ({ context: { sender: {} as never }, input });

describe("createScraperHandlers manual URL retry", () => {
  it("validates and propagates site-root manual URLs", async () => {
    const retryFiles = vi.fn(async () => ({ taskId: "task-1", totalFiles: 1 }));
    const handlers = createScraperHandlers({
      scraperService: {
        retryFiles,
      },
    } as unknown as ServiceContainer);

    await expect(
      handlers[IpcChannel.Scraper_RetryFailed].action(
        actionArgs({ filePaths: ["/media/ABC-123.mp4"], manualUrl: "https://video.dmm.co.jp/" }),
      ),
    ).resolves.toEqual({
      taskId: "task-1",
      totalFiles: 1,
      message: "重试任务已启动，共 1 个文件",
    });

    expect(retryFiles).toHaveBeenCalledWith(["/media/ABC-123.mp4"], {
      site: Website.DMM_TV,
      detailUrl: undefined,
    });
  });

  it("rejects unsupported manual URLs before calling the service", async () => {
    const retryFiles = vi.fn();
    const handlers = createScraperHandlers({
      scraperService: {
        retryFiles,
      },
    } as unknown as ServiceContainer);

    await expect(
      handlers[IpcChannel.Scraper_RetryFailed].action(
        actionArgs({ filePaths: ["/media/ABC-123.mp4"], manualUrl: "https://example.com/title/1" }),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      message: "不支持的站点地址",
    });

    expect(retryFiles).not.toHaveBeenCalled();
  });

  it("rejects supported-site invalid paths before calling the service", async () => {
    const retryFiles = vi.fn();
    const handlers = createScraperHandlers({
      scraperService: {
        retryFiles,
      },
    } as unknown as ServiceContainer);

    await expect(
      handlers[IpcChannel.Scraper_RetryFailed].action(
        actionArgs({ filePaths: ["/media/ABC-123.mp4"], manualUrl: "https://video.dmm.co.jp/av/" }),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      message: "请输入站点首页或详情地址",
    });

    expect(retryFiles).not.toHaveBeenCalled();
  });
});
