import type { Configuration } from "@mdcz/shared/config";
import { previewTitleRepair } from "@mdcz/shared/titleRepair";
import type { CrawlerData } from "@mdcz/shared/types";

type TitleRepairConfiguration = Configuration["titleRepair"];

export const applyTitleRepair = (data: CrawlerData, configuration: TitleRepairConfiguration): CrawlerData => {
  if (data.original_title) {
    return data;
  }

  const preview = previewTitleRepair(data.title, configuration);
  if (!preview.applied) {
    return data;
  }

  return {
    ...data,
    title: preview.repairedTitle,
    original_title: preview.originalTitle,
  };
};
