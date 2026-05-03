import { describe, expect, it } from "vitest";
import { type RuntimeTaskSnapshot, transitionTask } from "./tasks";

const baseTask = (status: RuntimeTaskSnapshot["status"]): RuntimeTaskSnapshot => ({
  completedAt: null,
  error: null,
  id: "task-1",
  startedAt: null,
  status,
});

describe("runtime task FSM", () => {
  it("pauses, resumes, and retries through durable queued states", () => {
    const now = new Date("2026-04-30T00:00:00.000Z");
    const running = transitionTask(baseTask("queued"), { action: "start", now });
    const paused = transitionTask(running, { action: "pause", now });
    const resumed = transitionTask(paused, { action: "resume", now });
    const failed = transitionTask(resumed, { action: "fail", error: "boom", now });
    const retried = transitionTask(failed, { action: "retry", now });

    expect(running).toMatchObject({ status: "running", startedAt: now, completedAt: null, error: null });
    expect(paused.status).toBe("paused");
    expect(resumed).toMatchObject({ status: "queued", startedAt: null, completedAt: null, error: null });
    expect(failed).toMatchObject({ status: "failed", completedAt: now, error: "boom" });
    expect(retried).toMatchObject({ status: "queued", startedAt: null, completedAt: null, error: null });
  });

  it("allows paused tasks to be retried as durable queued work", () => {
    const paused = transitionTask(baseTask("queued"), { action: "pause" });
    const retried = transitionTask(paused, { action: "retry" });

    expect(retried).toMatchObject({ status: "queued", startedAt: null, completedAt: null, error: null });
  });

  it("moves running stop requests through stopping and rejects invalid transitions", () => {
    const running = transitionTask(baseTask("queued"), {
      action: "start",
      now: new Date("2026-04-30T00:00:00.000Z"),
    });
    const stopping = transitionTask(running, { action: "stop", error: "stop requested" });

    expect(stopping).toMatchObject({ status: "stopping", error: "stop requested" });
    expect(() => transitionTask(baseTask("completed"), { action: "pause" })).toThrow(
      "Invalid task transition: completed -> pause",
    );
  });
});
