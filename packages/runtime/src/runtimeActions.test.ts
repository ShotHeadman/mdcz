import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Configuration, defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it, vi } from "vitest";
import { buildSiteConnectivityHeaders } from "./crawler/siteConnectivity";
import { checkConfiguredSiteCookies } from "./network/cookieChecks";
import { ensureWatermarkDirectory } from "./scrape/watermarkDirectory";
import { JAVBUS_REQUEST_HEADERS } from "./shared";
import type { LlmApiClient } from "./translate";
import { testLlmConnectivity } from "./translate/llmTest";

const cloneConfig = (): Configuration => structuredClone(defaultConfiguration);

describe("settings parity runtime helpers", () => {
  it("builds site connectivity cookies and age gates from shared crawler options", () => {
    const config = cloneConfig();
    config.network.javdbCookie = "javdb_session=ok";

    expect(buildSiteConnectivityHeaders(Website.JAVDB, config)).toEqual({ cookie: "javdb_session=ok" });
    expect(buildSiteConnectivityHeaders(Website.MGSTAGE, config)).toEqual({ cookie: "adc=1" });
    expect(buildSiteConnectivityHeaders(Website.SOKMIL, config)).toEqual({ cookie: "AGEAUTH=ok" });
  });

  it("reports when JavBus is anonymously accessible while JavDB and Fantia remains unconfigured", async () => {
    const getText = vi.fn(async () => '<a class="movie-box" href="/ABP-123"></a>');

    await expect(checkConfiguredSiteCookies(cloneConfig(), { getText })).resolves.toEqual({
      results: [
        { site: "JavDB", valid: false, message: "未配置 Cookie", status: "not_configured" },
        {
          site: "JavBus",
          valid: true,
          message: "JavBus 影片页面可匿名访问，无需 Cookie",
          status: "ready_without_cookie",
        },
        { site: "Fantia", valid: false, message: "未配置 Cookie", status: "not_configured" },
      ],
    });
    expect(getText).toHaveBeenCalledWith("https://www.javbus.com/", { headers: { ...JAVBUS_REQUEST_HEADERS } });
  });

  // HTML→classification coverage lives in javbusPage.test.ts; here we only
  // verify the classification→status/message mapping.
  it.each([
    [
      "age verification",
      '<title>Age Verification JavBus</title><div id="ageVerify"></div>',
      "verification_required",
      "JavBus 影片页面需要完成年龄/地区验证。请在浏览器完成验证后复制 Cookie。",
    ],
    [
      "login wall",
      '<form><h2>Login</h2><input type="password" /></form>',
      "login_wall",
      "JavBus 影片页面返回登录墙，当前 Cookie 无法访问影片内容。",
    ],
    [
      "unrecognized page",
      "<main>temporarily unavailable</main>",
      "unexpected_page",
      "JavBus 影片页面未返回可识别内容，请稍后重试。",
    ],
  ] as const)("reports JavBus %s without treating it as a valid Cookie", async (_name, html, status, message) => {
    const config = cloneConfig();
    config.network.javbusCookie = "javbus_session=valid";
    const getText = vi.fn(async () => html);

    const result = await checkConfiguredSiteCookies(config, { getText });
    const javbus = result.results.find((entry) => entry.site === "JavBus");

    expect(javbus).toMatchObject({ valid: false, status, message });
    expect(getText).toHaveBeenCalledWith("https://www.javbus.com/", {
      headers: { ...JAVBUS_REQUEST_HEADERS, cookie: "javbus_session=valid" },
    });
  });

  it("reports a configured JavBus Cookie only after film content is available", async () => {
    const config = cloneConfig();
    config.network.javbusCookie = "javbus_session=valid";
    const getText = vi.fn(async () => '<a class="movie-box" href="/ABP-123"></a>');

    const result = await checkConfiguredSiteCookies(config, { getText });

    expect(result.results.find((entry) => entry.site === "JavBus")).toEqual({
      site: "JavBus",
      valid: true,
      message: "JavBus Cookie 有效",
      status: "ready_with_cookie",
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
    expect(javbus?.message).toContain("[REDACTED]");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("second-secret");
  });

  it("uses Desktop LLM validation semantics before sending a request", async () => {
    const config = cloneConfig();
    const llmApiClient = { generateText: vi.fn().mockResolvedValue("ok") } as unknown as LlmApiClient;

    await expect(testLlmConnectivity({ llmModelName: "" }, config, llmApiClient)).resolves.toEqual({
      success: false,
      message: "请先填写 LLM 模型名称",
    });
    expect(llmApiClient.generateText).not.toHaveBeenCalled();

    config.translate.llmBaseUrl = "https://example.test/v1";
    await expect(
      testLlmConnectivity({ llmModelName: "gpt-test", llmPrompt: "{lang}:{content}" }, config, llmApiClient),
    ).resolves.toEqual({ success: true, message: "连接成功，LLM 回复: ok" });
    expect(llmApiClient.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://example.test/v1",
        model: "gpt-test",
        prompt: "简体中文:ある日の暮方の事である。",
        timeout: 10_000,
      }),
    );
  });

  it("creates the server-side watermark directory under runtime data", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-watermark-"));
    const directoryPath = await ensureWatermarkDirectory(root);
    const stats = await stat(directoryPath);

    expect(stats.isDirectory()).toBe(true);
    expect(directoryPath).toBe(join(root, "watermark"));
  });
});
