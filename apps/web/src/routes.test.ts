import { DESKTOP_ROUTE_DEFINITIONS } from "@mdcz/shared/desktopNavigation";
import { taskKindSchema } from "@mdcz/shared/serverDtos";
import { TOOL_DEFINITIONS } from "@mdcz/shared/toolCatalog";
import { PRIMARY_SHELL_NAV, SYSTEM_SHELL_NAV } from "@mdcz/views/shell";
import { describe, expect, it } from "vitest";
import { taskKindLabels } from "./routeCommon";
import { buildHref } from "./routeHelpers";

describe("route helpers", () => {
  it("builds links with encoded query parameters", () => {
    expect(buildHref("/settings", { setting: "paths.mediaPath", rootId: "root-1", unused: undefined })).toBe(
      "/settings?setting=paths.mediaPath&rootId=root-1",
    );
  });

  it("uses desktop-derived route and tool metadata", () => {
    expect(DESKTOP_ROUTE_DEFINITIONS.map((route) => route.label)).toEqual([
      "概览",
      "工作台",
      "工具",
      "媒体库",
      "设置",
      "日志",
      "关于",
    ]);
    expect([...PRIMARY_SHELL_NAV, ...SYSTEM_SHELL_NAV].map((route) => [route.label, route.to])).toEqual(
      DESKTOP_ROUTE_DEFINITIONS.map((route) => [route.label, route.path]),
    );
    expect(TOOL_DEFINITIONS.map((tool) => tool.id)).toEqual([
      "single-file-scraper",
      "crawler-tester",
      "amazon-poster",
      "media-library-tools",
      "symlink-manager",
      "file-cleaner",
      "batch-nfo-translator",
    ]);
  });

  it("registers generic task kinds for future workflows", () => {
    expect(taskKindSchema.options).toEqual(["scan", "scrape", "maintenance"]);
    expect(taskKindLabels).toEqual({
      maintenance: "维护",
      scan: "扫描",
      scrape: "刮削",
    });
  });
});
