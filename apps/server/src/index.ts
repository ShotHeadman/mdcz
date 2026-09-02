import { finalizeCrawlerFixtures } from "@mdcz/runtime/network";
import { buildServer } from "./app";
import { parseHost, parsePort } from "./config";

const startServer = async (): Promise<void> => {
  const port = parsePort(process.env.PORT);
  const host = parseHost(process.env.MDCZ_HOST);
  const { fastify } = buildServer();
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (): Promise<void> => {
    shutdownPromise ??= (async () => {
      try {
        await fastify.close();
      } finally {
        await finalizeCrawlerFixtures();
      }
    })();
    return shutdownPromise;
  };

  const shutdownForSignal = (): void => {
    void shutdown().then(
      () => process.exit(0),
      (error) => {
        console.error(error);
        process.exit(1);
      },
    );
  };

  process.once("SIGINT", shutdownForSignal);
  process.once("SIGTERM", shutdownForSignal);

  await fastify.listen({
    host,
    port,
  });

  console.log(`MDCz server listening on http://${host}:${port}`);
};

void startServer();
