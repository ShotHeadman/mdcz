import { getProperty, isRecord, isString, mergeDeep, setProperty, toArray, toErrorMessage } from "@main/utils/common";
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

describe("toArray", () => {
  it("normalizes undefined, arrays, and singleton values", () => {
    expect(toArray<number>(undefined)).toEqual([]);
    expect(toArray<number>([1, 2])).toEqual([1, 2]);
    expect(toArray("hello")).toEqual(["hello"]);
  });
});

describe("type guards", () => {
  it("distinguishes plain objects and strings from unsupported values", () => {
    const cases = [
      { guard: isRecord, input: [{}, { a: 1 }], expected: true },
      { guard: isRecord, input: [null, [], "string"], expected: false },
      { guard: isString, input: ["", "hello"], expected: true },
      { guard: isString, input: [42, null], expected: false },
    ];

    for (const { guard, input, expected } of cases) {
      for (const value of input) {
        expect(guard(value)).toBe(expected);
      }
    }
  });
});

describe("getProperty", () => {
  it("reads nested values and falls back when the path is missing or invalid", () => {
    const cases = [
      {
        input: { a: { b: { c: 42 } } },
        path: "a.b.c",
        defaultValue: undefined,
        expected: 42,
      },
      {
        input: { a: 1 },
        path: "b.c",
        defaultValue: "fallback",
        expected: "fallback",
      },
      {
        input: null,
        path: "a",
        defaultValue: "default",
        expected: "default",
      },
    ];

    for (const { input, path, defaultValue, expected } of cases) {
      expect(getProperty(input, path, defaultValue)).toBe(expected);
    }
  });
});

describe("setProperty", () => {
  it("creates and overwrites nested paths as needed", () => {
    const cases = [
      {
        initial: {},
        path: "a.b.c",
        value: 42,
        expectedPath: "a.b.c",
        expected: 42,
      },
      {
        initial: { a: { b: 1 } },
        path: "a.b",
        value: 2,
        expectedPath: "a.b",
        expected: 2,
      },
      {
        initial: { a: "not an object" },
        path: "a.b",
        value: 3,
        expectedPath: "a.b",
        expected: 3,
      },
    ];

    for (const { initial, path, value, expectedPath, expected } of cases) {
      const obj = structuredClone(initial) as Record<string, unknown>;
      setProperty(obj, path, value);
      expect(getProperty(obj, expectedPath)).toBe(expected);
    }
  });
});

describe("mergeDeep", () => {
  it("merges plain objects while replacing arrays and explicit values", () => {
    const base = {
      title: "base",
      options: {
        enabled: true,
        retries: 2,
      },
      tags: ["a"],
      extra: "keep",
    };

    const merged = mergeDeep(base, {
      options: {
        retries: 5,
      },
      tags: ["b"],
      extra: null,
      ignored: undefined,
    });

    expect(merged).toEqual({
      title: "base",
      options: {
        enabled: true,
        retries: 5,
      },
      tags: ["b"],
      extra: null,
    });
  });
});
