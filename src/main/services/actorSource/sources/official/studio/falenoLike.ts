import {
  hasActorProfileContent,
  parseActorDate,
  parseActorMeasurements,
  parseActorMetricCm,
} from "@main/utils/actorProfile";
import type { ActorProfile } from "@shared/types";
import { load } from "cheerio";
import type { OfficialActressSummary } from "../shared";
import { buildFieldDescription, getOwnText, parseActressProfileFields, toAbsoluteUrl, toUniqueNames } from "../shared";

export const parseFalenoLikeRoster = (html: string, baseUrl: string): OfficialActressSummary[] => {
  const $ = load(html);
  return $(".box_actress01 li")
    .toArray()
    .map((element) => {
      const item = $(element);
      const nameNode = item.find(".text_name").first();
      return {
        name: getOwnText(nameNode) ?? "",
        aliases: toUniqueNames([nameNode.find("span").first().text()]),
        url: toAbsoluteUrl(baseUrl, item.find(".img_actress01 a").first().attr("href")),
        photoUrl: toAbsoluteUrl(baseUrl, item.find(".img_actress01 img").first().attr("src")),
      };
    })
    .filter((entry) => Boolean(entry.name) && Boolean(entry.url));
};

export const parseFalenoLikeDetail = (html: string, baseUrl: string, fallbackName: string): ActorProfile | null => {
  const $ = load(html);
  const heading = $(".bar02_category h1, h1").first();
  const fields = new Map(parseActressProfileFields($));
  const measurements = parseActorMeasurements(fields.get("スリーサイズ"));
  const profile: ActorProfile = {
    name: getOwnText(heading) ?? fallbackName,
    aliases: toUniqueNames([heading.find("span").first().text()]),
    birth_date: parseActorDate(fields.get("誕生日")),
    birth_place: fields.get("出身地"),
    description: buildFieldDescription(Array.from(fields.entries())),
    height_cm: parseActorMetricCm(fields.get("身長")),
    bust_cm: measurements.bust_cm,
    waist_cm: measurements.waist_cm,
    hip_cm: measurements.hip_cm,
    cup_size: measurements.cup_size,
    photo_url: toAbsoluteUrl(baseUrl, $(".box_actress02_left img").first().attr("src")),
  };

  return hasActorProfileContent(profile) ? profile : null;
};
