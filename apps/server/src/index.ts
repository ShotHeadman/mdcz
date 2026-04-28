import { createServer } from "node:http";

import { createRequestHandler } from "./http";

export const DEFAULT_SERVER_PORT = 3838;

const parsePort = (value: string | undefined): number => {
  if (!value) {
    return DEFAULT_SERVER_PORT;
  }

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return port;
};

const port = parsePort(process.env.PORT);
const server = createServer(createRequestHandler());

server.listen(port, () => {
  console.log(`MDCz server skeleton listening on http://localhost:${port}`);
});
