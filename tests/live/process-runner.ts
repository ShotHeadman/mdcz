import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import process from "node:process";
import type { LiveCoordinatorStep } from "./live-coordinator";

export const LIVE_CHILD_TERMINATION_GRACE_MS = 5_000;

export interface LiveStepProcessRunner {
  spawnStep(step: LiveCoordinatorStep): Promise<number>;
  cancelStep(step: LiveCoordinatorStep): Promise<void>;
  cancelAll(): Promise<void>;
  activeCount(): number;
}

export interface CreateLiveStepProcessRunnerOptions {
  workspaceRoot?: string;
  env?: NodeJS.ProcessEnv;
  spawnProcess?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  terminateProcessTree?: (child: ChildProcess, signal: "SIGTERM" | "SIGKILL") => void;
  terminationGraceMs?: number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

const isChildRunning = (child: ChildProcess): boolean => child.exitCode === null && !child.signalCode;

const defaultTerminateProcessTree = (child: ChildProcess, signal: "SIGTERM" | "SIGKILL"): void => {
  if (!child.pid || !isChildRunning(child)) {
    return;
  }

  if (process.platform === "win32") {
    const args = ["/PID", String(child.pid), "/T"];
    if (signal === "SIGKILL") {
      args.push("/F");
    }
    const taskkill = nodeSpawn("taskkill", args, { stdio: "ignore", windowsHide: true });
    taskkill.once("error", () => {
      try {
        child.kill(signal);
      } catch {
        // Already exited.
      }
    });
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already exited.
    }
  }
};

export const createLiveStepProcessRunner = (
  options: CreateLiveStepProcessRunnerOptions = {},
): LiveStepProcessRunner => {
  const spawnProcess = options.spawnProcess ?? nodeSpawn;
  const terminateProcessTree = options.terminateProcessTree ?? defaultTerminateProcessTree;
  const terminationGraceMs = options.terminationGraceMs ?? LIVE_CHILD_TERMINATION_GRACE_MS;
  const setTimeoutFn = options.setTimeout ?? setTimeout;
  const clearTimeoutFn = options.clearTimeout ?? clearTimeout;
  const activeChildren = new Map<string, ChildProcess>();
  const cancellations = new Map<string, Promise<void>>();

  const spawnStep = (step: LiveCoordinatorStep): Promise<number> =>
    new Promise<number>((resolve, reject) => {
      const child = spawnProcess(step.command, [...step.args], {
        cwd: options.workspaceRoot,
        env: options.env,
        stdio: "inherit",
        detached: true,
      });
      activeChildren.set(step.id, child);

      child.once("error", (error) => {
        activeChildren.delete(step.id);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        activeChildren.delete(step.id);
        resolve(signal ? 1 : (code ?? 1));
      });
    });

  const cancelChild = async (child: ChildProcess): Promise<void> => {
    if (!isChildRunning(child)) {
      return;
    }

    const exitPromise = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
    terminateProcessTree(child, "SIGTERM");

    let timeoutId: NodeJS.Timeout | undefined;
    await Promise.race([
      exitPromise,
      new Promise<void>((resolve) => {
        timeoutId = setTimeoutFn(() => resolve(), terminationGraceMs);
      }),
    ]);
    if (timeoutId !== undefined) {
      clearTimeoutFn(timeoutId);
    }

    if (isChildRunning(child)) {
      terminateProcessTree(child, "SIGKILL");
    }
  };

  const cancelStep = async (step: LiveCoordinatorStep): Promise<void> => {
    const existing = cancellations.get(step.id);
    if (existing) {
      await existing;
      return;
    }

    const child = activeChildren.get(step.id);
    if (!child) {
      return;
    }

    const cancellation = cancelChild(child).finally(() => {
      cancellations.delete(step.id);
    });
    cancellations.set(step.id, cancellation);
    await cancellation;
  };

  const cancelAll = async (): Promise<void> => {
    await Promise.all(
      [...activeChildren.keys()].map((id) =>
        cancelStep({
          id: id as LiveCoordinatorStep["id"],
          label: id,
          command: "",
          args: [],
        }),
      ),
    );
  };

  return {
    spawnStep,
    cancelStep,
    cancelAll,
    activeCount: () => activeChildren.size,
  };
};
