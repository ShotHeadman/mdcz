#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolvePnpmCli } from "../e2e/runner-layout.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pnpmCli = resolvePnpmCli(process.env.npm_execpath);
const args = process.argv.slice(2);
const mode = args[0] === "desktop" || args[0] === "webui" ? args[0] : "webui";
const journeyOutput = path.resolve(
  workspaceRoot,
  process.env.MDCZ_RECORD_JOURNEY_OUTPUT?.trim() ||
    path.join("tests", "recording", "journeys", "web-representative-batch.spec.ts"),
);
const env = {
  ...process.env,
  MDCZ_NETWORK_FIXTURE_MODE: "record",
  MDCZ_NETWORK_FIXTURE_STAGING:
    process.env.MDCZ_NETWORK_FIXTURE_STAGING?.trim() || path.join(workspaceRoot, "test-results/recording/network"),
  MDCZ_NETWORK_FIXTURES_ROOT:
    process.env.MDCZ_NETWORK_FIXTURES_ROOT?.trim() || path.join(workspaceRoot, "tests/fixtures/network"),
};

const resolveStagingRoot = (value) => {
  const resolved = path.resolve(workspaceRoot, value);
  const relative = path.relative(workspaceRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Recording staging must stay inside the workspace: ${resolved}`);
  }
  return resolved;
};

const run = (command, commandArgs, childEnv = env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: workspaceRoot, env: childEnv, stdio: "inherit" });
    const shutdown = () => child.kill("SIGTERM");
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.removeListener("SIGINT", shutdown);
      process.removeListener("SIGTERM", shutdown);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${code ?? signal}`));
    });
  });

const runPnpm = (commandArgs) =>
  /\.(?:c?js|mjs)$/iu.test(pnpmCli) ? run(process.execPath, [pnpmCli, ...commandArgs]) : run(pnpmCli, commandArgs);

const waitForUrl = async (url, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok || response.status === 404) return;
    } catch {
      // Dev servers are still binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
};

console.log("Recording network fixtures from whatever items you scrape.");
await rm(resolveStagingRoot(env.MDCZ_NETWORK_FIXTURE_STAGING), { recursive: true, force: true });

if (mode === "desktop") {
  console.log("Desktop recording starts the product through the Electron Playwright harness.");
  await runPnpm(["build:desktop"]);
  await run(process.execPath, ["tests/recording/desktop.mjs"], { ...env, PWDEBUG: "1" });
} else {
  await mkdir(path.dirname(journeyOutput), { recursive: true });
  const webui = spawn(
    /\.(?:c?js|mjs)$/iu.test(pnpmCli) ? process.execPath : pnpmCli,
    /\.(?:c?js|mjs)$/iu.test(pnpmCli) ? [pnpmCli, "dev:webui:fixture"] : ["dev:webui:fixture"],
    { cwd: workspaceRoot, env, stdio: "inherit" },
  );
  const shutdownWebui = () => {
    if (webui.exitCode === null) webui.kill("SIGTERM");
  };
  const webuiExited = new Promise((resolve, reject) => {
    webui.once("error", reject);
    webui.once("exit", resolve);
  });
  process.once("SIGINT", shutdownWebui);
  process.once("SIGTERM", shutdownWebui);
  try {
    await waitForUrl("http://127.0.0.1:5173");
    await runPnpm(["exec", "playwright", "codegen", "--output", journeyOutput, "http://127.0.0.1:5173"]);
  } finally {
    shutdownWebui();
    await webuiExited;
    process.removeListener("SIGINT", shutdownWebui);
    process.removeListener("SIGTERM", shutdownWebui);
  }
}

console.log("Recording published");
if (mode === "webui") console.log(`Saved the Web Playwright journey to ${journeyOutput}`);
