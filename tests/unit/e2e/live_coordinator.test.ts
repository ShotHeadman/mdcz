import { describe, expect, it, vi } from "vitest";
import {
  buildLiveCoordinatorSteps,
  decideLiveCoordinatorArgs,
  LIVE_COORDINATOR_DEADLINE_MS,
  type LiveCoordinatorStep,
  resolveLiveCoordinatorExitCode,
  runLiveCoordinatorSequence,
  runStepWithDeadline,
} from "../../live/live-coordinator";

const sampleSteps = (): LiveCoordinatorStep[] => [
  {
    id: "integration-live",
    label: "integration-live",
    command: "node",
    args: ["integration"],
  },
  {
    id: "web-e2e-live",
    label: "Web E2E/live",
    command: "node",
    args: ["web"],
  },
  {
    id: "desktop-e2e-live",
    label: "Desktop E2E/live",
    command: "node",
    args: ["desktop"],
  },
];

describe("live coordinator args", () => {
  it("accepts an empty argv for the full live gate", () => {
    expect(decideLiveCoordinatorArgs([])).toEqual({ kind: "run" });
    expect(decideLiveCoordinatorArgs(["--"])).toEqual({ kind: "run" });
  });

  it("rejects selection and interactive arguments with runner guidance", () => {
    for (const argument of [
      "--project=web-chromium",
      "--headed",
      "--debug",
      "--ui",
      "--grep=scrape",
      "-g=scrape",
      "web",
    ]) {
      const decision = decideLiveCoordinatorArgs([argument]);
      expect(decision.kind).toBe("reject");
      if (decision.kind === "reject") {
        expect(decision.message).toContain("test:live does not accept");
        expect(decision.message).toContain("node tests/e2e/web/run.mjs --live");
      }
    }
  });
});

