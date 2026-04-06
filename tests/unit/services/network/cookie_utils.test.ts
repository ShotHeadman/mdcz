import { filterCookiesForUrl, InMemoryCookieJar, type ResolvedCookie } from "@main/services/network";
import { describe, expect, it } from "vitest";

describe("cookieUtils", () => {
  it("filters cookies by normalized domain and path", () => {
    const cookies: ResolvedCookie[] = [
      { name: "session", value: "1", domain: ".example.com", path: "/" },
      { name: "scoped", value: "2", domain: "cdn.example.com", path: "/app" },
      { name: "other", value: "3", domain: "other.example.com", path: "/" },
      { name: "deeper", value: "4", domain: "example.com", path: "/app/assets" },
    ];

    const result = filterCookiesForUrl(cookies, new URL("https://cdn.example.com/app/assets/poster.jpg"));

    expect(result.map((cookie) => cookie.name)).toEqual(["session", "scoped", "deeper"]);
  });

  it("reuses the shared URL filtering in the in-memory cookie jar", () => {
    const jar = new InMemoryCookieJar();
    jar.setResolvedCookies(
      [
        { name: "session", value: "1", domain: ".example.com", path: "/" },
        { name: "scoped", value: "2", domain: "cdn.example.com", path: "/app" },
        { name: "other", value: "3", domain: "other.example.com", path: "/" },
      ],
      "https://cdn.example.com/app/index.html",
    );

    expect(jar.getCookieString("https://cdn.example.com/app/assets/poster.jpg")).toBe("session=1; scoped=2");
    expect(jar.getCookieString("https://cdn.example.com/admin")).toBe("session=1");
  });

  it("falls back to the request default-path when Set-Cookie Path is malformed", () => {
    const jar = new InMemoryCookieJar();
    jar.setCookie("scoped=2; Path=app", "https://cdn.example.com/app/pages/index.html");

    expect(jar.getCookieString("https://cdn.example.com/app/pages/poster.jpg")).toBe("scoped=2");
    expect(jar.getCookieString("https://cdn.example.com/app/poster.jpg")).toBe("");
  });
});
