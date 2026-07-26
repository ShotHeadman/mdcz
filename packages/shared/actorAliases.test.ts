import { describe, expect, it } from "vitest";
import { resolveActorAlias, resolveActorAliasCandidates } from "./actorAliases";

describe("actor aliases", () => {
  const actorAliases = {
    河北彩花: ["河北彩伽", "河北彩花（河北彩伽）"],
    三上悠亚: ["鬼頭桃菜", "鬼头桃菜"],
  };

  it("resolves canonical names and aliases using normalized matching", () => {
    expect(resolveActorAlias(actorAliases, " 河北彩伽 ")).toEqual({
      canonicalName: "河北彩花",
      aliases: ["河北彩花", "河北彩伽", "河北彩花（河北彩伽）"],
    });
  });

  it("uses a configured group when any lookup name matches and keeps the first name otherwise", () => {
    expect(resolveActorAliasCandidates(actorAliases, [" 旧名字 ", "鬼头桃菜"])).toEqual({
      canonicalName: "三上悠亚",
      aliases: ["三上悠亚", "鬼頭桃菜", "鬼头桃菜", "旧名字"],
    });
    expect(resolveActorAliasCandidates(actorAliases, ["深田えいみ", "Eimi Fukada"])).toEqual({
      canonicalName: "深田えいみ",
      aliases: ["深田えいみ", "Eimi Fukada"],
    });
  });
});
