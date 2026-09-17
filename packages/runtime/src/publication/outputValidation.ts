import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { PublicationConflictError } from "./conflicts";
import { publicationAssets } from "./libraryEntry";
import type { PublicationPaths } from "./paths";
import { publicationRefKey as refKey } from "./paths";
import { type ObservedPublicationFile, publicationSources } from "./preflight";
import { publicationOperations } from "./publicationPlan";
import type { PublicationPlan, PublishMediaOptions } from "./types";

export const prepareOutputValidation = async (
  plan: PublicationPlan,
  options: Pick<PublishMediaOptions<unknown>, "outputs" | "resolveRoot">,
  paths: PublicationPaths,
  observed: readonly ObservedPublicationFile[],
): Promise<{ assertCurrent(): void; obsolete: RootFileRef[] } | undefined> => {
  const store = options.outputs;
  if (!store) return undefined;
  const { absolute, key } = paths;
  const query = { paths: paths.queryPaths, includeOwners: true };
  const snapshot = store.publicationSnapshot(query);
  await paths.prepare([...snapshot.files, ...snapshot.assets]);
  const owners = new Set(plan.kind === "movie" ? [plan.movieId] : []);
  for (const media of plan.files) {
    const references = snapshot.files.filter((file) => key(file) === key(media.source));
    if (new Set(references.map((file) => file.itemId)).size > 1)
      throw new PublicationConflictError(
        absolute(media.source),
        absolute(media.target),
        "同一视频文件已被媒体库中的多个影片重复引用",
      );
    if (references.some((file) => !owners.has(file.itemId) || media.fileId !== file.fileId)) {
      throw new PublicationConflictError(
        absolute(media.source),
        absolute(media.target),
        "文件所属的影片与媒体库已登记信息不符",
      );
    }
  }
  const removable = (ref: RootFileRef, fileId?: string | null) => {
    const references = snapshot.assets.filter((asset) => key(asset) === key(ref));
    const fileReferences = snapshot.files.filter((file) => key(file) === key(ref));
    if (plan.kind === "unmanaged") return references.length === 0 && fileReferences.length === 0;
    if (fileId === undefined && references.length === 0 && fileReferences.length === 0) return true;
    return (
      ((references.length > 0 &&
        references.every(
          (asset) =>
            asset.published &&
            !asset.historical &&
            owners.has(asset.itemId) &&
            (fileId === undefined || asset.fileId === fileId),
        )) ||
        (fileId === undefined &&
          fileReferences.length > 0 &&
          fileReferences.every((file) => owners.has(file.itemId)))) &&
      !snapshot.files.some((file) => key(file) === key(ref) && !owners.has(file.itemId))
    );
  };
  const targets = publicationOperations(plan).map((operation) => operation.target);
  const missing: typeof snapshot.assets = [];
  const scopedOperations = [
    ...plan.operations.map((operation) => ({ operation, fileId: null })),
    ...plan.files.flatMap((file) => file.operations.map((operation) => ({ operation, fileId: file.fileId }))),
  ];
  for (const { operation, fileId } of scopedOperations) {
    const target = operation.target;
    const fact = observed.find((file) => file.path === absolute(target));
    if (!fact) throw new Error(`Publication target was not observed: ${absolute(target)}`);
    if (!fact.exists) {
      if (snapshot.assets.some((asset) => key(asset) === key(target) && !owners.has(asset.itemId))) {
        throw new PublicationConflictError(plan.operationId, absolute(target), "目标文件已被媒体库中的其他影片占用");
      }
      missing.push(...snapshot.assets.filter((asset) => key(asset) === key(target)));
      continue;
    }
    if (!removable(target, fileId))
      throw new PublicationConflictError(
        publicationSources(plan)[0] ? absolute(publicationSources(plan)[0].source) : absolute(target),
        absolute(target),
        "目标文件已被其他影片占用，无法覆盖",
      );
  }
  const obsolete = plan.obsolete.filter((ref) => removable(ref));
  const retainedOutputs = publicationAssets(plan).flatMap((asset) =>
    asset.type === "local" &&
    !targets.some((target) => key(target) === key(asset.file)) &&
    snapshot.assets.some((reference) => reference.published && key(reference) === key(asset.file))
      ? [asset.file]
      : [],
  );
  for (const ref of retainedOutputs)
    if (snapshot.assets.some((asset) => key(asset) === key(ref) && !owners.has(asset.itemId)))
      throw new PublicationConflictError(
        publicationSources(plan)[0] ? absolute(publicationSources(plan)[0].source) : absolute(ref),
        absolute(ref),
        "共享该资源的其他影片未包含在本次发布中",
      );

  const sourceKeys = new Set(publicationSources(plan).map((media) => key(media.source)));
  const expectedFiles =
    plan.kind === "movie" ? plan.expected.files : snapshot.files.filter((file) => sourceKeys.has(key(file)));
  const membershipChanged = (files: typeof snapshot.files) =>
    expectedFiles.some(
      (expected) =>
        !files.some(
          (file) =>
            file.fileId === expected.fileId && file.itemId === expected.itemId && refKey(file) === refKey(expected),
        ),
    ) ||
    (plan.kind === "movie" &&
      files.some(
        (file) =>
          file.itemId === plan.movieId &&
          !expectedFiles.some((expected) => expected.fileId === file.fileId && expected.itemId === file.itemId),
      ));
  if (membershipChanged(snapshot.files))
    throw new PublicationConflictError(plan.operationId, plan.operationId, "影片关联的视频文件发生变动，请重新提交");
  const protectedKeys = new Set(
    [
      ...targets,
      ...retainedOutputs,
      ...obsolete,
      ...publicationOperations(plan).flatMap((operation) => (operation.kind === "move" ? [operation.source] : [])),
    ].map(key),
  );
  const relationKey = (asset: (typeof snapshot.assets)[number]) =>
    `${asset.itemId}\0${asset.fileId ?? ""}\0${asset.kind}\0${refKey(asset)}`;
  const missingReferences = new Set(missing.map(relationKey));
  const expectedReferences = snapshot.assets
    .filter((asset) => protectedKeys.has(key(asset)) && !missingReferences.has(relationKey(asset)))
    .map(relationKey);
  const assertCurrent = () => {
    const current = store.publicationSnapshot({ paths: query.paths });
    const owned = store.publicationSnapshot(query);
    const declaredAssets = (plan.kind === "movie" ? plan.expected.assets : []).filter((asset) => asset.fileId === null);
    const ownerAssets = owned.assets.filter(
      (asset) => owners.has(asset.itemId) && asset.fileId === null && !asset.historical,
    );
    const assetState = (asset: (typeof current.assets)[number]) =>
      `${relationKey(asset)}\0${asset.published}\0${asset.historical}`;
    const declaredStates = new Set(declaredAssets.map(assetState));
    const scopeChanged =
      ownerAssets.length !== declaredAssets.length ||
      ownerAssets.some((asset) => !declaredStates.has(assetState(asset)));
    const currentReferences = new Set(current.assets.map(relationKey));
    const changed =
      scopeChanged ||
      expectedReferences.some((reference) => !currentReferences.has(reference)) ||
      membershipChanged(owned.files) ||
      current.files.some(
        (file) =>
          (sourceKeys.has(key(file)) &&
            !expectedFiles.some((expected) => expected.fileId === file.fileId && expected.itemId === file.itemId)) ||
          (protectedKeys.has(key(file)) && !owners.has(file.itemId)),
      ) ||
      current.assets.some(
        (asset) =>
          protectedKeys.has(key(asset)) &&
          !missingReferences.has(relationKey(asset)) &&
          (!owners.has(asset.itemId) || !asset.published || asset.historical),
      );
    if (changed)
      throw new PublicationConflictError(
        plan.operationId,
        plan.operationId,
        "处理期间媒体库记录已发生变动，请重新提交",
      );
  };
  return { assertCurrent, obsolete };
};
