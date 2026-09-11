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
    const deadline = setTimeout(() => {
      console.error("Server shutdown exceeded 25 seconds; interrupted work will be recovered on restart");
      process.exit(1);
    }, 25_000);
    deadline.unref();
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

  try {
    await fastify.listen({ host, port });
  } catch (error) {
    try {
      await shutdown();
    } catch (closeError) {
      throw new AggregateError([error, closeError], "Server startup failed");
    }
    throw error;
  }
  console.log(`MDCz server listening on http://${host}:${port}`);
};
