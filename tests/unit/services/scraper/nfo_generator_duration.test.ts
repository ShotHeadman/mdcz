import { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import { describe, expect, it } from "vitest";

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample",
  number: "ABC-123",
  actors: [],
  genres: [],
  sample_images: [],
  website: Website.DMM,
  ...overrides,
});

describe("NfoGenerator runtime fallback", () => {
  it("uses crawler duration when local video metadata is unavailable", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        durationSeconds: 5400,
      }),
    );

    expect(xml).toContain("<runtime>90</runtime>");
  });

  it("prefers local video metadata duration over crawler duration", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        durationSeconds: 5400,
      }),
      {
        videoMeta: {
          durationSeconds: 3600,
          width: 1920,
          height: 1080,
        },
      },
    );

    expect(xml).toContain("<runtime>60</runtime>");
  });
});
