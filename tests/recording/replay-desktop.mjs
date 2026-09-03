#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolvePnpmCli } from "../e2e/runner-layout.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pnpmCli = resolvePnpmCli(process.env.npm_execpath);
const resolveFixtureRoot = (value, fallback) => path.resolve(workspaceRoot, value?.trim() || fallback);
const env = {
  ...process.env,
  MDCZ_NETWORK_FIXTURE_MODE: "replay",
  MDCZ_REPLAY_DELAY_MS: process.env.MDCZ_REPLAY_DELAY_MS?.trim() || "2000",
  MDCZ_NETWORK_FIXTURES_ROOT: resolveFixtureRoot(process.env.MDCZ_NETWORK_FIXTURES_ROOT, "tests/fixtures/network"),
};
const command = /\.(?:c?js|mjs)$/iu.test(pnpmCli) ? process.execPath : pnpmCli;
const args = /\.(?:c?js|mjs)$/iu.test(pnpmCli) ? [pnpmCli, "dev:desktop"] : ["dev:desktop"];
const child = spawn(command, args, { cwd: workspaceRoot, env, stdio: "inherit" });
const shutdown = () => child.kill("SIGTERM");
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? signal}`));
  });
});
