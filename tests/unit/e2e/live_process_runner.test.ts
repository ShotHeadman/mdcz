import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { LiveCoordinatorStep } from "../../live/live-coordinator";
import { createLiveStepProcessRunner } from "../../live/process-runner.mjs";

class FakeChild extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill = vi.fn();

  exit(signal: NodeJS.Signals): void {
    this.signalCode = signal;
    this.emit("exit", null, signal);
  }
}

const step: LiveCoordinatorStep = {
  id: "integration-live",
  label: "integration-live",
  command: "node",
  args: ["integration"],
};

describe("live step process runner", () => {
  it("cancels every active child during coordinator shutdown", async () => {
    const child = new FakeChild();
    const terminateProcessTree = vi.fn((target: ChildProcess, signal: "SIGTERM" | "SIGKILL") => {
      (target as unknown as FakeChild).exit(signal as NodeJS.Signals);
    });
    const runner = createLiveStepProcessRunner({
      workspaceRoot: "/repo",
      env: {},
      spawnProcess: vi.fn(() => child as unknown as ChildProcess),
      terminateProcessTree,
    });

    const stepResult = runner.spawnStep(step);
    expect(runner.activeCount()).toBe(1);

    await runner.cancelAll();

    await expect(stepResult).resolves.toBe(1);
    expect(terminateProcessTree).toHaveBeenCalledWith(child, "SIGTERM");
    expect(runner.activeCount()).toBe(0);
  });

  it("escalates to SIGKILL when a child ignores the termination grace", async () => {
    const child = new FakeChild();
    let timeoutCallback: (() => void) | undefined;
    const terminateProcessTree = vi.fn((target: ChildProcess, signal: "SIGTERM" | "SIGKILL") => {
      if (signal === "SIGKILL") {
        (target as unknown as FakeChild).exit("SIGKILL");
      }
    });
    const runner = createLiveStepProcessRunner({
      workspaceRoot: "/repo",
      env: {},
      spawnProcess: vi.fn(() => child as unknown as ChildProcess),
      terminateProcessTree,
      setTimeout: vi.fn((callback: () => void) => {
        timeoutCallback = callback;
        return 1 as unknown as NodeJS.Timeout;
      }) as unknown as typeof setTimeout,
      clearTimeout: vi.fn(),
    });

    const stepResult = runner.spawnStep(step);
    const cancellation = runner.cancelStep(step);
    await Promise.resolve();
    timeoutCallback?.();
    await cancellation;

    await expect(stepResult).resolves.toBe(1);
    expect(terminateProcessTree.mock.calls.map((call) => call[1])).toEqual(["SIGTERM", "SIGKILL"]);
  });
});
