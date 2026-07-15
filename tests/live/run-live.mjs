import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  buildLiveCoordinatorSteps,
  decideLiveCoordinatorArgs,
  LIVE_COORDINATOR_DEADLINE_MS,
  resolveLiveCoordinatorExitCode,
  runLiveCoordinatorSequence,
} from "./live-coordinator.mjs";
import { createLiveStepProcessRunner, LIVE_CHILD_TERMINATION_GRACE_MS } from "./process-runner.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const processRunner = createLiveStepProcessRunner({ workspaceRoot, env: process.env });

const formatOutcome = (outcome) => {
  const status = outcome.skipped ? "SKIP" : outcome.exitCode === 0 ? "PASS" : "FAIL";
  const detail = outcome.errorMessage ? ` (${outcome.errorMessage})` : "";
  return `  [${status}] ${outcome.label} exit=${outcome.exitCode} durationMs=${outcome.durationMs}${detail}`;
};

const main = async () => {
  const decision = decideLiveCoordinatorArgs(process.argv.slice(2));
  if (decision.kind === "reject") {
    console.error(decision.message);
    return 1;
  }

  const steps = buildLiveCoordinatorSteps(workspaceRoot, process.execPath);
  console.log(
    `test:live starting ${steps.length} isolated steps (deadline ${Math.round(LIVE_COORDINATOR_DEADLINE_MS / 60_000)}m)`,
  );

  const outcomes = await runLiveCoordinatorSequence({
    steps,
    runStep: processRunner.spawnStep,
    cancelStep: processRunner.cancelStep,
    deadlineMs: LIVE_COORDINATOR_DEADLINE_MS,
    cancellationGraceMs: LIVE_CHILD_TERMINATION_GRACE_MS,
    onStepStart: (step) => {
      console.log(`\n==> ${step.label}`);
      console.log(`$ ${step.command} ${step.args.join(" ")}`);
    },
    onStepEnd: (outcome) => {
      console.log(formatOutcome(outcome));
    },
  });

  console.log("\ntest:live summary:");
  for (const outcome of outcomes) {
    console.log(formatOutcome(outcome));
  }

  return resolveLiveCoordinatorExitCode(outcomes);
};

let shuttingDown = false;
const shutdownForSignal = (exitCode) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  void processRunner.cancelAll().finally(() => {
    process.exit(exitCode);
  });
};

process.once("SIGINT", () => shutdownForSignal(130));
process.once("SIGTERM", () => shutdownForSignal(143));

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  console.error(error);
} finally {
  await processRunner.cancelAll();
}
process.exitCode = exitCode;
