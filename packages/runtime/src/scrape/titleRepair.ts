import type { Configuration } from "@mdcz/shared/config";
import { previewTitleRepair, stripTrailingActorNames } from "@mdcz/shared/titleRepair";
import type { CrawlerData } from "@mdcz/shared/types";

type TitleRepairConfiguration = Configuration["titleRepair"];

export const applyTitleRepair = (data: CrawlerData, configuration: TitleRepairConfiguration): CrawlerData => {
  const title = configuration.stripTrailingActors ? stripTrailingActorNames(data.title, data.actors) : data.title;
  const preview = data.original_title ? undefined : previewTitleRepair(title, configuration);
  if (preview?.applied) {
    return { ...data, title: preview.repairedTitle, original_title: preview.originalTitle };
  }
  return title === data.title ? data : { ...data, title };
};
