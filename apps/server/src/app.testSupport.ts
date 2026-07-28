import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { MaintenanceRuntime } from "@mdcz/runtime/maintenance";
import {
  type AggregationResult,
  type MountedRootScrapeAggregationService,
  MountedRootScrapeRuntime,
} from "@mdcz/runtime/scrape";
import type { Configuration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { FastifyInstance } from "fastify";
import { expect } from "vitest";
import { createTempDirectory, type TempDirectoryHarness } from "../../../tests/harness/tempDirectory";
import { buildServer, type ServerApp } from "./app";
import { AuthService } from "./services/authService";
import { ServerConfigService } from "./services/configService";
import { MaintenanceService } from "./services/maintenanceService";
import { MediaRootService } from "./services/mediaRootService";
import { ServerPersistenceService } from "./services/persistenceService";
import type { RuntimeActionService } from "./services/runtimeActionService";
import { ScrapeService } from "./services/scrapeService";
import { createTaskEventBus } from "./taskEvents";

export interface TestServerOptions {
  environmentPassword?: string;
  automationWebhook?: {
    secret?: string;
    url?: string;
  };
  runtimeActions?: RuntimeActionService;
  scrapeAggregation?: MountedRootScrapeAggregationService;
  createMaintenanceRuntime?: (config: ServerConfigService) => MaintenanceRuntime;
}

export interface LocalHttpServer {
  close: () => Promise<void>;
  port: number;
  url: string;
}

export interface TestAggregationOptions {
  actorPhotoPath?: string;
  director?: string;
  titlePrefix?: string;
  titleZhPrefix?: string;
  trailerUrl?: string;
  trailerSourceUrl?: string;
}

const activeServers = new Map<ServerApp, TempDirectoryHarness>();
const activeTempRoots = new Set<TempDirectoryHarness>();
const activeLocalServers = new Set<LocalHttpServer>();

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
      auth:
        options.environmentPassword === undefined
          ? undefined
          : new AuthService(config.runtimePaths, options.environmentPassword),
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
      maintenance: options.createMaintenanceRuntime
        ? new MaintenanceService(persistence, mediaRoots, config, taskEvents, options.createMaintenanceRuntime(config))
        : undefined,
    },
  });

  activeServers.set(app, directory);
  return app;
};

/** Isolated host directory tracked for idempotent suite cleanup. */
export const createTempRoot = async (prefix: string): Promise<string> => {
  const directory = await createTempDirectory(prefix);
  activeTempRoots.add(directory);
  return directory.path;
};

export const loginAsAdmin = async (fastify: FastifyInstance, password = "admin"): Promise<string> => {
  const response = await fastify.inject({
    method: "POST",
    url: "/trpc/auth.login",
    payload: { password },
  });
  expect(response.statusCode).toBe(200);
  return response.json().result.data.token as string;
};

export const waitForTaskStatus = async (
  fastify: FastifyInstance,
  token: string,
  taskId: string,
  status: string,
): Promise<void> => {
  await expect
    .poll(async () => {
      const detailResponse = await fastify.inject({
        method: "GET",
        url: `/trpc/tasks.detail?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
        headers: { authorization: `Bearer ${token}` },
      });
      return detailResponse.json().result.data.task.status;
    })
    .toBe(status);
};

export const startLocalHttpServer = async (
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<LocalHttpServer> => {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected local HTTP test server address");
  }

  const localServer: LocalHttpServer = {
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          activeLocalServers.delete(localServer);
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };

  activeLocalServers.add(localServer);
  return localServer;
};

export const createTestPngBytes = (): Buffer => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8BQDwAFgwJ/lUOh9QAAAABJRU5ErkJggg==",
    "base64",
  );
  return Buffer.concat([png, Buffer.alloc(9000)]);
};

export const startTestImageServer = async (): Promise<LocalHttpServer> =>
  await startLocalHttpServer((_request, response) => {
    response.writeHead(200, { "content-type": "image/png" });
    response.end(createTestPngBytes());
  });

export const createTestAggregation = (
  imageUrl: string,
  options: TestAggregationOptions = {},
): MountedRootScrapeAggregationService => ({
  async aggregate(number: string, _configuration: Configuration): Promise<AggregationResult> {
    return {
      data: {
        title: `${options.titlePrefix ?? "Runtime Title"} ${number}`,
        title_zh: `${options.titleZhPrefix ?? "运行时标题"} ${number}`,
        number,
        actors: ["Actor A"],
        actor_profiles: options.actorPhotoPath ? [{ name: "Actor A", photo_url: options.actorPhotoPath }] : undefined,
        genres: ["Drama"],
        studio: "Runtime Studio",
        director: options.director,
        trailer_url: options.trailerUrl,
        trailer_source_url: options.trailerSourceUrl,
        plot: "Runtime plot",
        release_date: "2024-01-15",
        thumb_url: imageUrl,
        poster_url: imageUrl,
        fanart_url: imageUrl,
        scene_images: [],
        website: Website.JAVDB,
      },
      sources: {
        title: Website.JAVDB,
        thumb_url: Website.JAVDB,
        poster_url: Website.JAVDB,
      },
      imageAlternatives: {
        thumb_url: [],
        poster_url: [],
        scene_images: [],
        scene_image_sources: [],
      },
      stats: {
        totalSites: 1,
        successCount: 1,
        failedCount: 0,
        skippedCount: 0,
        siteResults: [{ site: Website.JAVDB, success: true, elapsedMs: 1 }],
        totalElapsedMs: 1,
      },
    };
  },
});

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

const cleanupTempRoots = async (): Promise<void> => {
  const roots = [...activeTempRoots];
  activeTempRoots.clear();
  await Promise.all(roots.map(async (directory) => await directory.cleanup()));
};

const cleanupLocalServers = async (): Promise<void> => {
  const servers = [...activeLocalServers];
  activeLocalServers.clear();
  await Promise.all(
    servers.map(async (server) => {
      try {
        await server.close();
      } catch {
        // Idempotent cleanup: ignore already-closed servers.
      }
    }),
  );
};

/** Closes every tracked Fastify app, local HTTP fixture, and temp root. Safe to call repeatedly. */
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
  await cleanupLocalServers();
  await cleanupTempRoots();
};
