import { IpcChannel } from "@mdcz/shared/IpcChannel";
import { describe, expect, it, vi } from "vitest";
import { invokeIpc } from "../../../apps/desktop/src/preload/index";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(async () => "ok"),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: {
    invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

describe("preload invoke allowlist", () => {
  it("throws for an unknown channel before reaching ipcRenderer", () => {
    expect(() => {
      void invokeIpc("nope");
    }).toThrow("Unsupported IPC channel: nope");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("forwards allowlisted channels", async () => {
    await expect(invokeIpc(IpcChannel.App_Info)).resolves.toBe("ok");
    expect(invoke).toHaveBeenCalledWith(IpcChannel.App_Info, undefined);
  });
});
