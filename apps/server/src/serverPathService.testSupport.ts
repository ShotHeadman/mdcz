import { defaultConfiguration } from "@mdcz/shared/config";
import type { ServerConfigService } from "./services/configService";
import type { MediaRootService } from "./services/mediaRootService";

const testTimestamp = "2026-01-01T00:00:00.000Z";

export const createFakeMediaRoots = (hostPath: string): MediaRootService =>
  ({
    list: async () => ({
      roots: [
        {
          id: "root",
          displayName: "Media",
          hostPath,
          rootType: "mounted-filesystem",
          enabled: true,
          deleted: false,
          createdAt: testTimestamp,
          updatedAt: testTimestamp,
        },
      ],
    }),
  }) as MediaRootService;

export const createFakeConfig = (mediaPath = ""): ServerConfigService =>
  ({
    get: async () => ({
      ...defaultConfiguration,
      paths: {
        ...defaultConfiguration.paths,
        mediaPath,
      },
    }),
  }) as ServerConfigService;
