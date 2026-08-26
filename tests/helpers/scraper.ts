import { type Configuration, configManager } from "@main/services/config";
import { vi } from "vitest";

const getByPath = (target: Record<string, unknown>, path: string): unknown => {
  let cursor: unknown = target;
  for (const segment of path.split(".")) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || !(segment in cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
};

export const mockConfigManager = (config: Configuration): void => {
  const ensureLoadedSpy = vi.isMockFunction(configManager.ensureLoaded)
    ? vi.mocked(configManager.ensureLoaded)
    : vi.spyOn(configManager, "ensureLoaded");
  ensureLoadedSpy.mockResolvedValue(undefined);

  const getSpy = vi.isMockFunction(configManager.get) ? vi.mocked(configManager.get) : vi.spyOn(configManager, "get");
  getSpy.mockImplementation(async (path?: string) => {
    if (!path) {
      return config;
    }

    return getByPath(config as unknown as Record<string, unknown>, path);
  });
};
