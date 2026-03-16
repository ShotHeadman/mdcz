import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { loggerService } from "@main/services/LoggerService";
import { parseRetryAfterMs } from "@main/utils/http";
import { parseImageDimensions } from "@main/utils/image";
import { type Browser, Impit, type RequestInit as ImpitRequestInit } from "impit";
import { RateLimiter } from "./RateLimiter";

const RETRY_STATUS_CODE = 429;
const RETRY_AFTER_CAP_MS = 15_000;
const RETRYABLE_STATUS_CODES = new Set([408, 500, 502, 503, 504]);
const PROBE_FALLBACK_STATUS_CODES = new Set([403, 405, 501]);
const PROBE_RANGE_HEADER = "bytes=0-0";
const IMAGE_METADATA_PROBE_BYTES = 64 * 1024;
const IMAGE_METADATA_PROBE_RETRY_BYTES = 256 * 1024;
type ImpitResponse = Awaited<ReturnType<Impit["fetch"]>>;
type ProbeMethod = "HEAD" | "GET";
type ProbeOptions = Omit<ImpitRequestInit, "method"> & {
  method?: ProbeMethod;
  captureImageSize?: boolean;
};

export interface NetworkCookieJar {
  getCookieString(url: string): Promise<string> | string;
  setCookie(cookie: string, url: string, cb?: unknown): Promise<void> | void;
}

export interface NetworkSession {
  getText(url: string, init?: Omit<ImpitRequestInit, "method">): Promise<string>;
}

export interface NetworkClientOptions {
  timeoutMs?: number;
  browserImpersonation?: Browser;
  getProxyUrl?: () => string | undefined;
  getTimeoutMs?: () => number | undefined;
  getRetryCount?: () => number | undefined;
  rateLimiter?: RateLimiter;
}

export interface ProbeResult {
  ok: boolean;
  status: number;
  contentLength: number | null;
  resolvedUrl: string;
  width?: number;
  height?: number;
}

interface RequestBehavior {
  allowNonOkResponse?: boolean;
  retryLogPrefix?: string;
}

export class NetworkClient {
  private readonly logger = loggerService.getLogger("NetworkClient");

  private readonly options: Required<Pick<NetworkClientOptions, "timeoutMs" | "browserImpersonation">> &
    Pick<NetworkClientOptions, "getProxyUrl" | "getTimeoutMs" | "getRetryCount">;

  private readonly rateLimiter: RateLimiter;

  constructor(options: NetworkClientOptions = {}) {
    this.options = {
      timeoutMs: options.timeoutMs ?? 30_000,
      browserImpersonation: options.browserImpersonation ?? "chrome142",
      getProxyUrl: options.getProxyUrl,
      getTimeoutMs: options.getTimeoutMs,
      getRetryCount: options.getRetryCount,
    };
    this.rateLimiter = options.rateLimiter ?? new RateLimiter(5);
  }

  setDomainInterval(domain: string, intervalMs: number, intervalCap = 1, concurrency = 1): void {
    this.rateLimiter.setDomainInterval(domain, intervalMs, intervalCap, concurrency);
  }

  setDomainLimit(domain: string, requestsPerSecond: number, concurrency = 1): void {
    this.rateLimiter.setDomainLimit(domain, requestsPerSecond, concurrency);
  }

  async getText(url: string, init: Omit<ImpitRequestInit, "method"> = {}): Promise<string> {
    const response = await this.request(url, {
      ...init,
      method: "GET",
    });

    return response.text();
  }

  async getJson<T>(url: string, init: Omit<ImpitRequestInit, "method"> = {}): Promise<T> {
    const response = await this.request(url, {
      ...init,
      method: "GET",
    });

    return response.json() as Promise<T>;
  }

  async getContent(url: string, init: Omit<ImpitRequestInit, "method"> = {}): Promise<Uint8Array> {
    const response = await this.request(url, {
      ...init,
      method: "GET",
    });

    return response.bytes();
  }

  async postText(url: string, body: string, init: Omit<ImpitRequestInit, "method" | "body"> = {}): Promise<string> {
    const response = await this.request(url, {
      ...init,
      method: "POST",
      body,
    });

    return response.text();
  }

