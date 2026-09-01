import type { CrawlerCredentialSeed } from "./crawlerCassette";

const MIN_SECRET_LENGTH = 8;
const TOKEN_QUERY_NAME = /token|csrf|auth|session|secret|password|passwd|access_key|api_key/iu;

export interface ObservedCredential {
  name: string;
  kind: "cookie" | "token";
  real: string;
  fake: string;
}

const sanitizeName = (name: string): string => {
  const normalized = name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/gu, "-");
  return normalized || "value";
};

const replaceAllBytes = (haystack: Uint8Array, needle: Uint8Array, replacement: Uint8Array): Uint8Array => {
  if (needle.byteLength === 0) return haystack;
  const source = Buffer.from(haystack);
  const from = Buffer.from(needle);
  const to = Buffer.from(replacement);
  const parts: Buffer[] = [];
  let start = 0;
  while (true) {
    const index = source.indexOf(from, start);
    if (index === -1) {
      parts.push(source.subarray(start));
      break;
    }
    parts.push(source.subarray(start, index), to);
    start = index + from.length;
  }
  return new Uint8Array(Buffer.concat(parts));
};

export class CrawlerCredentialRedactor {
  private readonly byReal = new Map<string, ObservedCredential>();
  private readonly fakeNames = new Set<string>();

  register(name: string, real: string, kind: "cookie" | "token"): void {
    const value = real.trim();
    if (value.length < MIN_SECRET_LENGTH || this.byReal.has(value)) return;

    let fake = `mdcz-test-${kind}-${sanitizeName(name)}`;
    if (this.fakeNames.has(fake) || [...this.byReal.values()].some((entry) => entry.fake === fake)) {
      fake = `${fake}-${this.byReal.size + 1}`;
    }
    this.fakeNames.add(fake);
    this.byReal.set(value, { name: name.trim() || kind, kind, real: value, fake });
  }

  observeUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    for (const [name, value] of parsed.searchParams) {
      if (TOKEN_QUERY_NAME.test(name)) this.register(name, value, "token");
    }
  }

  observeHeaders(headers: Headers): void {
    const cookie = headers.get("cookie");
    if (cookie) {
      for (const part of cookie.split(";")) {
        const separator = part.indexOf("=");
        if (separator <= 0) continue;
        this.register(part.slice(0, separator).trim(), part.slice(separator + 1).trim(), "cookie");
      }
    }

    const authorization = headers.get("authorization");
    if (authorization) {
      const bearer = authorization.match(/^Bearer\s+(\S+)/u);
      this.register("authorization", bearer?.[1] ?? authorization, "token");
    }

    const csrf = headers.get("x-csrf-token") ?? headers.get("x-xsrf-token");
    if (csrf) this.register("csrf", csrf, "token");

    const setCookies = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const header of setCookies) {
      const pair = header.split(";", 1)[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      this.register(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim(), "cookie");
    }
  }

  redactString(value: string): string {
    let result = value;
    for (const secret of this.secretsLongestFirst()) {
      result = result.split(secret.real).join(secret.fake);
    }
    return result;
  }

  redactBytes(bytes: Uint8Array): Uint8Array {
    let result = bytes;
    for (const secret of this.secretsLongestFirst()) {
      result = replaceAllBytes(result, Buffer.from(secret.real, "utf8"), Buffer.from(secret.fake, "utf8"));
    }
    return result;
  }

  containsRealSecret(value: string | Uint8Array): boolean {
    const text = typeof value === "string" ? value : Buffer.from(value).toString("utf8");
    return this.secrets().some((secret) => text.includes(secret.real));
  }

  seed(reals = new Set(this.byReal.keys())): CrawlerCredentialSeed {
    const cookies: Record<string, string> = {};
    const tokens: Record<string, string> = {};
    for (const secret of this.secrets()) {
      if (!reals.has(secret.real)) continue;
      if (secret.kind === "cookie") cookies[secret.name] = secret.fake;
      else tokens[secret.name] = secret.fake;
    }
    return { cookies, tokens };
  }

  secrets(): ObservedCredential[] {
    return [...this.byReal.values()];
  }

  private secretsLongestFirst(): ObservedCredential[] {
    return this.secrets().sort((left, right) => right.real.length - left.real.length);
  }
}
