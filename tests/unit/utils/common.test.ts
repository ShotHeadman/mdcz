import { toErrorMessage } from "@main/utils/common";
import { toErrorMessage as toSharedErrorMessage } from "@mdcz/shared/error";
import { describe, expect, it } from "vitest";

describe("toErrorMessage", () => {
  it("covers native, impit, object, string, and primitive errors", () => {
    const cases = [
      {
        input: new Error("boom"),
        expected: "boom",
      },
      {
        input: new Error(`ConnectError: Failed to connect to the server.
Reason: hyper_util::client::legacy::Error(
    Connect,
    Custom {
        kind: Other,
        error: Custom {
            kind: UnexpectedEof,
            error: "tls handshake eof",
        },
    },
)`),
        expected: "ConnectError: tls handshake eof",
      },
      {
        input: `impit error: Failed to connect to the server.
Reason: Custom {
    message: "Operation not permitted",
}`,
        expected: "ConnectError: Operation not permitted",
      },
      {
        input: "just a string",
        expected: "just a string",
      },
      {
        input: { message: "from object" },
        expected: "from object",
      },
      {
        input: 42,
        expected: "42",
      },
      {
        input: null,
        expected: "null",
      },
    ];

    for (const { input, expected } of cases) {
      expect(toErrorMessage(input)).toBe(expected);
      expect(toSharedErrorMessage(input)).toBe(expected);
    }
  });

  it("falls back for empty or nullish messages when requested", () => {
    expect(toErrorMessage(null, "未知错误")).toBe("未知错误");
    expect(toSharedErrorMessage(undefined, "未知错误")).toBe("未知错误");
    expect(toErrorMessage({ message: "   " }, "未知错误")).toBe("未知错误");
  });

  it("strips Electron IPC wrappers and config validation error prefixes", () => {
    expect(
      toErrorMessage(
        "Error invoking remote method 'config:save': CONFIG_VALIDATION_ERROR: 配置校验失败：文件夹模板：[] 可选段不能包含路径分隔符",
      ),
    ).toBe("配置校验失败：文件夹模板：[] 可选段不能包含路径分隔符");
    expect(toErrorMessage("Error invoking remote method 'scraper:start': NO_FILES: No files selected")).toBe(
      "NO_FILES: No files selected",
    );
  });
});
