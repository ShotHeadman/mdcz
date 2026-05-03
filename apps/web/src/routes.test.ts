import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DESKTOP_ROUTE_DEFINITIONS } from "@mdcz/shared/desktopNavigation";
import { MAINTENANCE_PRESET_OPTIONS } from "@mdcz/shared/maintenancePresets";
import { taskKindSchema } from "@mdcz/shared/serverDtos";
import {
  FIELD_REGISTRY,
  type FieldAnchor,
  SECTION_FILTER_ALIASES,
  SECTION_LABELS,
  SECTION_ORDER,
} from "@mdcz/shared/settingsRegistry";
import { TOOL_DEFINITIONS } from "@mdcz/shared/toolCatalog";
import { describe, expect, it } from "vitest";
import { taskKindLabels } from "./routeCommon";
import { buildHref, includesSearch, normalizeSearchText } from "./routeHelpers";

const WEB_SRC_DIR = dirname(fileURLToPath(import.meta.url));

const SETTINGS_SECTIONS = Object.fromEntries(
  SECTION_ORDER.map((anchor) => {
    const entries = FIELD_REGISTRY.filter((entry) => entry.anchor === anchor && entry.surface === "settings");
    return [
      anchor,
      {
        keywords: [
          anchor,
          SECTION_LABELS[anchor],
          ...SECTION_FILTER_ALIASES[anchor],
          ...entries.flatMap((entry) => [entry.label, ...entry.aliases]),
        ],
        title: SECTION_LABELS[anchor],
      },
    ];
  }),
) as Record<FieldAnchor, { keywords: string[]; title: string }>;

const previewSample: Record<string, string> = {
  number: "SSIS-001",
  title: "示例影片标题",
};

const renderNamingTemplate = (template: string): string =>
  template.replace(/\{([^{}]+)\}/gu, (match, rawKey: string) => {
    const value = previewSample[rawKey];
    return value ?? match;
  });

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
      "媒体库",
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

  it("registers generic task kinds for future workflows", () => {
    expect(taskKindSchema.options).toEqual(["scan", "scrape", "maintenance"]);
    expect(taskKindLabels).toEqual({
      maintenance: "维护",
      scan: "扫描",
      scrape: "刮削",
    });
  });

  it("uses desktop maintenance preset IDs and labels", () => {
    expect(MAINTENANCE_PRESET_OPTIONS.map((preset) => [preset.id, preset.label])).toEqual([
      ["read_local", "读取本地"],
      ["refresh_data", "刷新数据"],
      ["organize_files", "整理目录"],
      ["rebuild_all", "全量重整"],
    ]);
  });

  it("keeps WebUI primitive exports free of fabricated layout wrappers", async () => {
    const uiSource = await readFile(join(WEB_SRC_DIR, "ui.tsx"), "utf8");

    expect(uiSource.trim()).toBe('export * from "@mdcz/ui";');
    expect(uiSource).not.toMatch(/\b(Page|Panel|Field)\b/u);
  });
});