  async postJson<TResponse>(
    url: string,
    payload: unknown,
    init: Omit<ImpitRequestInit, "method" | "body"> = {},
  ): Promise<TResponse> {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");

    const response = await this.request(url, {
      ...init,
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    return response.json() as Promise<TResponse>;
  }

  async postContent(
    url: string,
    body: Uint8Array,
    init: Omit<ImpitRequestInit, "method" | "body"> = {},
  ): Promise<void> {
    await this.request(url, {
      ...init,
      method: "POST",
      body,
    });
  }

  async download(url: string, outputPath: string, init: Omit<ImpitRequestInit, "method"> = {}): Promise<string> {
    const bytes = await this.getContent(url, init);

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, Buffer.from(bytes));

    return outputPath;
  }

  async head(url: string, init: Omit<ImpitRequestInit, "method"> = {}): Promise<{ status: number; ok: boolean }> {
    const { status, ok } = await this.probe(url, init);

    return {
      status,
      ok,
    };
  }

  async probe(url: string, init: ProbeOptions = {}): Promise<ProbeResult> {
    const { captureImageSize = false, ...requestInit } = init;
    if (captureImageSize) {
      return await this.probeWithImageSize(url, requestInit);
    }

    const method = requestInit.method ?? "HEAD";
    if (method === "GET") {
      const response = await this.requestForProbe(url, {
        ...requestInit,
        method: "GET",
      });

      return this.toProbeResult(url, response);
    }

    const response = await this.requestForProbe(url, {
      ...requestInit,
      method: "HEAD",
    });
    if (response.ok || !PROBE_FALLBACK_STATUS_CODES.has(response.status)) {
      return this.toProbeResult(url, response);
    }

    const fallbackResponse = await this.requestForProbe(url, {
      ...requestInit,
      method: "GET",
      headers: this.buildProbeHeaders(requestInit.headers, PROBE_RANGE_HEADER),
    });

    return this.toProbeResult(url, fallbackResponse);
  }

  createSession(options: { cookieJar?: NetworkCookieJar } = {}): NetworkSession {
    const client = this.createImpitClient(options.cookieJar);

    return {
      getText: async (url: string, init: Omit<ImpitRequestInit, "method"> = {}) => {
        const response = await this.executeRequest(
          url,
          {
            ...init,
            method: "GET",
          },
          client,
        );
        return response.text();
      },
    };
  }

  private toProbeResult(url: string, response: ImpitResponse): ProbeResult {
    return {
      status: response.status,
      ok: response.ok,
      contentLength: this.parseResponseContentLength(response),
      resolvedUrl: response.url || url,
    };
  }

  private async buildProbeResultWithImageSize(url: string, response: ImpitResponse): Promise<ProbeResult> {
    return await this.mergeProbeImageSize(this.toProbeResult(url, response), response);
  }

  private async probeWithImageSize(url: string, init: Omit<ProbeOptions, "captureImageSize">): Promise<ProbeResult> {
    const firstAttempt = await this.requestProbeWithImageSize(url, init, IMAGE_METADATA_PROBE_BYTES);
    if (!this.shouldRetryProbeWithImageSize(firstAttempt.response, firstAttempt.result, IMAGE_METADATA_PROBE_BYTES)) {
      return firstAttempt.result;
    }

    const secondAttempt = await this.requestProbeWithImageSize(url, init, IMAGE_METADATA_PROBE_RETRY_BYTES);
    return secondAttempt.result;
  }

  private async requestProbeWithImageSize(
    url: string,
    init: Omit<ProbeOptions, "captureImageSize">,
    byteCount: number,
  ): Promise<{ response: ImpitResponse; result: ProbeResult }> {
    const response = await this.requestForProbe(url, {
      ...init,
      method: "GET",
      headers: this.buildProbeHeaders(init.headers, this.buildProbeRangeValue(byteCount)),
    });

    return {
      response,
      result: await this.buildProbeResultWithImageSize(url, response),
    };
  }

  private shouldRetryProbeWithImageSize(response: ImpitResponse, result: ProbeResult, byteCount: number): boolean {
    if (this.hasProbeImageSize(result) || !result.ok || byteCount >= IMAGE_METADATA_PROBE_RETRY_BYTES) {
      return false;
    }

    if (response.status !== 206) {
      return false;
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    return !contentType || contentType.startsWith("image/jpeg");
  }

  private async mergeProbeImageSize(result: ProbeResult, response: ImpitResponse): Promise<ProbeResult> {
    const dimensions = await this.tryParseProbeImageSize(response);
    return dimensions ? { ...result, ...dimensions } : result;
  }

  private hasProbeImageSize(result: ProbeResult): result is ProbeResult & { width: number; height: number } {
    return (
      typeof result.width === "number" && result.width > 0 && typeof result.height === "number" && result.height > 0
    );
  }

  private async request(url: string, init: ImpitRequestInit): Promise<ImpitResponse> {
    return this.executeRequest(url, init);
  }

  private async requestForProbe(url: string, init: ImpitRequestInit): Promise<ImpitResponse> {
    return this.executeRequest(url, init, undefined, {
      allowNonOkResponse: true,
      retryLogPrefix: `probe ${url}`,
    });
  }

  private async executeRequest(
    url: string,
    init: ImpitRequestInit,
    client?: Impit,
    behavior: RequestBehavior = {},
  ): Promise<ImpitResponse> {
    return this.rateLimiter.schedule(url, async () => {
      const maxRetries = this.resolveRetryCount();
      let attempt = 0;

      while (true) {
        const response = await this.fetchOnce(url, init, client);
        if (response.ok) {
          return response;
        }

        const retryable = this.shouldRetryResponse(response);
        if (!retryable || attempt >= maxRetries) {
          if (behavior.allowNonOkResponse) {
            return response;
          }

          throw this.toHttpError(url, response);
        }

        const delayMs = this.getRetryDelayMs(response, attempt);
        attempt += 1;
        this.logger.warn(
          `Retrying ${behavior.retryLogPrefix ?? url} (${attempt}/${maxRetries}) after ${delayMs}ms due to HTTP ${response.status}`,
        );
        await sleep(delayMs);
      }
    });
  }

  private async fetchOnce(url: string, init: ImpitRequestInit, client?: Impit): Promise<ImpitResponse> {
    const currentClient = client ?? this.createImpitClient();
    const headers = new Headers(init.headers);
    this.applyReferer(url, headers);

    return currentClient.fetch(url, {
      ...init,
      timeout: init.timeout ?? this.resolveTimeoutMs(),
      headers,
    });
  }

  private toHttpError(url: string, response: ImpitResponse): Error {
    return new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
  }

  private buildProbeRangeValue(byteCount: number): string {
    return `bytes=0-${Math.max(0, byteCount - 1)}`;
  }

  private buildProbeHeaders(headersInit: ImpitRequestInit["headers"], rangeValue: string): Headers {
    const headers = new Headers(headersInit);
    headers.set("range", headers.get("range") ?? rangeValue);
    return headers;
  }

  private async tryParseProbeImageSize(response: ImpitResponse): Promise<{ width: number; height: number } | null> {
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? null;
    if (contentType && !contentType.startsWith("image/")) {
      return null;
    }

    if (!this.shouldReadProbeBody(response)) {
      return null;
    }

    try {
      const dimensions = parseImageDimensions(await response.bytes());
      return dimensions ? { width: dimensions.width, height: dimensions.height } : null;
    } catch {
      return null;
    }
  }

  private shouldReadProbeBody(response: ImpitResponse): boolean {
    if (response.status === 206) {
      return true;
    }

    const bodyLength = this.parseContentLength(response.headers.get("content-length"));
    return bodyLength !== null && bodyLength <= IMAGE_METADATA_PROBE_RETRY_BYTES;
  }

  private parseContentLength(value: string | null): number | null {
    if (!value) {
      return null;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  private parseResponseContentLength(response: ImpitResponse): number | null {
    const contentRange = response.headers.get("content-range");
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/u);
      if (match) {
        const parsed = Number.parseInt(match[1], 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          return parsed;
        }
      }
    }

    return this.parseContentLength(response.headers.get("content-length"));
  }

  private getRetryAfterDelayMs(response: ImpitResponse): number | null {
    if (response.status !== RETRY_STATUS_CODE) {
      return null;
    }

    const rawRetryAfter = response.headers.get("retry-after");
    const parsed = parseRetryAfterMs(rawRetryAfter);
    if (parsed === null) {
      return null;
    }

    return Math.min(parsed, RETRY_AFTER_CAP_MS);
  }

  private shouldRetryResponse(response: ImpitResponse): boolean {
    if (response.status === RETRY_STATUS_CODE) {
      return this.getRetryAfterDelayMs(response) !== null;
    }

    return RETRYABLE_STATUS_CODES.has(response.status);
  }

  private getRetryDelayMs(response: ImpitResponse, attempt: number): number {
    const retryAfterMs = this.getRetryAfterDelayMs(response);
    if (retryAfterMs !== null) {
      return retryAfterMs;
    }

    return Math.min(1000 * 2 ** attempt, RETRY_AFTER_CAP_MS);
  }

  private resolveTimeoutMs(): number {
    const value = this.options.getTimeoutMs?.() ?? this.options.timeoutMs;
    return Math.max(1, Math.trunc(value));
  }

  private resolveRetryCount(): number {
    const value = this.options.getRetryCount?.();
    if (value === undefined) {
      return 1;
    }

    return Math.max(0, Math.trunc(value));
  }

  private createImpitClient(cookieJar?: NetworkCookieJar): Impit {
    return new Impit({
      browser: this.options.browserImpersonation,
      timeout: this.resolveTimeoutMs(),
      proxyUrl: this.options.getProxyUrl?.(),
      followRedirects: true,
      vanillaFallback: true,
      http3: false,
      cookieJar,
    });
  }

  private applyReferer(url: string, headers: Headers): void {
    const hostname = new URL(url).hostname;

    if (headers.has("referer")) {
      return;
    }

    if (hostname.includes("javdb")) {
      headers.set("referer", "https://javdb.com/");
      return;
    }

    if (hostname.includes("javbus")) {
      headers.set("referer", "https://www.javbus.com/");
      return;
    }

    headers.set("referer", `${new URL(url).origin}/`);
  }
}
