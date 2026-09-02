import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveE2ERunnerLayout, resolvePlaywrightTarget, resolvePnpmCli } from "../runner-layout.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const host = "127.0.0.1";
const pnpmCli = resolvePnpmCli(process.env.npm_execpath);
const rawPlaywrightArgs = process.argv.slice(2);
const normalizedPlaywrightArgs = rawPlaywrightArgs[0] === "--" ? rawPlaywrightArgs.slice(1) : rawPlaywrightArgs;
const liveMode = normalizedPlaywrightArgs.includes("--live");
const fixtureMode = normalizedPlaywrightArgs.includes("--fixture");
if (liveMode && fixtureMode) throw new Error("Choose either --live or --fixture, not both");
const playwrightArgs = normalizedPlaywrightArgs.filter((argument) => argument !== "--live" && argument !== "--fixture");
const workspacePackage = JSON.parse(await readFile(path.join(workspaceRoot, "package.json"), "utf8"));
const appVersion = typeof workspacePackage.version === "string" ? workspacePackage.version : "unknown";

const playwrightTarget = resolvePlaywrightTarget(playwrightArgs);
const isDesktopOnly = playwrightTarget === "desktop-electron";
const layout = resolveE2ERunnerLayout(workspaceRoot, playwrightTarget);
const fixtureEnv = fixtureMode
  ? {
      MDCZ_REPLAY_CRAWLER: "1",
      MDCZ_REPLAY_CRAWLER_FIXTURES: path.join(workspaceRoot, "tests", "fixtures", "crawler"),
      MDCZ_REPLAY_MEDIA_MANIFESTS: path.join(workspaceRoot, "tests", "fixtures", "media"),
      MDCZ_REPLAY_MEDIA_BLOBS: path.join(workspaceRoot, ".test-fixtures", "media"),
    }
  : {};

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: "inherit",
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? signal}`));
    });
  });

const runPnpm = (args, options) => {
  return /\.(?:c?js|mjs)$/iu.test(pnpmCli)
    ? run(process.execPath, [pnpmCli, ...args], options)
    : run(pnpmCli, args, options);
};

const findAvailablePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a Web E2E port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const waitForHealth = async (baseURL, server) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Web E2E server exited before becoming healthy (${server.exitCode})`);
    }
    try {
      const response = await fetch(`${baseURL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // The server process may still be loading native modules or migrations.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${baseURL}/health`);
};

const stopServer = async (server) => {
  if (!server || server.exitCode !== null) {
    return;
  }
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) {
    server.kill("SIGKILL");
  }
};

for (const runtimeRoot of layout.cleanupRuntimeRoots) {
  await rm(runtimeRoot, { recursive: true, force: true });
}
await rm(layout.reportDir, { recursive: true, force: true });
await rm(layout.outputDir, { recursive: true, force: true });
await mkdir(layout.mediaDir, { recursive: true });
await mkdir(layout.desktopUserDataDir, { recursive: true });
await mkdir(layout.resultDir, { recursive: true });
if (!isDesktopOnly) {
  await mkdir(path.join(layout.mediaDir, "incoming"), { recursive: true });
  await writeFile(path.join(layout.mediaDir, "incoming", "MDCZ-001.mp4"), Buffer.alloc(0));
}
await writeFile(layout.serverLogPath, "", "utf8");

let server;
const serverLogs = [];
try {
  await runPnpm(["build:webui"]);
  await runPnpm(["build:desktop"]);

  const port = await findAvailablePort();
  const baseURL = `http://${host}:${port}`;
  server = spawn(process.execPath, ["apps/server/dist/server.js"], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      ...fixtureEnv,
      MDCZ_HOME: layout.serverRuntimeRoot,
      MDCZ_HOST: host,
      MDCZ_WEB_DIST_DIR: path.join(workspaceRoot, "apps", "server", "dist", "web"),
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = (chunk) => {
    const text = chunk.toString();
    serverLogs.push(text);
    process.stdout.write(text);
  };
  server.stdout.on("data", capture);
  server.stderr.on("data", capture);

  await waitForHealth(baseURL, server);
  await runPnpm(["exec", "playwright", "test", "--config", "playwright.config.ts", ...playwrightArgs], {
    env: {
      ...process.env,
      ...fixtureEnv,
      MDCZ_E2E_BASE_URL: baseURL,
      MDCZ_E2E_LIVE: liveMode || fixtureMode ? "1" : "0",
      MDCZ_E2E_FIXTURE: fixtureMode ? "1" : "0",
      MDCZ_E2E_ADMIN_PASSWORD: "mdcz-e2e-admin-password",
      MDCZ_APP_VERSION: appVersion,
      MDCZ_E2E_DESKTOP_USER_DATA_DIR: layout.desktopUserDataDir,
      MDCZ_E2E_MEDIA_DIR: layout.mediaDir,
      MDCZ_E2E_OUTPUT_DIR: layout.outputDir,
      MDCZ_E2E_REPORT_DIR: layout.reportDir,
    },
  });
} catch (error) {
  process.exitCode = 1;
  console.error(error);
} finally {
  await stopServer(server);
  await writeFile(layout.serverLogPath, serverLogs.join(""), "utf8");
}
