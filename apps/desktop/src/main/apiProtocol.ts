import { Readable } from "node:stream";
import { net, protocol } from "electron";
import type { FastifyInstance } from "fastify";
import { API_SCHEME, isTrustedRendererUrl } from "./rendererTrust";

const API_PATH = /^\/(?:(?:trpc|api|events)(?:\/|$)|health$|ready$)/u;
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/** Must run before `app.whenReady()`. */
export const registerApiScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: API_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ]);
};

/** `'self'` is the API scheme, so it covers the API, the task event stream and library assets. */
export const buildContentSecurityPolicy = (devServerUrl?: string): string => {
  const connectSources = ["'self'"];
  // Vite's HMR socket goes straight to its dev server.
  if (devServerUrl) connectSources.push(new URL(devServerUrl).origin.replace(/^http/u, "ws"));
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "script-src 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "img-src 'self' data: blob: http: https:",
    "media-src 'self' blob: http: https:",
  ].join("; ");
};

/**
 * Answers every request of the window from the in-process server, the web app's pages included. In development
 * the pages come from web's Vite server instead, through the same scheme, so the page stays same-origin with the API.
 */
export const createApiRequestHandler = (fastify: FastifyInstance, devServerUrl?: string) => {
  const contentSecurityPolicy = buildContentSecurityPolicy(devServerUrl);
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    if (origin && !isTrustedRendererUrl(origin)) return new Response(null, { status: 403 });
    const url = new URL(request.url);
    if (devServerUrl && !API_PATH.test(url.pathname)) {
      const forwarded = new Headers(request.headers);
      // Module scripts carry the page's origin, which would turn this hop into a CORS request Vite refuses.
      forwarded.delete("origin");
      const page = await net.fetch(new URL(`${url.pathname}${url.search}`, devServerUrl).href, { headers: forwarded });
      const headers = new Headers(page.headers);
      if (headers.get("content-type")?.startsWith("text/html"))
        headers.set("content-security-policy", contentSecurityPolicy);
      return new Response(page.body, { status: page.status, headers });
    }

    const response = await fastify.inject({
      method: request.method as "GET",
      url: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(request.headers),
      body: request.body ? Buffer.from(await request.arrayBuffer()) : undefined,
      payloadAsStream: true,
    });
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
    }
    if (headers.get("content-type")?.startsWith("text/html"))
      headers.set("content-security-policy", contentSecurityPolicy);
    const payload = response.stream();
    if (NULL_BODY_STATUSES.has(response.statusCode)) {
      payload.destroy();
      return new Response(null, { status: response.statusCode, headers });
    }
    // A cancelled body (a seek, a new `src`, a closed EventSource) must end the server's response as well, or the
    // file stream or event subscription behind it stays open.
    payload.once("close", () => {
      if (!payload.readableEnded) response.raw.res.destroy();
    });
    return new Response(Readable.toWeb(payload) as ReadableStream<Uint8Array>, {
      status: response.statusCode,
      headers,
    });
  };
};
