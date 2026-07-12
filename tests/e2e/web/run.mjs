import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const runtimeRoot = path.join(workspaceRoot, ".tmp", "e2e-web");
const mediaDir = path.join(runtimeRoot, "media");
const desktopRuntimeRoot = path.join(workspaceRoot, ".tmp", "e2e-desktop");
const desktopUserDataDir = path.join(desktopRuntimeRoot, "user-data");
const resultDir = path.join(workspaceRoot, "test-results");
const serverLogPath = path.join(resultDir, "web-e2e-server.log");
const host = "127.0.0.1";
const pnpmCli = process.env.npm_execpath;
const rawPlaywrightArgs = process.argv.slice(2);
const playwrightArgs = rawPlaywrightArgs[0] === "--" ? rawPlaywrightArgs.slice(1) : rawPlaywrightArgs;

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
  if (!pnpmCli) {
    throw new Error("npm_execpath is required to run pnpm from the Web E2E harness");
  }
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

await rm(runtimeRoot, { recursive: true, force: true });
await rm(desktopRuntimeRoot, { recursive: true, force: true });
await rm(path.join(workspaceRoot, "playwright-report"), { recursive: true, force: true });
await rm(path.join(resultDir, "playwright-web"), { recursive: true, force: true });
await rm(path.join(resultDir, "playwright"), { recursive: true, force: true });
await mkdir(mediaDir, { recursive: true });
await mkdir(path.join(mediaDir, "incoming"), { recursive: true });
await mkdir(desktopUserDataDir, { recursive: true });
await mkdir(resultDir, { recursive: true });
await writeFile(path.join(mediaDir, "incoming", "MDCZ-001.mp4"), "deterministic e2e media fixture", "utf8");
await writeFile(serverLogPath, "", "utf8");

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
      MDCZ_HOME: runtimeRoot,
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
      MDCZ_E2E_BASE_URL: baseURL,
      MDCZ_E2E_DESKTOP_USER_DATA_DIR: desktopUserDataDir,
      MDCZ_E2E_MEDIA_DIR: mediaDir,
    },
  });
} catch (error) {
  process.exitCode = 1;
  console.error(error);
} finally {
  await stopServer(server);
  await writeFile(serverLogPath, serverLogs.join(""), "utf8");
}
