import { configurationSchema } from "@mdcz/shared/config";
import { TranslateEngine, Website } from "@mdcz/shared/enums";
import type { CrawlerData, NfoLocalState } from "@mdcz/shared/types";
import { describe, expect, it, vi } from "vitest";
import { NetworkClient } from "../network";
import { publishMetadata } from "./publishMetadata";
import { TranslateService } from "./TranslateService";

const movie = (overrides: Partial<CrawlerData>): CrawlerData => ({
  title: "Source Title",
  number: "ABC-123",
  actors: ["Actor A"],
  genres: [],
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

const config = (enableTranslation: boolean) =>
  configurationSchema.parse({ translate: { engine: TranslateEngine.GOOGLE, enableTranslation } });

const cases = [
  {
    group: "reuses valid unchanged translations",
    name: "keeps an existing translation, whoever wrote it, while the source is unchanged",
    merged: movie({ plot: "Source Plot" }),
    published: movie({ title_zh: "外部译名", plot: "Source Plot", plot_zh: "外部简介" }),
    expected: { title: "Source Title", title_zh: "外部译名", plot_zh: "外部简介" },
    translated: [],
  },
  {
    group: "refreshes changed or unusable translations",
    name: "translates a changed source",
    merged: movie({ title: "New Title" }),
    published: movie({ title_zh: "旧译名" }),
    expected: { title: "New Title", title_zh: "译:New Title" },
    translated: ["New Title"],
  },
  {
    group: "honors media-server locks without reusing refused translations",
    name: "keeps fields locked in the media server",
    merged: movie({ title: "New Title", actors: ["Actor B"] }),
    published: movie({ title_zh: "手改译名", actors: ["Actor A"] }),
    localState: { lockedFields: ["name", "Cast"] },
    expected: { title: "Source Title", title_zh: "手改译名", actors: ["Actor A"] },
    translated: [],
  },
  {
    group: "respects the keep-edits choice",
    name: "keeps fields edited since publishing when scraping",
    merged: movie({ title: "New Title", genres: ["Site"] }),
    published: movie({ title_zh: "手改标题", genres: ["User"] }),
    localState: { edits: { title: "edited", genre: "edited" } },
    keepEdits: true,
    expected: { title: "Source Title", title_zh: "手改标题", genres: ["User"] },
    translated: [],
  },
  {
    group: "respects the keep-edits choice",
    name: "offers site values for edited fields, translating rather than reusing an edited title",
    merged: movie({ genres: ["Site"] }),
    published: movie({ title_zh: "手改标题", genres: ["User"] }),
    localState: { edits: { title: "edited", genre: "edited" } },
    keepEdits: false,
    expected: { title: "Source Title", title_zh: "译:Source Title", genres: ["译:Site"] },
    translated: ["Source Title"],
  },
  {
    group: "retains authoritative published genres",
    name: "re-merges with the genres already in the NFO instead of translating the sites' again",
    merged: movie({ genres: ["Site"] }),
    published: movie({ title_zh: "译名", genres: ["已译"] }),
    keepPublishedGenres: true,
    expected: { genres: ["已译"] },
    translated: [],
  },
  {
    group: "retains measured duration",
    name: "keeps the runtime the NFO measured from the video over the sites' catalog runtime",
    merged: movie({ durationSeconds: 7380 }),
    published: movie({ title_zh: "译名", durationSeconds: 7377 }),
    expected: { durationSeconds: 7377 },
    translated: [],
  },
  {
    group: "publishes source fields when translation is disabled",
    name: "publishes the source when it changed and translation is off",
    merged: movie({ title: "New Title" }),
    published: movie({ title_zh: "旧译名" }),
    enableTranslation: false,
    expected: { title: "New Title", title_zh: undefined },
    translated: [],
  },
  ...[true, false].map((enableTranslation) => ({
    group: enableTranslation
      ? "refreshes changed or unusable translations"
      : "publishes source fields when translation is disabled",
    name: `discards refused cached fields with translation ${enableTranslation ? "on" : "off"}`,
    merged: movie({ plot: "Source Plot" }),
    published: movie({
      title_zh: "无法提供该内容的翻译",
      plot: "Source Plot",
      plot_zh: "抱歉，我无法翻译这段内容。",
    }),
    enableTranslation,
    expected: {
      title: "Source Title",
      title_zh: enableTranslation ? "译:Source Title" : undefined,
      plot_zh: enableTranslation ? "译:Source Plot" : undefined,
    },
    translated: enableTranslation ? ["Source Title"] : [],
  })),
  {
    group: "refreshes changed or unusable translations",
    name: "does not reuse category refusal or classification warning cached as translated fields",
    merged: movie({ plot: "Source Plot" }),
    published: movie({
      title_zh: "抱歉，我无法翻译受限制类别内容。",
      plot: "Source Plot",
      plot_zh: "该文本包含涉及未成年人的露骨性内容。",
    }),
    expected: { title_zh: "译:Source Title", plot_zh: "译:Source Plot" },
    translated: ["Source Title"],
  },
  {
    group: "refreshes changed or unusable translations",
    name: "does not reuse a policy classification warning cached as a plot translation",
    merged: movie({ plot: "Source Plot" }),
    published: movie({ title_zh: "已有译名", plot: "Source Plot", plot_zh: "该文本包含涉及受限制对象的敏感内容。" }),
    expected: { title_zh: "已有译名", plot_zh: "译:Source Plot" },
    translated: [],
  },
  {
    group: "refreshes changed or unusable translations",
    name: "does not reuse a conditional alternative cached as a plot translation",
    merged: movie({ plot: "Source Plot" }),
    published: movie({ title_zh: "已有译名", plot: "Source Plot", plot_zh: "可以帮助翻译删去敏感细节后的版本。" }),
    expected: { title_zh: "已有译名", plot_zh: "译:Source Plot" },
    translated: [],
  },
  {
    group: "honors media-server locks without reusing refused translations",
    name: "clears refused locked translations while preserving their source fields",
    merged: movie({ title: "New Title" }),
    published: movie({ title_zh: "无法提供该内容的翻译" }),
    localState: { lockedFields: ["Name"] },
    expected: { title: "Source Title", title_zh: undefined },
    translated: [],
  },
  {
    group: "reuses valid unchanged translations",
    name: "preserves a valid cached translation mentioning an apology and inability",
    merged: movie({}),
    published: movie({ title_zh: "抱歉，我无法出席明天的会议。" }),
    expected: { title_zh: "抱歉，我无法出席明天的会议。" },
    translated: [],
  },
] as Array<{
  group: string;
  name: string;
  merged: CrawlerData;
  published: CrawlerData;
  localState?: NfoLocalState;
  keepEdits?: boolean;
  keepPublishedGenres?: boolean;
  enableTranslation?: boolean;
  expected: Partial<CrawlerData>;
  translated: string[];
}>;

describe("publishMetadata", () => {
  it.each([
    "reuses valid unchanged translations",
    "refreshes changed or unusable translations",
    "publishes source fields when translation is disabled",
    "honors media-server locks without reusing refused translations",
    "respects the keep-edits choice",
    "retains authoritative published genres",
    "retains measured duration",
  ])("%s", async (group) => {
    for (const {
      name,
      merged,
      published,
      localState,
      keepEdits = true,
      keepPublishedGenres,
      enableTranslation = true,
      expected,
      translated,
    } of cases.filter((item) => item.group === group)) {
      const translateService = new TranslateService(new NetworkClient());
      const translateMetadata = vi.spyOn(translateService, "translateMetadata").mockImplementation(async (input) => ({
        title: input.title && `译:${input.title}`,
        plot: input.plot && `译:${input.plot}`,
        genres: input.genres.map((genre) => `译:${genre}`),
      }));

      const result = await publishMetadata({
        data: merged,
        published: { crawlerData: published, localState },
        keepEdits,
        keepPublishedGenres,
        configuration: config(enableTranslation),
        translateService,
      });

      expect(result.data, name).toMatchObject(expected);
      expect(translateMetadata.mock.calls.map(([input]) => input.title).filter(Boolean), name).toEqual(translated);
    }
  });
});
