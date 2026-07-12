import { join } from "node:path";
import { type MountedRootScrapeAggregationService, MountedRootScrapeRuntime } from "@mdcz/runtime/scrape";
import { createTempDirectory, type TempDirectoryHarness } from "../../../tests/harness/tempDirectory";
import { buildServer, type ServerApp } from "./app";
import { ServerConfigService } from "./services/configService";
import { MediaRootService } from "./services/mediaRootService";
import { ServerPersistenceService } from "./services/persistenceService";
import type { RuntimeActionService } from "./services/runtimeActionService";
import { ScrapeService } from "./services/scrapeService";
import { createTaskEventBus } from "./taskEvents";

export interface TestServerOptions {
  automationWebhook?: {
    secret?: string;
    url?: string;
  };
  runtimeActions?: RuntimeActionService;
  scrapeAggregation?: MountedRootScrapeAggregationService;
}

const activeServers = new Map<ServerApp, TempDirectoryHarness>();

export const createTestServer = async (options: TestServerOptions = {}): Promise<ServerApp> => {
  const directory = await createTempDirectory("server-app");
  const paths = {
    configDir: join(directory.path, "config"),
    dataDir: join(directory.path, "data"),
    configPath: join(directory.path, "config", "default.toml"),
    databasePath: join(directory.path, "data", "mdcz.sqlite"),
  };
  const config = new ServerConfigService(paths);
  const persistence = new ServerPersistenceService(paths);
  const mediaRoots = new MediaRootService(persistence);
  const taskEvents = createTaskEventBus();
  const app = buildServer({
    serviceOptions: {
      automationWebhook: options.automationWebhook,
    },
    webStaticDir: false,
    services: {
      config,
      mediaRoots,
      persistence,
      runtimeActions: options.runtimeActions,
      taskEvents,
      scrape: options.scrapeAggregation
        ? new ScrapeService(
            persistence,
            mediaRoots,
            config,
            taskEvents,
            new MountedRootScrapeRuntime(config, options.scrapeAggregation),
          )
        : undefined,
    },
  });

  activeServers.set(app, directory);
  return app;
};

export const syncMediaRootFromConfig = async (
  fastify: ServerApp["fastify"],
  token: string,
  hostPath: string,
): Promise<string> => {
  await fastify.inject({
    method: "POST",
    url: "/trpc/config.update",
    headers: { authorization: `Bearer ${token}` },
    payload: { paths: { mediaPath: hostPath } },
  });
  const rootsResponse = await fastify.inject({
    method: "GET",
    url: "/trpc/mediaRoots.list",
    headers: { authorization: `Bearer ${token}` },
  });
  const rootId = rootsResponse
    .json()
    .result.data.roots.find((rootDto: { hostPath: string }) => rootDto.hostPath === hostPath)?.id;

  if (!rootId) {
    throw new Error("Expected paths.mediaPath to create an enabled media root");
  }

  return rootId;
};

export const releaseTestServer = async (app: ServerApp): Promise<void> => {
  const directory = activeServers.get(app);
  activeServers.delete(app);
  await directory?.cleanup();
};

export const closeTestServers = async (): Promise<void> => {
  const servers = [...activeServers.entries()];
  activeServers.clear();

  await Promise.all(
    servers.map(async ([app, directory]) => {
      try {
        await app.fastify.close();
      } finally {
        await directory.cleanup();
      }
    }),
  );
};
