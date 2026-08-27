import { describe, expect, it } from "vitest";
import { createRuntimeLog, useLogStore } from "./logStore";

describe("logStore", () => {
  it("keeps only the newest 200 entries", () => {
    useLogStore.getState().clearLogs();
    for (let index = 0; index < 205; index += 1) {
      useLogStore.getState().addLog(createRuntimeLog("info", `log-${index}`));
    }

    const logs = useLogStore.getState().logs;
    expect(logs).toHaveLength(200);
    expect(logs[0]?.message).toBe("log-5");
    expect(logs.at(-1)?.message).toBe("log-204");
  });
});
