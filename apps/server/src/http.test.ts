import { describe, expect, it } from "vitest";

import { createHealthPayload } from "./http";

const expectedHealthPayload = {
  service: "mdcz-server",
  status: "ok",
  slice: "app-skeleton",
} as const;

describe("createHealthPayload", () => {
  it("returns the server skeleton health contract", () => {
    expect(createHealthPayload()).toEqual(expectedHealthPayload);
  });
});
