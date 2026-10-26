import {
  hasActorProfileContent,
  parseActorBloodType,
  parseActorDate,
  parseActorMeasurements,
  parseActorMetricCm,
} from "@mdcz/runtime/shared";
import type { ActorProfile } from "@mdcz/shared/types";
import { load } from "cheerio";
import {
  buildFieldDescription,
  extractBackgroundImageUrl,
  extractTextWithBreaks,
  getOwnText,
  type OfficialActressSummary,
  parseDefinitionList,
  toAbsoluteUrl,
  toNonEmptyString,
  toUniqueNames,
} from "../shared";
import type { OfficialActorSourceDependencies, OfficialSiteAdapter } from "../types";
import { AgencyOfficialAdapter, type AgencySite } from "./AgencyOfficialAdapter";

type ProfileFields = Array<[string, string | undefined]>;

const TPOWERS_BASE_URL = "https://www.t-powers.co.jp";
const CMORE_OFFICIAL_BASE_URL = "https://cmore.jp/official/";
const MINES_BASE_URL = "https://mines-pro.jp";
const LIFE_BASE_URL = "https://life-promotion.com";

const hasRosterEntry = (entry: OfficialActressSummary): boolean => Boolean(entry.name) && Boolean(entry.url);

/** Reads the facts every agency profile lists and keeps the remaining lines as the description. */
const buildAgencyProfile = (
  base: Pick<ActorProfile, "name" | "aliases" | "photo_url">,
  fieldList: ProfileFields,
  intro?: string,
): ActorProfile | null => {
  const fields = new Map(fieldList.map(([label, value]) => [label.replace(/\s+/gu, ""), value]));
  const profile: ActorProfile = {
    ...base,
    birth_date: parseActorDate(fields.get("生年月日") ?? fields.get("誕生日")),
    birth_place: toNonEmptyString(fields.get("出身地")),
    blood_type: parseActorBloodType(fields.get("血液型")),
    height_cm: parseActorMetricCm(fields.get("身長")),
    ...parseActorMeasurements(fields.get("スリーサイズ") ?? fields.get("サイズ")),
  };
  profile.description = buildFieldDescription(profile, fieldList, intro);
  return hasActorProfileContent(profile) ? profile : null;
};

const tpowers: AgencySite = {
  key: "tpowers",
  agency: "T-Powers",
  rosterUrl: `${TPOWERS_BASE_URL}/talent/`,
  parseRoster: (html) => {
    const $ = load(html);
    return $(".p-talent__list-item")
      .toArray()
      .map((element) => {
        const item = $(element);
        return {
          name: toNonEmptyString(item.find(".p-talent__list-name").first().text()) ?? "",
          aliases: [],
          url: toAbsoluteUrl(TPOWERS_BASE_URL, item.find("a").first().attr("href")),
          photoUrl: toAbsoluteUrl(TPOWERS_BASE_URL, item.find(".p-talent__list-thumb img").first().attr("src")),
        };
      })
      .filter(hasRosterEntry);
  },
  parseDetail: (html, actress) => {
    const $ = load(html);
    // The spec list pairs its labels and values as alternating siblings.
    const nodes = $(".p-talent-detail__spec").first().children().toArray();
    const fields: ProfileFields = [];
    for (let index = 0; index < nodes.length; index += 2) {
      fields.push([$(nodes[index]).text(), toNonEmptyString($(nodes[index + 1]).text())]);
    }
    return buildAgencyProfile(
      {
        name:
          toNonEmptyString($(".p-talent-detail__name-pc").first().text()) ??
          toNonEmptyString($(".p-talent-detail__name-sp").first().text()) ??
          actress.name,
        aliases: toUniqueNames([$(".p-talent-detail__vis-name-item").first().text()]),
        photo_url:
          extractBackgroundImageUrl(TPOWERS_BASE_URL, $(".p-talent-detail__vis-slider-img").first().attr("style")) ??
          actress.photoUrl,
      },
      fields,
    );
  },
};

