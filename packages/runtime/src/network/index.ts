import type { Website } from "@mdcz/shared/enums";
import type { FailureReason } from "@mdcz/shared/siteResults";

export type RuntimeHeaderInit = ConstructorParameters<typeof Headers>[0];

export interface RuntimeRequestInit {
  timeout?: number;
  headers?: RuntimeHeaderInit;
  signal?: AbortSignal;
}

export interface RuntimeProbeRequestInit extends RuntimeRequestInit {
  method?: "HEAD" | "GET";
  captureImageSize?: boolean;
}

export interface RuntimeDownloadRequestInit extends RuntimeRequestInit {
  readTimeoutMs?: number;
  totalTimeoutMs?: number;
}

export interface RuntimeProbeResult {
  ok: boolean;
  status: number;
  contentLength: number | null;
  resolvedUrl: string;
  width?: number;
  height?: number;
  reason?: FailureReason;
}

export interface RuntimeNetworkClient {
  setDomainLimit?(domain: string, requestsPerSecond: number, concurrency?: number): void;
  setDomainInterval?(domain: string, intervalMs: number, intervalCap?: number, concurrency?: number): void;
  getText(url: string, init?: RuntimeRequestInit): Promise<string>;
  getContent?(url: string, init?: RuntimeRequestInit): Promise<Uint8Array>;
  getJson<T>(url: string, init?: RuntimeRequestInit): Promise<T>;
  postText(url: string, body: string, init?: RuntimeRequestInit): Promise<string>;
  deleteText(url: string, init?: RuntimeRequestInit): Promise<string>;
  postJson<T>(url: string, payload: unknown, init?: RuntimeRequestInit): Promise<T>;
  postJsonDetailed?<TResponse>(
    url: string,
    payload: unknown,
    init?: RuntimeRequestInit,
  ): Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    resolvedUrl: string;
    headers: Headers;
    data: TResponse | string | null;
  }>;
  head(url: string, init?: RuntimeRequestInit): Promise<{ status: number; ok: boolean }>;
  probe(url: string, init?: RuntimeProbeRequestInit): Promise<RuntimeProbeResult>;
}

export interface RuntimeDownloadNetworkClient extends RuntimeNetworkClient {
  download(url: string, outputPath: string, init?: RuntimeDownloadRequestInit): Promise<string>;
}

export interface SiteRequestConfig {
  id: string;
  /** `site` is the crawler the request belongs to, which identifies mirrors that the host alone cannot. */
  matches: (url: URL, site: Website | undefined) => boolean;
  headers?: RuntimeHeaderInit | ((url: URL) => RuntimeHeaderInit | undefined);
  /** Recognizes pages this site serves in place of the requested resource. */
  classifyBlockedPage?: (body: string) => FailureReason | null;
}

export interface SiteRequestConfigRegistrar {
  registerSiteRequestConfig(config: SiteRequestConfig): void;
  registerSiteRequestConfigs(configs: readonly SiteRequestConfig[]): void;
}

export * from "./cookieChecks";
export * from "./cookieUtils";
export * from "./InMemoryCookieJar";
export * from "./NetworkClient";
export * from "./networkExecution";
export * from "./RateLimiter";
export * from "./siteError";
