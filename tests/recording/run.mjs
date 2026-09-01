#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolvePnpmCli } from "../e2e/runner-layout.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pnpmCli = resolvePnpmCli(process.env.npm_execpath);
const args = process.argv.slice(2);
const mode = args[0] === "desktop" || args[0] === "webui" ? args[0] : "webui";
const env = {
  ...process.env,
  MDCZ_RECORD_CRAWLER: "1",
  MDCZ_RECORD_STAGING:
    process.env.MDCZ_RECORD_STAGING?.trim() || path.join(workspaceRoot, "test-results/recording/staging"),
  MDCZ_RECORD_PUBLISH: process.env.MDCZ_RECORD_PUBLISH?.trim() || path.join(workspaceRoot, "tests/fixtures/crawler"),
};

const run = (command, commandArgs) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: workspaceRoot, env, stdio: "inherit" });
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

console.log("Recording crawler fixtures from whatever items you scrape.");

if (mode === "desktop") {
  console.log("Desktop recording starts the real app. Scrape any items, then stop the process to publish.");
  await runPnpm(["dev:desktop"]);
} else {
  const webui = spawn(
    /\.(?:c?js|mjs)$/iu.test(pnpmCli) ? process.execPath : pnpmCli,
    /\.(?:c?js|mjs)$/iu.test(pnpmCli) ? [pnpmCli, "dev:webui"] : ["dev:webui"],
    { cwd: workspaceRoot, env, stdio: "inherit" },
  );
  const shutdownWebui = () => {
    if (webui.exitCode === null) webui.kill("SIGTERM");
  };
  process.once("SIGINT", shutdownWebui);
  process.once("SIGTERM", shutdownWebui);
  try {
    await waitForUrl("http://127.0.0.1:5173");
    await runPnpm(["exec", "playwright", "codegen", "http://127.0.0.1:5173"]);
  } finally {
    shutdownWebui();
  }
}
