import type { DesktopPersistenceService } from "@main/services/persistence";
import { ConfiguredMediaRootService } from "@mdcz/runtime/library";

export const createDesktopMediaRootService = (
  persistenceService: DesktopPersistenceService,
): ConfiguredMediaRootService =>
  new ConfiguredMediaRootService({
    ensurePath: async (hostPath, displayName) => {
      const state = await persistenceService.getState();
      return await state.repositories.mediaRoots.ensurePath(hostPath, displayName);
    },
    list: async () => {
      const state = await persistenceService.getState();
      return await state.repositories.mediaRoots.list();
    },
    get: async (id) => {
      const state = await persistenceService.getState();
      return await state.repositories.mediaRoots.get(id);
    },
  });
