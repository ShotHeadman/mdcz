import { spawn as nodeSpawn } from "node:child_process";
import process from "node:process";

export const LIVE_CHILD_TERMINATION_GRACE_MS = 5_000;

const isChildRunning = (child) => child.exitCode === null && !child.signalCode;

const defaultTerminateProcessTree = (child, signal) => {
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

export const createLiveStepProcessRunner = (options = {}) => {
  const spawnProcess = options.spawnProcess ?? nodeSpawn;
  const terminateProcessTree = options.terminateProcessTree ?? defaultTerminateProcessTree;
  const terminationGraceMs = options.terminationGraceMs ?? LIVE_CHILD_TERMINATION_GRACE_MS;
  const setTimeoutFn = options.setTimeout ?? setTimeout;
  const clearTimeoutFn = options.clearTimeout ?? clearTimeout;
  const activeChildren = new Map();
  const cancellations = new Map();

  const spawnStep = (step) => {
    const { promise, resolve, reject } = Promise.withResolvers();
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
    return promise;
  };

  const cancelChild = async (child) => {
    if (!isChildRunning(child)) {
      return;
    }

    const exitPromise = new Promise((resolve) => child.once("exit", resolve));
    terminateProcessTree(child, "SIGTERM");

    let timeoutId;
    await Promise.race([
      exitPromise,
      new Promise((resolve) => {
        timeoutId = setTimeoutFn(resolve, terminationGraceMs);
      }),
    ]);
    if (timeoutId !== undefined) {
      clearTimeoutFn(timeoutId);
    }

    if (isChildRunning(child)) {
      terminateProcessTree(child, "SIGKILL");
    }
  };

  const cancelStep = async (step) => {
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

  const cancelAll = async () => {
    await Promise.all(
      [...activeChildren.keys()].map((id) =>
        cancelStep({
          id,
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