const cmore: AgencySite = {
  key: "cmore",
  agency: "C-more",
  rosterUrl: `${CMORE_OFFICIAL_BASE_URL}model.html`,
  parseRoster: (html) => {
    const $ = load(html);
    return $(".list-box_item")
      .toArray()
      .map((element) => {
        const item = $(element);
        return {
          name: getOwnText(item.find(".heading-lv4").first()) ?? "",
          aliases: [],
          url: toAbsoluteUrl(CMORE_OFFICIAL_BASE_URL, item.find("a.box").first().attr("href")),
          photoUrl: toAbsoluteUrl(CMORE_OFFICIAL_BASE_URL, item.find(".box_eyecatch img").first().attr("src")),
        };
      })
      .filter(hasRosterEntry);
  },
  parseDetail: (html, actress) => {
    const $ = load(html);
    const contentBlocks = $(".block-item_content");
    // The first block lists 【label】 and value on alternating lines; the second holds the written bio.
    const lines = load(`<div>${(contentBlocks.first().html() ?? "").replace(/<br\s*\/?>/giu, "\n")}</div>`)("div")
      .text()
      .split(/\n+/u)
      .map((line) => toNonEmptyString(line.replace(/[【】]/gu, "")))
      .filter((line): line is string => Boolean(line));
    const fields: ProfileFields = [];
    for (let index = 0; index < lines.length - 1; index += 2) {
      fields.push([lines[index], lines[index + 1]]);
    }
    // サイズ starts with the height, as in "T:158 B:101(J) W:55 H:84".
    const size = fields.find(([label]) => label === "サイズ")?.[1];
    fields.push(["身長", size?.normalize("NFKC").match(/T\s*:?\s*(\d+)/u)?.[1]]);
    return buildAgencyProfile(
      {
        name: toNonEmptyString($("title").text())?.split("｜")[0] ?? actress.name,
        photo_url:
          toAbsoluteUrl(CMORE_OFFICIAL_BASE_URL, $(".block-item_media-large img").first().attr("src")) ??
          actress.photoUrl,
      },
      fields,
      extractTextWithBreaks(
        (contentBlocks.length > 1 ? contentBlocks.eq(1) : contentBlocks.first()).html() ?? undefined,
      ),
    );
  },
};

const nax: AgencySite = {
  key: "nax",
  agency: "NAX",
  rosterUrl: "https://official.nax-pro.com/model/",
  parseRoster: (html) => {
    const $ = load(html);
    return $("article.c-ArticleCard_Model")
      .toArray()
      .map((element) => {
        const item = $(element);
        const link = item.find(".c-ArticleCard_Model_Title-Link").first();
        return {
          name: toNonEmptyString(link.text()) ?? "",
          aliases: [],
          url: toNonEmptyString(link.attr("href")),
          photoUrl: toNonEmptyString(item.find(".c-ArticleCard_Model_Thumbnail-Img").first().attr("src")),
        };
      })
      .filter(hasRosterEntry);
  },
  parseDetail: (html, actress) => {
    const $ = load(html);
    return buildAgencyProfile(
      {
        name: toNonEmptyString($(".c-Model-Single_Top-Title").first().text()) ?? actress.name,
        aliases: toUniqueNames([$(".c-Model-Single_Top-Title-Kana").first().text()]),
        photo_url: toNonEmptyString($(".c-Model_Top-Img").first().attr("src")) ?? actress.photoUrl,
      },
      parseDefinitionList($(".c-Model-Single_Top_ProfileList").first()),
    );
  },
};

