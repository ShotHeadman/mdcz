import { setImmediate as flush } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { createQuitGuard } from "./quitGuard";

describe("quit guard", () => {
  it("holds a quit while a task is doing work and proceeds once the user confirms", async () => {
    const answers: Array<(agreed: boolean) => void> = [];
    const confirm = vi.fn(() => new Promise<boolean>((resolve) => answers.push(resolve)));
    const proceed = vi.fn();
    expect(createQuitGuard({ taskRunning: () => false, confirm })(proceed)).toBe(true);

    const hold = createQuitGuard({ taskRunning: () => true, confirm });
    expect(hold(proceed)).toBe(false);
    expect(hold(proceed)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    answers[0]?.(false);
    await flush();
    expect(proceed).not.toHaveBeenCalled();

    expect(hold(proceed)).toBe(false);
    answers[1]?.(true);
    await flush();
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(hold(proceed)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
