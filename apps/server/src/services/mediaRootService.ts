import { ConfiguredMediaRootService, type MediaRootRegistryPort, toMediaRootDto } from "@mdcz/runtime/library";
import type { ServerPersistenceService } from "./persistenceService";

export { toMediaRootDto };

export class MediaRootService extends ConfiguredMediaRootService {
  constructor(persistence: ServerPersistenceService) {
    super({
      ensurePath: async (hostPath, displayName) => {
        const state = await persistence.getState();
        return await state.repositories.mediaRoots.ensurePath(hostPath, displayName);
      },
      list: async () => {
        const state = await persistence.getState();
        return await state.repositories.mediaRoots.list();
      },
      get: async (id) => {
        const state = await persistence.getState();
        return await state.repositories.mediaRoots.get(id);
      },
    } satisfies MediaRootRegistryPort);
  }
}
