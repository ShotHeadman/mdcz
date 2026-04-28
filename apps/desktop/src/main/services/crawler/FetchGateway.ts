import type { NetworkClient, ProbeResult } from "@main/services/network";

export interface FetchOptions {
  timeout?: number;
  headers?: Record<string, string>;
  cookies?: string;
  signal?: AbortSignal;
}

export interface ProbeFetchOptions extends FetchOptions {
  method?: "HEAD" | "GET";
}

export interface GraphQLOperation {
  operationName: string;
  query: string;
  variables: Record<string, unknown>;
}

const DEFAULT_TIMEOUT = 20_000;

export class FetchGateway {
  constructor(private readonly networkClient: NetworkClient) {}

  async fetchHtml(url: string, options: FetchOptions = {}): Promise<string> {
    return this.networkClient.getText(url, this.toHttpInit(options));
  }

  async fetchPostHtml(url: string, body: string, options: FetchOptions = {}): Promise<string> {
    return this.networkClient.postText(url, body, this.toHttpInit(options));
  }

  async fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
    return this.networkClient.getJson<T>(url, this.toHttpInit(options));
  }

  async fetchPost<T>(url: string, body: unknown, options: FetchOptions = {}): Promise<T> {
    return this.networkClient.postJson<T>(url, body, this.toHttpInit(options));
  }

  async fetchGraphQL<T>(endpoint: string, operation: GraphQLOperation, options: FetchOptions = {}): Promise<T> {
    const payload = await this.fetchPost<{ data?: T; errors?: unknown }>(endpoint, operation, options);
    if (payload.errors) {
      throw new Error(`GraphQL response contains errors for ${endpoint}`);
    }
    if (payload.data === undefined) {
      throw new Error(`GraphQL response missing data for ${endpoint}`);
    }
    return payload.data;
  }

  async fetchHead(url: string, options: FetchOptions = {}): Promise<{ status: number; ok: boolean }> {
    return this.networkClient.head(url, this.toHttpInit(options));
  }

  async probeUrl(url: string, options: ProbeFetchOptions = {}): Promise<ProbeResult> {
    const { method, ...requestOptions } = options;
    return this.networkClient.probe(url, {
      ...this.toHttpInit(requestOptions),
      method,
    });
  }

  private toHeaders(options: { headers?: Record<string, string>; cookies?: string }): Record<string, string> {
    const headers = {
      ...(options.headers ?? {}),
    };

    if (typeof options.cookies === "string" && options.cookies.trim().length > 0) {
      headers.cookie = options.cookies;
    }

    return headers;
  }

  private toHttpInit(options: FetchOptions) {
    return {
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      headers: this.toHeaders(options),
      signal: options.signal,
    };
  }
}
