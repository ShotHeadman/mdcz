import { FetchGateway } from "@main/services/crawler/FetchGateway";
import { BaseFc2Crawler } from "@main/services/crawler/sites/BaseFc2Crawler";
import { NetworkClient } from "@main/services/network";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import { describe, expect, it } from "vitest";

class TestFc2Crawler extends BaseFc2Crawler {
  site(): Website {
    return Website.FC2;
  }

  protected async generateSearchUrl(): Promise<string | null> {
    return null;
  }

  protected async parseSearchPage(): Promise<string | null> {
    return null;
  }

  protected async parseDetailPage(): Promise<CrawlerData | null> {
    return null;
  }

  buildForTest(fields: Parameters<BaseFc2Crawler["buildFc2Data"]>[1], number = "4327962"): CrawlerData {
    return this.buildFc2Data(
      {
        number,
        site: Website.FC2,
        options: {},
      },
      fields,
    );
  }
}

describe("BaseFc2Crawler", () => {
  const crawler = new TestFc2Crawler({
    gateway: new FetchGateway(new NetworkClient()),
  });

  it("does not treat studio as actors by default", () => {
    const data = crawler.buildForTest({
      title: "FC2 Test Title",
      studio: "DIVA's Entertainment",
    });

    expect(data.number).toBe("FC2-4327962");
    expect(data.actors).toEqual([]);
    expect(data.studio).toBe("DIVA's Entertainment");
    expect(data.publisher).toBe("DIVA's Entertainment");
    expect(data.series).toBe("FC2系列");
  });

  it("keeps explicit actors when the crawler provides them", () => {
    const data = crawler.buildForTest({
      title: "FC2 Test Title",
      studio: "Seller Name",
      actors: ["ゆうな"],
    });

    expect(data.actors).toEqual(["ゆうな"]);
    expect(data.studio).toBe("Seller Name");
    expect(data.publisher).toBe("Seller Name");
  });
});
