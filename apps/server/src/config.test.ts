import { describe, expect, it } from "vitest";

import { DEFAULT_SERVER_PORT, parsePort } from "./config";

describe("parsePort", () => {
  it("uses the default server port when no value is provided", () => {
    expect(parsePort(undefined)).toBe(DEFAULT_SERVER_PORT);
  });

  it("parses a valid configured port", () => {
    expect(parsePort("4000")).toBe(4000);
  });

  it("rejects invalid configured ports", () => {
    expect(() => parsePort("0")).toThrow("Invalid PORT value: 0");
    expect(() => parsePort("65536")).toThrow("Invalid PORT value: 65536");
    expect(() => parsePort("4000abc")).toThrow("Invalid PORT value: 4000abc");
    expect(() => parsePort("not-a-port")).toThrow("Invalid PORT value: not-a-port");
  });
});
