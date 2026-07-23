import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Configuration, defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it, vi } from "vitest";
import { buildSiteConnectivityHeaders } from "./crawler/siteConnectivity";
import { checkConfiguredSiteCookies } from "./network/cookieChecks";
import { ensureWatermarkDirectory } from "./scrape/watermarkDirectory";
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

  it("reports missing cookies without network requests", async () => {
    const getText = vi.fn();

    await expect(checkConfiguredSiteCookies(cloneConfig(), { getText })).resolves.toEqual({
      results: [
        { site: "JavDB", valid: false, message: "未配置 Cookie" },
        { site: "JavBus", valid: false, message: "未配置 Cookie" },
      ],
    });
    expect(getText).not.toHaveBeenCalled();
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
