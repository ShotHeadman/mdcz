import { describe, expect, it } from "vitest";
import { IpcChannel, isIpcChannel, requireIpcChannel } from "./IpcChannel";

describe("isIpcChannel", () => {
  it("accepts registered command channels", () => {
    expect(isIpcChannel(IpcChannel.App_Info)).toBe(true);
    expect(isIpcChannel("config:get")).toBe(true);
  });

  it("rejects unknown channels before invoke", () => {
    expect(isIpcChannel("nope")).toBe(false);
    expect(() => requireIpcChannel("nope")).toThrow("Unsupported IPC channel: nope");
  });
});
