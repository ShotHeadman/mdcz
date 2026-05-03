import { DESKTOP_ROUTE_DEFINITIONS } from "@mdcz/shared/desktopNavigation";
import { SECTION_LABELS } from "@mdcz/shared/settingsRegistry";
import { TOOL_DEFINITIONS } from "@mdcz/shared/toolCatalog";
import { describe, expect, it } from "vitest";

import { buildHref, includesSearch, normalizeSearchText } from "./routeHelpers";
import { renderNamingTemplate, SETTINGS_SECTIONS } from "./settings/desktopSettingsModel";

describe("route helpers", () => {
  it("builds contained browser links with encoded query parameters", () => {
    expect(buildHref("/browser", { path: "A B/01", rootId: "root-1", unused: undefined })).toBe(
      "/browser?path=A+B%2F01&rootId=root-1",
    );
  });

  it("matches settings sections by desktop registry labels and config aliases", () => {
    expect(normalizeSearchText("  LLM  ")).toBe("llm");
    expect(SETTINGS_SECTIONS.translate.title).toBe(SECTION_LABELS.translate);
    expect(SETTINGS_SECTIONS.fileBehavior.title).toBe(SECTION_LABELS.fileBehavior);
    expect(SETTINGS_SECTIONS.system.title).toBe(SECTION_LABELS.system);
    expect(includesSearch("llm", [SETTINGS_SECTIONS.translate.title, ...SETTINGS_SECTIONS.translate.keywords])).toBe(
      true,
    );
    expect(includesSearch("代理", [SETTINGS_SECTIONS.network.title, ...SETTINGS_SECTIONS.network.keywords])).toBe(true);
    expect(includesSearch("不存在", [SETTINGS_SECTIONS.naming.title, ...SETTINGS_SECTIONS.naming.keywords])).toBe(
      false,
    );
  });

  it("renders known naming template variables and preserves unknown placeholders", () => {
    expect(renderNamingTemplate("{number}-{title}-{unknown}")).toBe("SSIS-001-示例影片标题-{unknown}");
  });

  it("uses desktop-derived route and tool metadata", () => {
    expect(DESKTOP_ROUTE_DEFINITIONS.map((route) => route.label)).toEqual([
      "概览",
      "工作台",
      "工具",
      "设置",
      "日志",
      "关于",
    ]);
    expect(TOOL_DEFINITIONS.map((tool) => tool.id)).toEqual([
      "single-file-scraper",
      "crawler-tester",
      "amazon-poster",
      "media-library-tools",
      "symlink-manager",
      "file-cleaner",
      "batch-nfo-translator",
      "missing-number-finder",
    ]);
  });
});
