import { hasMissingActorInfo, planPersonSync } from "@main/services/personSync/planner";
import { describe, expect, it } from "vitest";

describe("person sync planner", () => {
  it("fills missing actor native fields and managed overview summary without overwriting the existing body", () => {
    const result = planPersonSync(
      {
        name: "神木麗",
        aliases: ["神木れい", "かみきれい"],
        description: "官方简介",
        birth_date: "1999-12-20",
        birth_place: "埼玉県",
        blood_type: "A",
        height_cm: 169,
        bust_cm: 95,
        waist_cm: 60,
        hip_cm: 85,
        cup_size: "G",
      },
      {
        overview: "已有简介",
        tags: ["favorite"],
        taglines: [],
      },
      "missing",
    );

    expect(result.shouldUpdate).toBe(true);
    expect(result.updatedFields).toEqual(["overview", "premiereDate", "productionYear", "productionLocations"]);
    expect(result.overview).toBe(
      "基本资料\n血型：A型\n身高：169cm\n三围：B95 W60 H85\n罩杯：G杯\n\n已有简介\n\n别名：神木れい / かみきれい",
    );
    expect(result.tags).toEqual(["favorite"]);
    expect(result.taglines).toEqual([]);
    expect(result.premiereDate).toBe("1999-12-20T00:00:00.000Z");
    expect(result.productionYear).toBe(1999);
    expect(result.productionLocations).toEqual(["埼玉県"]);
  });

  it("refreshes managed overview summary and native person fields in all mode while preserving user tags and user taglines", () => {
    const result = planPersonSync(
      {
        name: "神木麗",
        aliases: ["神木れい", "かみきれい"],
        description: "官方简介",
        birth_date: "1999-12-20",
        birth_place: "埼玉県",
        blood_type: "A",
        height_cm: 169,
      },
      {
        overview: "旧简介",
        tags: ["favorite", "mdcz:height_cm:160"],
        taglines: ["常驻收藏", "MDCz: 160cm"],
        premiereDate: "1999-12-19T00:00:00.000Z",
        productionYear: 1998,
        productionLocations: ["东京", "埼玉県"],
      },
      "all",
    );

    expect(result.shouldUpdate).toBe(true);
    expect(result.updatedFields).toEqual([
      "overview",
      "tags",
      "taglines",
      "premiereDate",
      "productionYear",
      "productionLocations",
    ]);
    expect(result.overview).toBe("基本资料\n血型：A型\n身高：169cm\n\n官方简介\n\n别名：神木れい / かみきれい");
    expect(result.tags).toEqual(["favorite"]);
    expect(result.taglines).toEqual(["常驻收藏"]);
    expect(result.premiereDate).toBe("1999-12-20T00:00:00.000Z");
    expect(result.productionYear).toBe(1999);
    expect(result.productionLocations).toEqual(["埼玉県", "东京"]);
  });

  it("appends aliases to the existing overview in all mode when the source has no description", () => {
    const result = planPersonSync(
      {
        name: "神木麗",
        aliases: ["神木れい", "かみきれい"],
      },
      {
        overview: "旧简介\n\n别名：旧别名",
        tags: ["favorite", "mdcz:birth_date:1999-12-20"],
        taglines: ["MDCz: 1999-12-20"],
        premiereDate: "1999-12-20T00:00:00.000Z",
        productionYear: 1999,
        productionLocations: ["埼玉県"],
      },
      "all",
    );

    expect(result.shouldUpdate).toBe(true);
    expect(result.updatedFields).toEqual(["overview", "tags", "taglines"]);
    expect(result.overview).toBe("旧简介\n\n别名：神木れい / かみきれい");
    expect(result.tags).toEqual(["favorite"]);
    expect(result.taglines).toEqual([]);
  });

  it("rebuilds the managed profile block while preserving the existing custom overview", () => {
    const result = planPersonSync(
      {
        name: "神木麗",
        aliases: ["神木れい"],
        height_cm: 169,
      },
      {
        overview: "基本资料\n身高：160cm\n\n旧简介\n\n别名：旧别名",
        tags: ["favorite"],
        taglines: [],
      },
      "all",
    );

    expect(result.shouldUpdate).toBe(true);
    expect(result.updatedFields).toEqual(["overview"]);
    expect(result.overview).toBe("基本资料\n身高：169cm\n\n旧简介\n\n别名：神木れい");
  });

  it("detects whether actor info is still missing", () => {
    expect(
      hasMissingActorInfo(
        {
          overview: "基本资料\n血型：A型\n身高：169cm\n\n已有简介\n\n别名：神木れい",
          tags: ["favorite"],
          taglines: [],
          premiereDate: "1999-12-20T00:00:00.000Z",
          productionYear: 1999,
          productionLocations: ["埼玉県"],
        },
        {
          name: "神木麗",
          aliases: ["神木れい"],
          blood_type: "A",
          height_cm: 169,
          birth_date: "1999-12-20",
          birth_place: "埼玉県",
        },
      ),
    ).toBe(false);

    expect(
      hasMissingActorInfo(
        {
          overview: "已有简介",
          tags: ["favorite"],
          taglines: [],
        },
        {
          name: "神木麗",
          blood_type: "A",
          height_cm: 169,
          birth_date: "1999-12-20",
          birth_place: "埼玉県",
        },
      ),
    ).toBe(true);

    expect(
      hasMissingActorInfo(
        {
          overview: "基本资料\n血型：A型\n身高：169cm\n\n已有简介\n\n别名：神木れい",
          tags: ["favorite", "mdcz:birth_date:1999-12-20"],
          taglines: ["MDCz: 1999-12-20"],
          premiereDate: "1999-12-20T00:00:00.000Z",
          productionYear: 1999,
          productionLocations: ["埼玉県"],
        },
        {
          name: "神木麗",
          aliases: ["神木れい"],
          blood_type: "A",
          height_cm: 169,
          birth_date: "1999-12-20",
          birth_place: "埼玉県",
        },
      ),
    ).toBe(true);
  });
});
