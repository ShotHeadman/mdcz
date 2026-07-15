export declare const LIVE_COORDINATOR_DEADLINE_MS: number;

export declare const LIVE_COORDINATOR_USAGE: string;

export type LiveCoordinatorStepId = "integration-live" | "web-e2e-live" | "desktop-e2e-live";

export type LiveCoordinatorStep = {
  id: LiveCoordinatorStepId;
  label: string;
  command: string;
  args: readonly string[];
};

export type LiveCoordinatorArgDecision = { kind: "run" } | { kind: "reject"; message: string };

export type LiveStepOutcome = {
  id: LiveCoordinatorStepId;
  label: string;
  exitCode: number;
  durationMs: number;
  skipped?: boolean;
  errorMessage?: string;
};

export declare function buildLiveCoordinatorSteps(workspaceRoot: string, nodeExecutable: string): LiveCoordinatorStep[];

export declare function decideLiveCoordinatorArgs(argv: readonly string[]): LiveCoordinatorArgDecision;

export declare function resolveLiveCoordinatorExitCode(outcomes: readonly LiveStepOutcome[]): number;

export declare function runStepWithDeadline(input: {
  step: LiveCoordinatorStep;
  runStep: (step: LiveCoordinatorStep) => Promise<number>;
  cancelStep?: (step: LiveCoordinatorStep) => void | Promise<void>;
  remainingMs: number;
  deadlineMs: number;
  cancellationGraceMs?: number;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}): Promise<number>;

export declare function runLiveCoordinatorSequence(input: {
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
}): Promise<LiveStepOutcome[]>;
