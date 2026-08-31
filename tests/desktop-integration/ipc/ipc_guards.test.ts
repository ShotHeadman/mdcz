import type { ServiceContainer } from "@main/container";
import { createAppHandlers } from "@main/ipc/handlers/app";
import { scraperRetryInputSchema } from "@main/ipc/payloads";
import { t } from "@main/ipc/shared";
import { IpcChannel, requireIpcChannel } from "@mdcz/shared/IpcChannel";
import { describe, expect, it, vi } from "vitest";
import { invokeIpc } from "../../../apps/desktop/src/preload/index";
import { ipcActionArgs } from "../../unit/ipc/ipcActionArgs";

const testUserDataPath = vi.hoisted(
  () => `${process.env.TEMP ?? process.env.TMPDIR ?? process.cwd()}/mdcz-ipc-guards-${process.pid}`,
);
const ipcInvoke = vi.hoisted(() => vi.fn(async () => "ok"));

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.0.0-test",
    isPackaged: false,
    relaunch: vi.fn(),
    exit: vi.fn(),
    getPath: () => testUserDataPath,
    isReady: () => false,
    commandLine: { appendSwitch: vi.fn() },
    setAppUserModelId: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  },
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: ipcInvoke, on: vi.fn(), removeListener: vi.fn() },
  ipcMain: { handle: vi.fn(), once: vi.fn(), removeHandler: vi.fn() },
}));

describe("IPC guards", () => {
  it("allows only registered preload channels", async () => {
    expect(() => invokeIpc("nope")).toThrow("Unsupported IPC channel: nope");
    expect(ipcInvoke).not.toHaveBeenCalled();

    await expect(invokeIpc(IpcChannel.App_Info)).resolves.toBe("ok");
    expect(ipcInvoke).toHaveBeenCalledWith(requireIpcChannel(IpcChannel.App_Info), undefined);
  });

  it("rejects an IPC call from a frame whose origin is not the app's own", async () => {
    const procedure = t.procedure.action(async () => ({ ok: true as const }));
    await expect(
      procedure.action({
        context: { sender: {} as never, senderFrame: { url: "https://evil.example/" } },
        input: undefined,
      }),
    ).rejects.toMatchObject({ message: "IPC sender origin is not allowed" });
  });

  it("rejects a malformed payload for a schema-guarded channel with a schema error", async () => {
    const handlers = createAppHandlers({
      windowService: { syncTitleBarOverlay: vi.fn() },
    } as unknown as ServiceContainer);
    await expect(
      handlers[IpcChannel.App_OpenExternal].action(ipcActionArgs({ url: 1 }) as never),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  it("parses a schema-guarded payload before the action runs", async () => {
    const action = vi.fn(async () => ({ ok: true as const }));
    const procedure = t.procedure.input(scraperRetryInputSchema).action(action);
    await expect(procedure.action(ipcActionArgs({ runId: "" }))).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(action).not.toHaveBeenCalled();
  });
});
