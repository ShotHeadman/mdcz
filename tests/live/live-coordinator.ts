export const LIVE_COORDINATOR_DEADLINE_MS = 50 * 60_000;

const SELECTION_ARG_PATTERNS = [
  { pattern: /^--project(?:=|$)/u, name: "--project" },
  { pattern: /^--headed$/u, name: "--headed" },
  { pattern: /^--debug$/u, name: "--debug" },
  { pattern: /^--ui$/u, name: "--ui" },
  { pattern: /^--grep(?:=|$)/u, name: "--grep" },
  { pattern: /^-g(?:=|$)/u, name: "-g" },
  { pattern: /^--workers(?:=|$)/u, name: "--workers" },
  { pattern: /^--shard(?:=|$)/u, name: "--shard" },
  { pattern: /^--repeat-each(?:=|$)/u, name: "--repeat-each" },
  { pattern: /^--last-failed$/u, name: "--last-failed" },
  { pattern: /^--only-changed$/u, name: "--only-changed" },
  { pattern: /^--reporter(?:=|$)/u, name: "--reporter" },
] as const;

export const LIVE_COORDINATOR_USAGE =
  "pnpm test:live runs the full live gate only (integration-live, Web E2E/live, Desktop E2E/live). " +
  "It rejects selection/interactive arguments. " +
  "For focused Playwright live diagnosis use: node tests/e2e/web/run.mjs --live --project=web-chromium|desktop-electron [--headed|--debug|--ui]. " +
  "For focused provider live use: pnpm exec vitest run --project integration-live.";

export type LiveCoordinatorStepId = "integration-live" | "web-e2e-live" | "desktop-e2e-live";

export interface LiveCoordinatorStep {
  id: LiveCoordinatorStepId;
  label: string;
  command: string;
  args: readonly string[];
}

export type LiveCoordinatorArgDecision = { kind: "run" } | { kind: "reject"; message: string };

export interface LiveStepOutcome {
  id: LiveCoordinatorStepId;
  label: string;
  exitCode: number;
  durationMs: number;
  skipped?: boolean;
  errorMessage?: string;
}

export const buildLiveCoordinatorSteps = (workspaceRoot: string, nodeExecutable: string): LiveCoordinatorStep[] => {
  const vitestEntry = `${workspaceRoot}/node_modules/vitest/vitest.mjs`;
  const e2eRunner = `${workspaceRoot}/tests/e2e/web/run.mjs`;
  return [
    {
      id: "integration-live",
      label: "integration-live",
      command: nodeExecutable,
      args: [vitestEntry, "run", "--project", "integration-live"],
    },
    {
      id: "web-e2e-live",
      label: "Web E2E/live",
      command: nodeExecutable,
      args: [e2eRunner, "--live", "--project=web-chromium"],
    },
    {
      id: "desktop-e2e-live",
      label: "Desktop E2E/live",
      command: nodeExecutable,
      args: [e2eRunner, "--live", "--project=desktop-electron"],
    },
  ];
};

export const decideLiveCoordinatorArgs = (argv: readonly string[]): LiveCoordinatorArgDecision => {
  const normalized = argv[0] === "--" ? argv.slice(1) : [...argv];
  if (normalized.length === 0) {
    return { kind: "run" };
  }

  for (const argument of normalized) {
    if (argument === "--help" || argument === "-h") {
      return {
        kind: "reject",
        message: LIVE_COORDINATOR_USAGE,
      };
    }
    for (const { pattern, name } of SELECTION_ARG_PATTERNS) {
      if (pattern.test(argument)) {
        return {
          kind: "reject",
          message: `test:live does not accept ${name}. ${LIVE_COORDINATOR_USAGE}`,
        };
      }
    }
    if (argument.startsWith("-")) {
      return {
        kind: "reject",
        message: `test:live does not accept ${argument}. ${LIVE_COORDINATOR_USAGE}`,
      };
    }
    return {
      kind: "reject",
      message: `test:live does not accept positional arguments (${argument}). ${LIVE_COORDINATOR_USAGE}`,
    };
  }

  return { kind: "run" };
};

export const resolveLiveCoordinatorExitCode = (outcomes: readonly LiveStepOutcome[]): number =>
  outcomes.some((outcome) => outcome.exitCode !== 0) ? 1 : 0;

