import { buildServer } from "./app";
import { parsePort } from "./config";

const startServer = async (): Promise<void> => {
  const port = parsePort(process.env.PORT);
  const { fastify } = buildServer();

  const shutdown = async (): Promise<void> => {
    await fastify.close();
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  await fastify.listen({
    host: "127.0.0.1",
    port,
  });

  console.log(`MDCz server listening on http://127.0.0.1:${port}`);
};

void startServer();
