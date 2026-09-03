import { setTimeout as sleep } from "node:timers/promises";

export const waitForReplayDelay = async (delayMs: number, signal?: AbortSignal): Promise<void> => {
  if (delayMs === 0) return;
  await sleep(delayMs, undefined, signal ? { signal } : undefined);
};
