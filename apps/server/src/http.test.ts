import { describe, expect, it } from "vitest";

import { createHealthPayload } from "./http";

describe("createHealthPayload", () => {
  it("returns the server skeleton health contract", () => {
    expect(createHealthPayload()).toEqual({
      service: "mdcz-server",
      status: "ok",
      slice: "app-skeleton",
    });
  });
});
