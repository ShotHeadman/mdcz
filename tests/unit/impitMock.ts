type ImpitMockState = {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  constructorSpy?: (options?: unknown) => void;
};

const getState = (): ImpitMockState | undefined =>
  (globalThis as typeof globalThis & { __mdczImpitMock?: ImpitMockState }).__mdczImpitMock;

export type Browser = string;

export type RequestInit = {
  body?: BodyInit | null;
  headers?: HeadersInit;
  method?: string;
  signal?: AbortSignal | null;
  timeout?: number;
  [key: string]: unknown;
};

export class Impit {
  constructor(options?: unknown) {
    getState()?.constructorSpy?.(options);
  }

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const fetchMock = getState()?.fetch;
    if (!fetchMock) {
      throw new Error("Impit test mock fetch was not configured");
    }

    return await fetchMock(url, init);
  }
}