describe("live coordinator sequence", () => {
  it("continues after a failed step and returns non-zero overall", async () => {
    const runStep = vi
      .fn(async (_step: LiveCoordinatorStep) => 0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const outcomes = await runLiveCoordinatorSequence({
      steps: sampleSteps(),
      runStep,
    });

    expect(runStep).toHaveBeenCalledTimes(3);
    expect(outcomes.map((outcome) => outcome.exitCode)).toEqual([1, 0, 0]);
    expect(resolveLiveCoordinatorExitCode(outcomes)).toBe(1);
  });

  it("returns zero only when every step succeeds", async () => {
    const runStep = vi.fn(async (_step: LiveCoordinatorStep) => 0);
    const outcomes = await runLiveCoordinatorSequence({
      steps: sampleSteps(),
      runStep,
    });
    expect(outcomes).toHaveLength(3);
    expect(resolveLiveCoordinatorExitCode(outcomes)).toBe(0);
  });

  it("skips remaining steps after the hard deadline", async () => {
    let now = 0;
    const runStep = vi.fn(async (_step: LiveCoordinatorStep) => {
      now += 40_000;
      return 0;
    });

    const outcomes = await runLiveCoordinatorSequence({
      steps: sampleSteps(),
      runStep,
      now: () => now,
      deadlineMs: 30_000,
    });

    expect(runStep).toHaveBeenCalledTimes(1);
    expect(outcomes[0]?.exitCode).toBe(0);
    expect(outcomes[1]?.skipped).toBe(true);
    expect(outcomes[2]?.skipped).toBe(true);
    expect(resolveLiveCoordinatorExitCode(outcomes)).toBe(1);
  });

  it("cancels a hung step when the overall deadline elapses", async () => {
    let now = 0;
    const hangResolvers: Array<(exitCode: number) => void> = [];
    const cancelStep = vi.fn(async (step: LiveCoordinatorStep) => {
      // Simulate the runner killing the child and resolving the hung promise.
      hangResolvers.shift()?.(1);
      expect(step.id).toBe("integration-live");
      // After the hung step is cancelled, wall time is past the budget.
      now = 2_000;
    });

    const runStep = vi.fn(async (_step: LiveCoordinatorStep) => {
      return await new Promise<number>((resolve) => {
        hangResolvers.push(resolve);
      });
    });

    type TimeoutHandle = { id: number };
    let nextHandleId = 1;
    const pendingTimeouts = new Map<number, () => void>();
    const setTimeoutMock = vi.fn((callback: () => void, _ms?: number): TimeoutHandle => {
      const handle = { id: nextHandleId++ };
      pendingTimeouts.set(handle.id, callback);
      return handle;
    }) as unknown as typeof setTimeout;
    const clearTimeoutMock = vi.fn((handle?: TimeoutHandle | number | null) => {
      if (!handle || typeof handle === "number") {
        pendingTimeouts.delete(handle as number);
        return;
      }
      pendingTimeouts.delete(handle.id);
    }) as unknown as typeof clearTimeout;

    const sequencePromise = runLiveCoordinatorSequence({
      steps: sampleSteps(),
      runStep,
      cancelStep,
      now: () => now,
      deadlineMs: 1_000,
      setTimeout: setTimeoutMock,
      clearTimeout: clearTimeoutMock,
    });

    // Allow the hung step to register its deadline timer, then fire it.
    await Promise.resolve();
    expect(pendingTimeouts.size).toBe(1);
    for (const callback of [...pendingTimeouts.values()]) {
      callback();
    }

    const outcomes = await sequencePromise;
    expect(runStep).toHaveBeenCalledTimes(1);
    expect(cancelStep).toHaveBeenCalledTimes(1);
    expect(outcomes[0]?.exitCode).toBe(1);
    expect(outcomes[0]?.errorMessage).toContain("deadline of 1000ms exceeded");
    expect(outcomes[1]?.skipped).toBe(true);
    expect(outcomes[2]?.skipped).toBe(true);
    expect(resolveLiveCoordinatorExitCode(outcomes)).toBe(1);
  });

  it("reserves termination grace inside the overall deadline", async () => {
    let timeoutCallback: (() => void) | undefined;
    let resolveStep: ((exitCode: number) => void) | undefined;
    const setTimeoutMock = vi.fn((callback: () => void) => {
      timeoutCallback = callback;
      return 1 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout;
    const cancelStep = vi.fn(async () => {
      resolveStep?.(1);
    });
    const deadlineRun = runStepWithDeadline({
      step: sampleSteps()[0],
      runStep: async () =>
        await new Promise<number>((resolve) => {
          resolveStep = resolve;
        }),
      cancelStep,
      remainingMs: 10_000,
      deadlineMs: 10_000,
      cancellationGraceMs: 2_000,
      setTimeout: setTimeoutMock,
      clearTimeout: vi.fn(),
    });
    await Promise.resolve();

    expect(setTimeoutMock).toHaveBeenCalledWith(expect.any(Function), 8_000);
    timeoutCallback?.();
    await expect(deadlineRun).rejects.toThrow("deadline of 10000ms exceeded");
    expect(cancelStep).toHaveBeenCalledOnce();
  });

  it("builds the three isolated live steps under the workspace root", () => {
    const steps = buildLiveCoordinatorSteps("/repo", "/usr/bin/node");
    expect(steps.map((step) => step.id)).toEqual(["integration-live", "web-e2e-live", "desktop-e2e-live"]);
    expect(steps[0]?.args).toEqual(["/repo/node_modules/vitest/vitest.mjs", "run", "--project", "integration-live"]);
    expect(steps[1]?.args).toEqual(["/repo/tests/e2e/web/run.mjs", "--live", "--project=web-chromium"]);
    expect(steps[2]?.args).toEqual(["/repo/tests/e2e/web/run.mjs", "--live", "--project=desktop-electron"]);
    expect(LIVE_COORDINATOR_DEADLINE_MS).toBe(50 * 60_000);
  });
});
