import { existsSync } from "node:fs";
import path from "node:path";
import type { NetworkClientOptions } from "./NetworkClient";
import { NetworkFixtureClient } from "./NetworkFixtureClient";

const findWorkspaceRoot = (start: string): string => {
  for (let directory = path.resolve(start); ; directory = path.dirname(directory)) {
    if (existsSync(path.join(directory, "pnpm-workspace.yaml"))) return directory;
    if (path.dirname(directory) === directory) throw new Error(`No pnpm workspace above ${start}`);
  }
};

/**
 * Dev apps scrape online and record every movie to `.tmp/network-recordings`; `MDCZ_NETWORK=replay` replays
 * those recordings, then the committed test recordings, without touching the network.
 */
export const createDevNetworkClient = (
  options: NetworkClientOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): NetworkFixtureClient => {
  const mode = env.MDCZ_NETWORK?.trim() || "record";
  if (mode !== "record" && mode !== "replay") {
    throw new Error(`MDCZ_NETWORK must be record or replay, got ${mode}`);
  }
  const delayMs = Number(env.MDCZ_REPLAY_DELAY_MS ?? 0);
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error(`MDCZ_REPLAY_DELAY_MS must be a non-negative number, got ${env.MDCZ_REPLAY_DELAY_MS}`);
  }
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  const recordRoot = path.join(workspaceRoot, ".tmp", "network-recordings");
  return new NetworkFixtureClient({
    recordRoot,
    replayRoots: [recordRoot, path.join(workspaceRoot, "tests", "fixtures", "network")],
    mode: () => mode,
    autosave: true,
    allowUnscopedLive: mode === "record",
    mockMediaRoot: path.join(workspaceRoot, "tests", "fixtures", "mock-media"),
    delayMs,
    network: options,
  });
};
