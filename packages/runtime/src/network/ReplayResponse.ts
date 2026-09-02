import type { RawNetworkResponse } from "./NetworkClient";

export class ReplayResponse implements RawNetworkResponse {
  readonly ok: boolean;
  readonly body: ReadableStream<Uint8Array> | null;
  private readonly response: Response;

  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly headers: Headers,
    readonly url: string,
    bytes: Uint8Array,
  ) {
    this.ok = status >= 200 && status < 300;
    const nullBody = status === 101 || status === 204 || status === 205 || status === 304;
    this.response = new Response(nullBody ? null : Uint8Array.from(bytes).buffer, { status, statusText, headers });
    this.body = this.response.body;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return await this.response.arrayBuffer();
  }

  async bytes(): Promise<Uint8Array> {
    return new Uint8Array(await this.arrayBuffer());
  }

  async text(): Promise<string> {
    return await this.response.text();
  }

  async json(): Promise<unknown> {
    return await this.response.json();
  }

  clone(): Response {
    return this.response.clone();
  }

  abort(): void {}
}
