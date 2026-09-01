import type { AssetRef, RootFileRef } from "@mdcz/shared/mediaRef";
import type { CrawlerData } from "@mdcz/shared/types";
import type { PublicationPlan } from "./types";

type PublicationLibraryAsset =
  | { kind: string; uri: string; rootId: string; relativePath: string }
  | { kind: string; uri: string };

const thumbnailPathFromAsset = (asset: AssetRef): string =>
  asset.type === "local" ? asset.file.relativePath : asset.url;

const libraryAssetFromPlan = (asset: AssetRef): PublicationLibraryAsset =>
  asset.type === "local"
    ? {
        kind: asset.kind,
        uri: asset.file.relativePath,
        rootId: asset.file.rootId,
        relativePath: asset.file.relativePath,
      }
    : { kind: asset.kind, uri: asset.url };

export const libraryEntryFromPublicationPlan = (
  plan: PublicationPlan,
  crawlerData: Pick<CrawlerData, "title" | "number" | "actors">,
  output: RootFileRef,
) => {
  const thumbnail = plan.assets.find((asset) => asset.kind === "poster" || asset.kind === "thumb");
  return {
    mediaIdentity: crawlerData.number,
    rootId: output.rootId,
    rootRelativePath: output.relativePath,
    title: crawlerData.title,
    number: crawlerData.number,
    actors: crawlerData.actors,
    thumbnailPath: thumbnail ? thumbnailPathFromAsset(thumbnail) : null,
    assets: plan.assets.map(libraryAssetFromPlan),
    lastKnownPath: output.relativePath,
  };
};
