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

describe("publishMetadata", () => {
  it.each([
    {
      name: "keeps an existing translation, whoever wrote it, while the source is unchanged",
      merged: movie({ plot: "Source Plot" }),
      published: movie({ title_zh: "外部译名", plot: "Source Plot", plot_zh: "外部简介" }),
      expected: { title: "Source Title", title_zh: "外部译名", plot_zh: "外部简介" },
      translated: [],
    },
    {
      name: "translates a changed source",
      merged: movie({ title: "New Title" }),
      published: movie({ title_zh: "旧译名" }),
      expected: { title: "New Title", title_zh: "译:New Title" },
      translated: ["New Title"],
    },
    {
      name: "keeps fields locked in the media server",
      merged: movie({ title: "New Title", actors: ["Actor B"] }),
      published: movie({ title_zh: "手改译名", actors: ["Actor A"] }),
      localState: { lockedFields: ["name", "Cast"] },
      expected: { title: "Source Title", title_zh: "手改译名", actors: ["Actor A"] },
      translated: [],
    },
    {
      name: "keeps fields edited since publishing when scraping",
      merged: movie({ title: "New Title", genres: ["Site"] }),
      published: movie({ title_zh: "手改标题", genres: ["User"] }),
      localState: { edits: { title: "edited", genre: "edited" } },
      keepEdits: true,
      expected: { title: "Source Title", title_zh: "手改标题", genres: ["User"] },
      translated: [],
    },
    {
      name: "offers site values for edited fields, translating rather than reusing an edited title",
      merged: movie({ genres: ["Site"] }),
      published: movie({ title_zh: "手改标题", genres: ["User"] }),
      localState: { edits: { title: "edited", genre: "edited" } },
      keepEdits: false,
      expected: { title: "Source Title", title_zh: "译:Source Title", genres: ["译:Site"] },
      translated: ["Source Title"],
    },
    {
      name: "keeps the runtime the NFO measured from the video over the sites' catalog runtime",
      merged: movie({ durationSeconds: 7380 }),
      published: movie({ title_zh: "译名", durationSeconds: 7377 }),
      expected: { durationSeconds: 7377 },
      translated: [],
    },
    {
      name: "publishes the source when it changed and translation is off",
      merged: movie({ title: "New Title" }),
      published: movie({ title_zh: "旧译名" }),
      enableTranslation: false,
      expected: { title: "New Title", title_zh: undefined },
      translated: [],
    },
  ] as Array<{
    name: string;
    merged: CrawlerData;
    published: CrawlerData;
    localState?: NfoLocalState;
    keepEdits?: boolean;
    enableTranslation?: boolean;
    expected: Partial<CrawlerData>;
    translated: string[];
  }>)("$name", async ({
    merged,
    published,
    localState,
    keepEdits = true,
    enableTranslation = true,
    expected,
    translated,
  }) => {
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
      configuration: config(enableTranslation),
      translateService,
    });

    expect(result.data).toMatchObject(expected);
    expect(translateMetadata.mock.calls.map(([input]) => input.title).filter(Boolean)).toEqual(translated);
  });
});
