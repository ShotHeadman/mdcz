import type { IncomingMessage, ServerResponse } from "node:http";

export interface HealthPayload {
  service: "mdcz-server";
  status: "ok";
  slice: "app-skeleton";
}

export const createHealthPayload = (): HealthPayload => ({
  service: "mdcz-server",
  status: "ok",
  slice: "app-skeleton",
});

const sendJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(body)}\n`);
};

export const createRequestHandler =
  () =>
  (request: IncomingMessage, response: ServerResponse): void => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      sendJson(response, 200, createHealthPayload());
      return;
    }

    sendJson(response, 404, {
      error: "not_found",
    });
  };
