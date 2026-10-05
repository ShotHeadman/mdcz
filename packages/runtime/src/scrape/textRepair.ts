import type { Configuration } from "@mdcz/shared/config";
import { repairMaskedWords, repairTitle, stripTrailingActorNames } from "@mdcz/shared/titleRepair";
import type { CrawlerData } from "@mdcz/shared/types";

export const applyTextRepair = (data: CrawlerData, configuration: Configuration["titleRepair"]): CrawlerData => {
  const title = configuration.stripTrailingActors ? stripTrailingActorNames(data.title, data.actors) : data.title;
  if (!configuration.enabled) return { ...data, title };

  const repairedTitle = data.original_title ? title : repairTitle(title);
  return {
    ...data,
    title: repairedTitle,
    original_title: repairedTitle === title ? data.original_title : title,
    plot: data.plot && repairMaskedWords(data.plot),
  };
};
