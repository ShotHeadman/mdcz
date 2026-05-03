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

export interface RuntimeProbeResult {
  ok: boolean;
  status: number;
  contentLength: number | null;
  resolvedUrl: string;
  width?: number;
  height?: number;
}

export interface RuntimeNetworkClient {
  getText(url: string, init?: RuntimeRequestInit): Promise<string>;
  getContent?(url: string, init?: RuntimeRequestInit): Promise<Uint8Array>;
  getJson<T>(url: string, init?: RuntimeRequestInit): Promise<T>;
  postText(url: string, body: string, init?: RuntimeRequestInit): Promise<string>;
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
  download(url: string, outputPath: string, init?: RuntimeRequestInit): Promise<string>;
}

export interface SiteRequestConfig {
  id: string;
  matches: (url: URL) => boolean;
  headers?: RuntimeHeaderInit | ((url: URL) => RuntimeHeaderInit | undefined);
}

export interface SiteRequestConfigRegistrar {
  registerSiteRequestConfig(config: SiteRequestConfig): void;
  registerSiteRequestConfigs(configs: readonly SiteRequestConfig[]): void;
}

export class FetchNetworkClient implements RuntimeNetworkClient {
  async getText(url: string, init: RuntimeRequestInit = {}): Promise<string> {
    return await this.fetchText(url, { ...init, method: "GET" });
  }

  async getContent(url: string, init: RuntimeRequestInit = {}): Promise<Uint8Array> {
    const response = await this.fetch(url, { ...init, method: "GET" });
    return new Uint8Array(await response.arrayBuffer());
  }

  async getJson<T>(url: string, init: RuntimeRequestInit = {}): Promise<T> {
    const response = await this.fetch(url, { ...init, method: "GET" });
    return (await response.json()) as T;
  }

  async postText(url: string, body: string, init: RuntimeRequestInit = {}): Promise<string> {
    return await this.fetchText(url, { ...init, body, method: "POST" });
  }

  async postJson<T>(url: string, payload: unknown, init: RuntimeRequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    const response = await this.fetch(url, { ...init, body: JSON.stringify(payload), headers, method: "POST" });
    return (await response.json()) as T;
  }

  async postJsonDetailed<TResponse>(
    url: string,
    payload: unknown,
    init: RuntimeRequestInit = {},
  ): Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    resolvedUrl: string;
    headers: Headers;
    data: TResponse | string | null;
  }> {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    const response = await this.fetch(url, { ...init, body: JSON.stringify(payload), headers, method: "POST" }, true);

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      resolvedUrl: response.url || url,
      headers: response.headers,
      data: await this.parseJsonResponseBody<TResponse>(response),
    };
  }

  async head(url: string, init: RuntimeRequestInit = {}): Promise<{ status: number; ok: boolean }> {
    const response = await this.fetch(url, { ...init, method: "HEAD" }, true);
    return { ok: response.ok, status: response.status };
  }

  async probe(url: string, init: RuntimeProbeRequestInit = {}): Promise<RuntimeProbeResult> {
    const response = await this.fetch(url, { ...init, method: init.method ?? "HEAD" }, true);
    return {
      contentLength: this.parseContentLength(response.headers.get("content-length")),
      ok: response.ok,
      resolvedUrl: response.url || url,
      status: response.status,
    };
  }

  async download(url: string, outputPath: string, init: RuntimeRequestInit = {}): Promise<string> {
    const [{ mkdir, writeFile }, { dirname }] = await Promise.all([import("node:fs/promises"), import("node:path")]);
    const bytes = await this.getContent(url, init);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, bytes);
    return outputPath;
  }

  private async fetchText(
    url: string,
    init: RuntimeRequestInit & { body?: string; method: "GET" | "POST" },
  ): Promise<string> {
    const response = await this.fetch(url, init);
    return await response.text();
  }

  private async fetch(
    url: string,
    init: RuntimeRequestInit & { body?: string; method: "GET" | "POST" | "HEAD" },
    allowNonOk = false,
  ): Promise<Response> {
    const response = await globalThis.fetch(url, {
      body: init.body,
      headers: init.headers,
      method: init.method,
      signal: init.signal,
    });
    if (!allowNonOk && !response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
    }
    return response;
  }

  private parseContentLength(value: string | null): number | null {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  private async parseJsonResponseBody<TResponse>(response: Response): Promise<TResponse | string | null> {
    const text = await response.text();
    if (!text.trim()) {
      return null;
    }

    try {
      return JSON.parse(text) as TResponse;
    } catch {
      return text;
    }
  }
}
