#!/usr/bin/env node
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [mode, app] = process.argv.slice(2);
if ((mode !== "record" && mode !== "replay") || (app !== "webui" && app !== "desktop")) {
  throw new Error("Usage: run.mjs <record|replay> <webui|desktop>");
}

const fromWorkspace = (value, fallback) => path.resolve(workspaceRoot, value?.trim() || fallback);
const env = {
  ...process.env,
  MDCZ_NETWORK_FIXTURE_MODE: mode,
  MDCZ_NETWORK_FIXTURES_ROOT: fromWorkspace(process.env.MDCZ_NETWORK_FIXTURES_ROOT, "tests/fixtures/network"),
};

if (mode === "replay") {
  env.MDCZ_REPLAY_DELAY_MS = process.env.MDCZ_REPLAY_DELAY_MS?.trim() || "500";
} else {
  const stagingRoot = fromWorkspace(process.env.MDCZ_NETWORK_FIXTURE_STAGING, "test-results/recording/network");
  const relative = path.relative(workspaceRoot, stagingRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Recording staging must stay inside the workspace: ${stagingRoot}`);
  }
  await rm(stagingRoot, { recursive: true, force: true });
  env.MDCZ_NETWORK_FIXTURE_STAGING = stagingRoot;
  if (app === "desktop") {
    // A throwaway profile keeps the recording's config and library out of the developer's own Desktop data.
    const userDataDir = fromWorkspace(
      process.env.MDCZ_RECORD_DESKTOP_USER_DATA_DIR,
      ".tmp/recording-desktop-user-data",
    );
    env.ELECTRON_CLI_ARGS = JSON.stringify([`--user-data-dir=${userDataDir}`]);
  }
  console.log("Recording network fixtures from whatever items you scrape; quit the app to publish them.");
}

const pnpmCli = process.env.npm_execpath?.trim() || "pnpm";
const target = app === "desktop" ? "dev:desktop" : "dev:webui:fixture";
const [command, commandArgs] = /\.(?:c?js|mjs)$/iu.test(pnpmCli)
  ? [process.execPath, [pnpmCli, target]]
  : [pnpmCli, [target]];
const child = spawn(command, commandArgs, { cwd: workspaceRoot, env, stdio: "inherit" });
const shutdown = () => child.kill("SIGTERM");
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") {
      resolve();
      return;
    }
    reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${code ?? signal}`));
  });
});
