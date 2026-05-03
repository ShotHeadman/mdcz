import type { Configuration } from "@mdcz/shared/config";
import {
  FIELD_REGISTRY,
  type FieldAnchor,
  SECTION_FILTER_ALIASES,
  SECTION_LABELS,
  SECTION_ORDER,
} from "@mdcz/shared/settingsRegistry";

export const SETTINGS_SECTIONS = Object.fromEntries(
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

export const SETTINGS_FIELD_REGISTRY = FIELD_REGISTRY.filter((entry) => entry.surface === "settings");

const previewSample = {
  actor: "三上悠亚",
  actorFallbackPrefix: "",
  allActors: "三上悠亚 明日花绮罗",
  censorshipType: "有码",
  cnword: "-C",
  date: "2026-04-29",
  definition: "1080p",
  director: "示例导演",
  filename: "SSIS-001.mp4",
  firstActor: "三上悠亚",
  firstLetter: "S",
  letters: "SSIS",
  number: "SSIS-001",
  originaltitle: "Sample Original Title",
  outline: "示例简介",
  plot: "示例简介",
  publisher: "示例发行商",
  rating: "4.6",
  release: "2026-04-29",
  runtime: "120",
  score: "4.6",
  series: "示例系列",
  studio: "示例片商",
  subtitle: "中文字幕",
  title: "示例影片标题",
  website: "javdb",
  year: "2026",
  "4K": "",
} as const;

export const renderNamingTemplate = (template: string): string =>
  template.replace(/\{([^{}]+)\}/gu, (match, rawKey: string) => {
    const key = rawKey as keyof typeof previewSample;
    return Object.hasOwn(previewSample, key) ? previewSample[key] : match;
  });

export const buildNamingPreview = (config: Configuration | undefined, defaults: Configuration | undefined) => {
  const naming = config?.naming ?? defaults?.naming;
  if (!naming) {
    return { folder: "—", file: "—", nfoTitle: "—" };
  }

  return {
    file: renderNamingTemplate(naming.fileTemplate),
    folder: renderNamingTemplate(naming.folderTemplate),
    nfoTitle: renderNamingTemplate(naming.nfoTitleTemplate),
  };
};
