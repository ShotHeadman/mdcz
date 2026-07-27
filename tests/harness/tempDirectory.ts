import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempDirectoryHarness {
  cleanup(): Promise<void>;
  path: string;
}

const normalizePrefix = (prefix: string): string => {
  const normalized = prefix.trim().replaceAll(/[^a-zA-Z0-9_-]+/g, "-");
  return normalized || "test";
};

export const createTempDirectory = async (prefix = "test"): Promise<TempDirectoryHarness> => {
  const path = await mkdtemp(join(tmpdir(), `mdcz-${normalizePrefix(prefix)}-`));
  let cleaned = false;

  return {
    path,
    cleanup: async () => {
      if (cleaned) {
        return;
      }

      await rm(path, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 50,
      });
      cleaned = true;
    },
  };
};
