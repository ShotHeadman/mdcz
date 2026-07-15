import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { LiveCoordinatorStep } from "./live-coordinator.mjs";

export declare const LIVE_CHILD_TERMINATION_GRACE_MS: number;

export interface LiveStepProcessRunner {
  spawnStep(step: LiveCoordinatorStep): Promise<number>;
  cancelStep(step: LiveCoordinatorStep): Promise<void>;
  cancelAll(): Promise<void>;
  activeCount(): number;
}

export declare function createLiveStepProcessRunner(options?: {
  workspaceRoot?: string;
  env?: NodeJS.ProcessEnv;
  spawnProcess?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  terminateProcessTree?: (child: ChildProcess, signal: "SIGTERM" | "SIGKILL") => void;
  terminationGraceMs?: number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}): LiveStepProcessRunner;
