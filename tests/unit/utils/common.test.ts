import {
  getProperty,
  isRecord,
  isString,
  setProperty,
  toArray,
  toErrorMessage,
} from "@main/utils/common";
import { describe, expect, it } from "vitest";

describe("toErrorMessage", () => {
  it("extracts message from Error", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns string errors directly", () => {
    expect(toErrorMessage("just a string")).toBe("just a string");
  });

  it("converts other types to string", () => {
    expect(toErrorMessage(42)).toBe("42");
    expect(toErrorMessage(null)).toBe("null");
  });
});

describe("toArray", () => {
  it("returns empty array for undefined", () => {
    expect(toArray(undefined)).toEqual([]);
  });

  it("returns array as-is", () => {
    expect(toArray([1, 2])).toEqual([1, 2]);
  });

  it("wraps single value in array", () => {
    expect(toArray("hello")).toEqual(["hello"]);
  });
});

describe("isRecord", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("returns false for non-objects", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord("string")).toBe(false);
  });
});

describe("isString", () => {
  it("isString detects strings", () => {
    expect(isString("")).toBe(true);
    expect(isString("hello")).toBe(true);
    expect(isString(42)).toBe(false);
    expect(isString(null)).toBe(false);
  });
});

describe("getProperty", () => {
  it("reads nested paths", () => {
    expect(getProperty({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
  });

  it("returns defaultValue for missing paths", () => {
    expect(getProperty({ a: 1 }, "b.c", "fallback")).toBe("fallback");
  });

  it("returns defaultValue for non-objects", () => {
    expect(getProperty(null, "a", "default")).toBe("default");
  });
});

describe("setProperty", () => {
  it("sets a nested property, creating intermediates", () => {
    const obj: Record<string, unknown> = {};
    setProperty(obj, "a.b.c", 42);
    expect(getProperty(obj, "a.b.c")).toBe(42);
  });

  it("overwrites existing values", () => {
    const obj: Record<string, unknown> = { a: { b: 1 } };
    setProperty(obj, "a.b", 2);
    expect(getProperty(obj, "a.b")).toBe(2);
  });

  it("creates intermediate objects when path crosses non-objects", () => {
    const obj: Record<string, unknown> = { a: "not an object" };
    setProperty(obj, "a.b", 3);
    expect(getProperty(obj, "a.b")).toBe(3);
  });
});
