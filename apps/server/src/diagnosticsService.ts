import type { DiagnosticsSummaryResponse } from "@mdcz/shared/serverDtos";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";

export class DiagnosticsService {
  constructor(
    private readonly persistence: ServerPersistenceService,
    private readonly mediaRoots: MediaRootService,
  ) {}

  async summary(): Promise<DiagnosticsSummaryResponse> {
    const checkedAt = new Date().toISOString();
    const persistence = {
      id: "persistence",
      label: "持久化",
      ok: this.persistence.initialized,
      message: this.persistence.databasePath,
      checkedAt,
    };
    const roots = await this.mediaRoots.list();
    const rootChecks = await Promise.all(
      roots.roots.map(async (root) => {
        if (!root.enabled) {
          return {
            id: `media-root:${root.id}`,
            label: root.displayName,
            ok: false,
            message: "媒体目录已停用",
            checkedAt,
          };
        }

        const availability = await this.mediaRoots.availability(root.id);
        return {
          id: `media-root:${root.id}`,
          label: root.displayName,
          ok: availability.availability.available,
          message: availability.availability.error ?? root.hostPath,
          checkedAt: availability.availability.checkedAt,
        };
      }),
    );
    return { checks: [persistence, ...rootChecks] };
  }
}
