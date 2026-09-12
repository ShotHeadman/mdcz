import type { AssetRef } from "@mdcz/shared/mediaRef";
import type { PublicationPlan } from "./types";

type PublicationLibraryAsset =
  | { kind: string; uri: string; rootId: string; relativePath: string }
  | { kind: string; uri: string };

const libraryAssetFromPlan = (asset: AssetRef): PublicationLibraryAsset =>
  asset.type === "local"
    ? {
        kind: asset.kind,
        uri: asset.file.relativePath,
        rootId: asset.file.rootId,
        relativePath: asset.file.relativePath,
      }
    : { kind: asset.kind, uri: asset.url };

export const libraryAssetsFromPublicationPlan = (plan: Pick<PublicationPlan, "assets">) =>
  plan.assets.map(libraryAssetFromPlan);