const createDeadlineError = (deadlineMs: number): Error => {
  const error = new Error(`live coordinator deadline of ${deadlineMs}ms exceeded`);
  error.name = "LiveCoordinatorDeadlineError";
  return error;
};

export interface RunStepWithDeadlineInput {
  step: LiveCoordinatorStep;
  runStep: (step: LiveCoordinatorStep) => Promise<number>;
  cancelStep?: (step: LiveCoordinatorStep) => void | Promise<void>;
  remainingMs: number;
  deadlineMs: number;
  cancellationGraceMs?: number;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

/**
 * Race a step against the remaining overall budget.
 * When the budget elapses, cancel the step (if supported) and fail it instead of waiting forever.
 */
export const runStepWithDeadline = async (input: RunStepWithDeadlineInput): Promise<number> => {
  const remainingMs = Math.max(0, input.remainingMs);
  const runBudgetMs = Math.max(0, remainingMs - (input.cancellationGraceMs ?? 0));
  if (runBudgetMs === 0) {
    throw createDeadlineError(input.deadlineMs);
  }
  let timeoutId: NodeJS.Timeout | undefined;
  let settled = false;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = input.setTimeout(() => {
      if (settled) {
        return;
      }
      reject(createDeadlineError(input.deadlineMs));
    }, runBudgetMs);
  });

  try {
    const exitCode = await Promise.race([input.runStep(input.step), timeoutPromise]);
    settled = true;
    return exitCode;
  } catch (error) {
    settled = true;
    if (error instanceof Error && error.name === "LiveCoordinatorDeadlineError") {
      try {
        await input.cancelStep?.(input.step);
      } catch {
        // Cancellation is best-effort; the deadline failure is authoritative.
      }
    }
    throw error;
  } finally {
    if (timeoutId !== undefined) {
      input.clearTimeout(timeoutId);
    }
  }
};

export interface RunLiveCoordinatorSequenceInput {
  steps: readonly LiveCoordinatorStep[];
  runStep: (step: LiveCoordinatorStep) => Promise<number>;
  cancelStep?: (step: LiveCoordinatorStep) => void | Promise<void>;
  now?: () => number;
  deadlineMs?: number;
  cancellationGraceMs?: number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  onStepStart?: (step: LiveCoordinatorStep) => void;
  onStepEnd?: (outcome: LiveStepOutcome) => void;
}

export const runLiveCoordinatorSequence = async (
  input: RunLiveCoordinatorSequenceInput,
): Promise<LiveStepOutcome[]> => {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const deadlineMs = input.deadlineMs ?? LIVE_COORDINATOR_DEADLINE_MS;
  const setTimeoutFn = input.setTimeout ?? setTimeout;
  const clearTimeoutFn = input.clearTimeout ?? clearTimeout;
  const outcomes: LiveStepOutcome[] = [];

  for (const step of input.steps) {
    const elapsed = now() - startedAt;
    if (elapsed >= deadlineMs) {
      const outcome: LiveStepOutcome = {
        id: step.id,
        label: step.label,
        exitCode: 1,
        durationMs: 0,
        skipped: true,
        errorMessage: `skipped: live coordinator deadline of ${deadlineMs}ms exceeded`,
      };
      outcomes.push(outcome);
      input.onStepEnd?.(outcome);
      continue;
    }

    input.onStepStart?.(step);
    const stepStartedAt = now();
    let exitCode = 1;
    let errorMessage: string | undefined;
    try {
      exitCode = await runStepWithDeadline({
        step,
        runStep: input.runStep,
        cancelStep: input.cancelStep,
        remainingMs: deadlineMs - (now() - startedAt),
        deadlineMs,
        cancellationGraceMs: input.cancellationGraceMs,
        setTimeout: setTimeoutFn,
        clearTimeout: clearTimeoutFn,
      });
    } catch (error) {
      exitCode = 1;
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    const outcome: LiveStepOutcome = {
      id: step.id,
      label: step.label,
      exitCode,
      durationMs: Math.max(0, now() - stepStartedAt),
      errorMessage,
    };
    outcomes.push(outcome);
    input.onStepEnd?.(outcome);
  }

  return outcomes;
};
