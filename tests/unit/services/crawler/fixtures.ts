import type { AdapterDependencies } from "@mdcz/runtime/crawler/base/types";
import { FetchGateway } from "@mdcz/runtime/crawler/FetchGateway";
import { classifyBlockedPage, NetworkClient, type ProbeResult, SiteError } from "@mdcz/runtime/network";

type GetTextInit = Parameters<NetworkClient["getText"]>[1];

export const withGateway = (networkClient: NetworkClient): AdapterDependencies => {
  return {
    gateway: new FetchGateway(networkClient),
  };
};

export class FixtureNetworkClient extends NetworkClient {
  private readonly fixtures: Map<string, unknown>;

  readonly requests: Array<{ url: string; headers: Headers }> = [];

  constructor(fixtures: Map<string, unknown>) {
    super({});
    this.fixtures = fixtures;
  }

  private getFixture(url: string): unknown | undefined {
    return this.fixtures.get(url) ?? this.fixtures.get(url.split("?", 1)[0] ?? url);
  }

  override async getText(url: string, init: GetTextInit = {}): Promise<string> {
    this.requests.push({
      url,
      headers: new Headers(init.headers),
    });

    const fixture = this.getFixture(url);
    if (fixture instanceof Error) throw fixture;
    if (!fixture) {
      throw new Error(`Missing fixture for ${url}`);
    }

    // Block pages are recognized by NetworkClient, which this fixture client replaces.
    const text = typeof fixture === "string" ? fixture : JSON.stringify(fixture);
    const reason = classifyBlockedPage(url, text);
    if (reason) {
      throw new SiteError(reason, `${reason} page served for ${url}`);
    }
    return text;
  }

  override async getContent(url: string, init: GetTextInit = {}): Promise<Uint8Array> {
    const text = await this.getText(url, init);
    return new TextEncoder().encode(text);
  }

  override async getJson<T>(url: string, init: GetTextInit = {}): Promise<T> {
    this.requests.push({
      url,
      headers: new Headers(init.headers),
    });

    const fixture = this.getFixture(url);
    if (fixture instanceof Error) throw fixture;
    if (!fixture) {
      throw new Error(`Missing fixture for ${url}`);
    }

    return fixture as T;
  }

  override async postJson<TResponse>(url: string): Promise<TResponse> {
    const fixture = this.getFixture(url);
    if (!fixture) {
      throw new Error(`Missing fixture for ${url}`);
    }

    return fixture as TResponse;
  }

  override async head(url: string): Promise<{ status: number; ok: boolean }> {
    const fixture = this.getFixture(url);
    if (fixture !== undefined) {
      return { status: 200, ok: true };
    }

    return { status: 404, ok: false };
  }

  override async probe(url: string): Promise<ProbeResult> {
    const fixture = this.getFixture(url);
    if (fixture !== undefined) {
      return {
        ok: true,
        status: 200,
        contentLength: 1,
        resolvedUrl: url,
      };
    }

    return {
      ok: false,
      status: 404,
      contentLength: null,
      resolvedUrl: url,
    };
  }
}

export class StaticFixtureNetworkClient extends NetworkClient {
  constructor(private readonly fixtures: Map<string, string>) {
    super({});
  }

  private getFixture(url: string): string | undefined {
    return this.fixtures.get(url) ?? this.fixtures.get(url.split("?", 1)[0] ?? url);
  }

  override async getText(url: string): Promise<string> {
    const fixture = this.getFixture(url);
    if (!fixture) {
      throw new Error(`Missing fixture for ${url}`);
    }

    return fixture;
  }
}
