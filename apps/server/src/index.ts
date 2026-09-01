import { finalizeCrawlerRecording } from "@mdcz/runtime/network";
import { buildServer } from "./app";
import { parseHost, parsePort } from "./config";

const startServer = async (): Promise<void> => {
  const port = parsePort(process.env.PORT);
  const host = parseHost(process.env.MDCZ_HOST);
  const { fastify } = buildServer();

  const shutdown = async (): Promise<void> => {
    await finalizeCrawlerRecording();
    await fastify.close();
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  await fastify.listen({
    host,
    port,
  });

  console.log(`MDCz server listening on http://${host}:${port}`);
};

void startServer();
