import type { MediaLibraryService } from "@mdcz/runtime/library";
import { defaultConfiguration } from "@mdcz/shared/config";
import type { ServerConfigService } from "./services/configService";
import type { MediaRootService } from "./services/mediaRootService";
import { ServerPathService, type ServerPathServiceOptions } from "./services/serverPathService";

const testTimestamp = "2026-01-01T00:00:00.000Z";

/** A path service whose only known directory is one media root that is also a library's source. */
export const createServerPathService = (hostPath: string, options?: ServerPathServiceOptions): ServerPathService =>
  new ServerPathService(
    {
      list: async () => ({
        roots: [{ id: "root", displayName: "Media", hostPath, createdAt: testTimestamp, updatedAt: testTimestamp }],
      }),
    } as MediaRootService,
    { get: async () => defaultConfiguration } as ServerConfigService,
    { list: async () => [{ sourcePath: hostPath, outputPath: "" }] } as unknown as Pick<MediaLibraryService, "list">,
    options,
  );
