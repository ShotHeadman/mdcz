import type { NetworkClientOptions } from "./NetworkClient";
import { NetworkRecordClient, NetworkReplayClient } from "./NetworkFixtureClient";

interface NetworkFixtureSettings {
  mode: "record" | "replay";
  root: string;
  stagingRoot: string;
  delayMs: number;
}

let recorder: NetworkRecordClient | undefined;

const readSettings = (env: NodeJS.ProcessEnv): NetworkFixtureSettings => {
  const mode = env.MDCZ_NETWORK_FIXTURE_MODE?.trim();
  if (mode !== "record" && mode !== "replay") {
    throw new Error(`MDCZ_NETWORK_FIXTURE_MODE must be record or replay, got ${mode || "unset"}`);
  }
  const delayMs = Number(env.MDCZ_REPLAY_DELAY_MS ?? 0);
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error(`MDCZ_REPLAY_DELAY_MS must be a non-negative number, got ${env.MDCZ_REPLAY_DELAY_MS}`);
  }
  return {
    mode,
    root: env.MDCZ_NETWORK_FIXTURES_ROOT || "tests/fixtures/network",
    stagingRoot: env.MDCZ_NETWORK_FIXTURE_STAGING || "test-results/recording/network",
    delayMs,
  };
};

export const createNetworkFixtureClient = (
  options: NetworkClientOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): NetworkRecordClient | NetworkReplayClient => {
  const fixture = readSettings(env);
  if (fixture.mode === "record") {
    const client = new NetworkRecordClient({
      stagingRoot: fixture.stagingRoot,
      publishRoot: fixture.root,
      network: options,
    });
    if (env === process.env) recorder = client;
    return client;
  }
  return new NetworkReplayClient({ fixturesRoot: fixture.root, delayMs: fixture.delayMs, network: options });
};

export const finalizeNetworkFixtures = async (): Promise<void> => {
  await recorder?.finalize();
};
