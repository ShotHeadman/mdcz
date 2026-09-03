import type { BuildServerOptions } from "./app";
import { buildServer } from "./app";
import { parseHost, parsePort } from "./config";

export const startServer = async (
  options: BuildServerOptions = {},
  finalize: () => Promise<void> = async () => undefined,
): Promise<void> => {
  const port = parsePort(process.env.PORT);
  const host = parseHost(process.env.MDCZ_HOST);
  const { fastify } = buildServer(options);
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (): Promise<void> => {
    shutdownPromise ??= (async () => {
      try {
        await fastify.close();
      } finally {
        await finalize();
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

  await fastify.listen({ host, port });
  console.log(`MDCz server listening on http://${host}:${port}`);
};