const mines: AgencySite = {
  key: "mines",
  agency: "Mine's",
  rosterUrl: `${MINES_BASE_URL}/model/`,
  parseRoster: (html) => {
    const $ = load(html);
    return $(".modelColumn")
      .toArray()
      .map((element) => {
        const item = $(element);
        return {
          name: toNonEmptyString(item.find(".name").first().text()) ?? "",
          aliases: [],
          url: toAbsoluteUrl(MINES_BASE_URL, item.find("a").first().attr("href")),
          photoUrl: toAbsoluteUrl(MINES_BASE_URL, item.find(".photo img").first().attr("src")),
        };
      })
      .filter(hasRosterEntry);
  },
  parseDetail: (html, actress) => {
    const $ = load(html);
    const layout = $(".modelProfileLayout").first();
    return buildAgencyProfile(
      {
        name: toNonEmptyString(layout.find(".profileName_name").first().text()) ?? actress.name,
        aliases: toUniqueNames([layout.find(".profileName_kana").first().text()]),
        photo_url:
          toAbsoluteUrl(MINES_BASE_URL, layout.find(".profilePhoto img").first().attr("src")) ?? actress.photoUrl,
      },
      // The SNS entry holds follow buttons, not account names.
      parseDefinitionList(layout.find(".profileData").first()).filter(([label]) => label !== "SNS"),
    );
  },
};

const alive: AgencySite = {
  key: "alive",
  agency: "ALIVE",
  rosterUrl: "https://alive-pro.tokyo/model",
  parseRoster: (html) => {
    const $ = load(html);
    return $("#Modellist li")
      .toArray()
      .map((element) => {
        const item = $(element);
        return {
          name: toNonEmptyString(item.find("h3").first().text()) ?? "",
          aliases: toUniqueNames([item.find("p").first().text()]),
          url: toNonEmptyString(item.find("a").first().attr("href")),
          photoUrl: toNonEmptyString(item.find("img").first().attr("src")),
        };
      })
      .filter(hasRosterEntry);
  },
  parseDetail: (html, actress) => {
    const $ = load(html);
    const heading = $("#ProfileBox h2").first();
    return buildAgencyProfile(
      {
        name: getOwnText(heading) ?? actress.name,
        aliases: toUniqueNames([heading.find("span").first().text(), $("#ProfileBox .texbox > p").first().text()]),
        photo_url: toNonEmptyString($("#ProfileBox .swiper-slide img").first().attr("src")) ?? actress.photoUrl,
      },
      $("#ProfileBox .texbox li")
        .toArray()
        .map((element) => [
          $(element).find("span").first().text(),
          toNonEmptyString($(element).find("b").first().text()),
        ]),
    );
  },
};

const life: AgencySite = {
  key: "life",
  agency: "ライフプロモーション",
  // The /model/ index answers 403; the home page links every model.
  rosterUrl: `${LIFE_BASE_URL}/`,
  parseRoster: (html) => {
    const $ = load(html);
    return $("a.model")
      .toArray()
      .map((element) => {
        const item = $(element);
        const heading = item.find("h3").first();
        return {
          name: getOwnText(heading) ?? "",
          aliases: toUniqueNames([heading.find("span").first().text()]),
          url: toAbsoluteUrl(LIFE_BASE_URL, item.attr("href")),
        };
      })
      .filter(hasRosterEntry);
  },
  parseDetail: (html, actress) => {
    const $ = load(html);
    const heading = $("article h1").first();
    return buildAgencyProfile(
      {
        name: getOwnText(heading) ?? actress.name,
        aliases: toUniqueNames([heading.find("span").first().text()]),
        photo_url: toAbsoluteUrl(LIFE_BASE_URL, $("article img.model").first().attr("src")),
      },
      $(".profile_child p")
        .toArray()
        .map((element) => {
          const [label = "", ...value] = $(element).text().split("：");
          return [label, toNonEmptyString(value.join("："))];
        }),
    );
  },
};

export const createOfficialAgencyAdapters = (deps: OfficialActorSourceDependencies): OfficialSiteAdapter[] =>
  [tpowers, cmore, nax, mines, alive, life].map((site) => new AgencyOfficialAdapter(deps, site));
