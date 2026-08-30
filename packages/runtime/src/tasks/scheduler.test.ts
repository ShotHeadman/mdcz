import { describe, expect, it } from "vitest";
import { TaskScheduler } from "./scheduler";

describe("TaskScheduler", () => {
  it("drains work requested while an empty claim is completing", async () => {
    let releaseEmptyClaim: (() => void) | undefined;
    let blockFirstEmptyClaim = true;
    let taskReady = false;
    const completed: string[] = [];
    const scheduler = new TaskScheduler({
      claimNext: async () => {
        if (!taskReady && blockFirstEmptyClaim) {
          blockFirstEmptyClaim = false;
          await new Promise<void>((resolve) => {
            releaseEmptyClaim = resolve;
          });
          return null;
        }
        if (!taskReady) return null;
        taskReady = false;
        return { id: "queued-during-drain" };
      },
      runExecution: async (task) => {
        completed.push(task.id);
      },
    });

    scheduler.drain();
    await Promise.resolve();
    taskReady = true;
    scheduler.drain();
    releaseEmptyClaim?.();
    await scheduler.waitForIdle();

    expect(completed).toEqual(["queued-during-drain"]);
  });
});
