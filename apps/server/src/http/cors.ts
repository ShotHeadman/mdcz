import type { FastifyReply, FastifyRequest } from "fastify";

const allowedCorsOrigins: Record<string, true> = {
  "http://localhost:5173": true,
  "http://localhost:5174": true,
  "http://127.0.0.1:5173": true,
  "http://127.0.0.1:5174": true,
};

const isAllowedDevOrigin = (origin: string, requestHost: string | undefined): boolean => {
  if (!requestHost) {
    return false;
  }

  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(`http://${requestHost}`);
    return (
      originUrl.protocol === "http:" &&
      (originUrl.port === "5173" || originUrl.port === "5174") &&
      originUrl.hostname === requestUrl.hostname
    );
  } catch {
    return false;
  }
};

export const buildCorsHeaders = (origin: string | undefined, requestHost?: string): Record<string, string> => {
  if (!origin || (!Object.hasOwn(allowedCorsOrigins, origin) && !isAllowedDevOrigin(origin, requestHost))) {
    return {};
  }

  return {
    "access-control-allow-origin": origin,
    vary: "Origin",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
  };
};

export const applyCorsHeaders = (request: FastifyRequest, reply: FastifyReply): void => {
  for (const [header, value] of Object.entries(buildCorsHeaders(request.headers.origin, request.headers.host))) {
    reply.header(header, value);
  }
};
