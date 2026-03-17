import { createIpcError, SerializableIpcError, toSerializableIpcError } from "@main/ipc/errors";
import { describe, expect, it } from "vitest";

describe("IPC error serialization", () => {
  it("wraps structured IPC errors in an Error instance with validation details", () => {
    const error = toSerializableIpcError(
      createIpcError("CONFIG_VALIDATION_ERROR", "Configuration validation failed", {
        fields: ["paths.mediaPath"],
        fieldErrors: {
          "paths.mediaPath": "媒体目录不能为空",
        },
      }),
    );

    expect(error).toBeInstanceOf(SerializableIpcError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("CONFIG_VALIDATION_ERROR");
    expect(error.message).toBe("Configuration validation failed");
    expect(error.fields).toEqual(["paths.mediaPath"]);
    expect(error.fieldErrors).toEqual({
      "paths.mediaPath": "媒体目录不能为空",
    });
  });
});
