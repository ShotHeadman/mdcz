import { type Configuration, defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it, vi } from "vitest";
import { buildSiteConnectivityHeaders, probeSiteConnectivity } from "./crawler/siteConnectivity";
import { checkConfiguredSiteCookies } from "./network/cookieChecks";
import { buildCrawlerOptions } from "./scrape/crawlerOptions";
import { JAVBUS_PAGE_HEADERS } from "./shared";
import type { LlmApiClient } from "./translate";
import { testLlmConnectivity } from "./translate/llmTest";

const cloneConfig = (): Configuration => structuredClone(defaultConfiguration);

describe("settings parity runtime helpers", () => {
  it("builds site connectivity cookies and age gates from shared crawler options", () => {
    const config = cloneConfig();
    config.network.javdbCookie = "javdb_session=ok";
    config.network.fantiaCookie = "fantia_session=ok";

    expect(buildSiteConnectivityHeaders(Website.JAVDB, config)).toEqual({ cookie: "javdb_session=ok" });
    expect(buildSiteConnectivityHeaders(Website.FANTIA, config)).toEqual({ cookie: "fantia_session=ok" });
    expect(buildSiteConnectivityHeaders(Website.JAVBUS, config)).toEqual({});
    expect(buildSiteConnectivityHeaders(Website.MGSTAGE, config)).toEqual({ cookie: "adc=1" });
    expect(buildSiteConnectivityHeaders(Website.SOKMIL, config)).toEqual({ cookie: "AGEAUTH=ok" });
  });

  it("sends the configured Fantia cookie during connectivity probing", async () => {
    const config = cloneConfig();
    config.network.fantiaCookie = "fantia_session=ok";
    const probe = vi.fn(async () => ({
      ok: true,
      status: 200,
      resolvedUrl: "https://fantia.jp",
    }));

    await expect(probeSiteConnectivity(Website.FANTIA, config, { probe })).resolves.toMatchObject({ ok: true });
    expect(probe).toHaveBeenCalledWith("https://fantia.jp", {
      headers: { cookie: "fantia_session=ok" },
      timeout: 10000,
    });
  });

  it.each([
    [Website.JAVDB, "javdbCookie", "javdb_session=ok"],
  ] as const)("builds only the %s cookie for its matching site", (site, cookieKey, cookie) => {
    const config = cloneConfig();
    config.network[cookieKey] = cookie;

    expect(buildCrawlerOptions({ site, configuration: config }).cookies).toBe(cookie);

    const otherSites = [Website.JAVDB, Website.JAVBUS, Website.FANTIA].filter((otherSite) => otherSite !== site);
    for (const otherSite of otherSites) {
      expect(buildCrawlerOptions({ site: otherSite, configuration: config }).cookies).toBeUndefined();
    }
  });

  it("reports when JavBus is anonymously accessible while JavDB and Fantia remains unconfigured", async () => {
    const getText = vi.fn(async () => '<a class="movie-box" href="/ABP-123"></a>');

    await expect(checkConfiguredSiteCookies(cloneConfig(), { getText })).resolves.toEqual({
      results: [
        { site: "JavDB", valid: false, status: "not_configured" },
        {
          site: "JavBus",
          valid: true,
          status: "ready_without_cookie",
        },
        { site: "Fantia", valid: false, status: "not_configured" },
      ],
    });
    expect(getText).toHaveBeenCalledWith("https://www.javbus.com/", { headers: { ...JAVBUS_PAGE_HEADERS } });
  });

  // HTML→classification coverage lives in javbusPage.test.ts; here we only
  // verify the classification→status mapping.
  it.each([
    ["age verification", '<title>Age Verification JavBus</title><div id="ageVerify"></div>', "verification_required"],
    ["login wall", '<form><h2>Login</h2><input type="password" /></form>', "login_wall"],
    ["unrecognized page", "<main>temporarily unavailable</main>", "unexpected_page"],
  ] as const)("reports JavBus %s without treating it as a valid Cookie", async (_name, html, status) => {
    const config = cloneConfig();
    config.network.javbusCookie = "javbus_session=valid";
    const getText = vi.fn(async () => html);

    const result = await checkConfiguredSiteCookies(config, { getText });
    const javbus = result.results.find((entry) => entry.site === "JavBus");

    expect(javbus).toEqual({ site: "JavBus", valid: false, status });
    expect(getText).toHaveBeenCalledWith("https://www.javbus.com/", {
      headers: { ...JAVBUS_PAGE_HEADERS, cookie: "javbus_session=valid" },
    });
  });

  it("reports a configured JavBus Cookie only after film content is available on the configured mirror", async () => {
    const config = cloneConfig();
    config.network.javbusCookie = "javbus_session=valid";
    config.network.javbusUrl = "https://javbus-mirror.example/";
    const getText = vi.fn(async () => '<a class="movie-box" href="/ABP-123"></a>');

    const result = await checkConfiguredSiteCookies(config, { getText });

    expect(result.results.find((entry) => entry.site === "JavBus")).toEqual({
      site: "JavBus",
      valid: true,
      status: "ready_with_cookie",
    });
    expect(getText).toHaveBeenCalledWith("https://javbus-mirror.example/", {
      headers: { ...JAVBUS_PAGE_HEADERS, cookie: "javbus_session=valid" },
    });
  });

  it.each([
    ["dashboard", '<a href="/mypage/dashboard">My page</a>', true, "ready_with_cookie"],
    ["login wall", '<form><input type="password" /></form>', false, "invalid_or_expired"],
    ["unexpected page", "<main>temporarily unavailable</main>", false, "unexpected_page"],
  ] as const)("classifies Fantia %s instead of treating arbitrary HTML as a valid Cookie", async (_name, html, valid, status) => {
    const config = cloneConfig();
    config.network.fantiaCookie = "fantia_session=valid";
    const getText = vi.fn(async (url: string) =>
      url === "https://fantia.jp/mypage/dashboard" ? html : '<a class="movie-box" />',
    );

    const result = await checkConfiguredSiteCookies(config, { getText });

    expect(result.results.find((entry) => entry.site === "Fantia")).toEqual({
      site: "Fantia",
      valid,
      status,
    });
  });

  it("does not expose a configured JavBus Cookie when the probe fails", async () => {
    const config = cloneConfig();
    config.network.javbusCookie = "javbus_session=secret-token; other=second-secret";
    const getText = vi.fn(async () => {
      throw new Error("JavBus rejected javbus_session=secret-token (value secret-token, extra second-secret)");
    });

    const result = await checkConfiguredSiteCookies(config, { getText });
    const javbus = result.results.find((entry) => entry.site === "JavBus");

    expect(javbus).toMatchObject({ valid: false, status: "request_failed" });
    expect(javbus?.error).toContain("[REDACTED]");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("second-secret");
  });

  it.each([
    "none",
    "json_object",
    "json_schema",
  ] as const)("validates the metadata translation contract with %s output", async (outputFormat) => {
    const config = cloneConfig();
    config.translate.llmOutputFormat = outputFormat;
    const llmApiClient = {
      generateText: vi.fn().mockResolvedValue(JSON.stringify({ title: "某天傍晚", plot: null, genres: ["日常"] })),
    } as unknown as LlmApiClient;
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(testLlmConnectivity({ llmModelName: "" }, config, llmApiClient)).resolves.toEqual({
      status: "missing_model",
    });
    expect(llmApiClient.generateText).not.toHaveBeenCalled();

    config.translate.llmBaseUrl = "https://example.test/v1";
    await expect(
      testLlmConnectivity(
        {
          llmModelName: "gpt-test",
          llmPrompt: "{lang}:{content}",
          llmTemperature: 1.5,
          llmReasoning: "high",
        },
        config,
        llmApiClient,
        logger,
      ),
    ).resolves.toEqual({ status: "ok", sample: "某天傍晚" });
    expect(llmApiClient.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://example.test/v1",
        model: "gpt-test",
        prompt: expect.stringContaining('"title":"ある日の暮方の事である。"'),
        reasoning: "high",
        temperature: 1.5,
        timeout: 120_000,
        serviceType: "openai-compatible",
        outputFormat,
        outputSchema: expect.objectContaining({ name: "metadata_translation" }),
      }),
      undefined,
    );
    expect(logger.info).toHaveBeenCalledWith("Test LLM connectivity: Success");
    for (const content of [
      "普通译文",
      JSON.stringify({ translation: "普通译文" }),
      JSON.stringify({ title: "译文", plot: null, genres: [] }),
    ]) {
      vi.mocked(llmApiClient.generateText).mockResolvedValueOnce(content);
      await expect(testLlmConnectivity({ llmModelName: "gpt-test" }, config, llmApiClient, logger)).resolves.toEqual({
        status: "failed",
        error: expect.stringContaining("invalid structured output"),
      });
    }

    vi.mocked(llmApiClient.generateText).mockRejectedValueOnce(new Error("HTTP 400: invalid temperature"));
    await expect(testLlmConnectivity({ llmModelName: "gpt-test" }, config, llmApiClient, logger)).resolves.toEqual({
      status: "failed",
      error: "HTTP 400: invalid temperature",
    });
  });
});
