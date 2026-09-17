import type { AssetRef } from "@mdcz/shared/mediaRef";
import { publicationRefKey } from "./paths";
import { publicationOperations } from "./publicationPlan";
import type { PublicationPlan } from "./types";

export interface PublicationLibraryAsset {
  kind: string;
  uri: string;
  rootId?: string | null;
  relativePath?: string | null;
  published?: boolean;
}

export const libraryAssetsFromPublicationPlan = (
  plan: PublicationPlan,
  assets: readonly AssetRef[],
): PublicationLibraryAsset[] => {
  const published = new Set([
    ...publicationOperations(plan).map((operation) => publicationRefKey(operation.target)),
    ...(plan.kind === "movie" ? plan.expected.assets : [])
      .filter((reference) => reference.published)
      .map(publicationRefKey),
  ]);
  return assets.map((asset) => {
    if (asset.type === "remote") return { kind: asset.kind, uri: asset.url };
    return {
      kind: asset.kind,
      uri: asset.file.relativePath,
      rootId: asset.file.rootId,
      relativePath: asset.file.relativePath,
      ...(published.has(publicationRefKey(asset.file)) ? { published: true } : {}),
    };
  });
};

export const publicationAssets = (plan: PublicationPlan): AssetRef[] => [
  ...plan.movieAssets,
  ...plan.files.flatMap((media) => media.assets),
];

export const publicationResultAssets = (plan: PublicationPlan, media: PublicationPlan["files"][number]): AssetRef[] => [
  ...plan.movieAssets,
  ...media.assets,
];
