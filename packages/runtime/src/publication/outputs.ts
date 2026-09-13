import { extname } from "node:path";
import { resolveRootRelativePath } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { publicationPathKey, publicationRefKey as refKey, resolvePublicationReferenceKeys } from "./boundary";
import { PublicationConflictError } from "./conflicts";
import type { PublicationFileSystem, PublicationOutputPort, PublicationPlan, PublishMediaOptions } from "./types";

/** Captured under publication locks; the returned write runs in the journal transaction. */
export const prepareOutputRegistration = async (
  plan: PublicationPlan,
  options: Pick<PublishMediaOptions<unknown>, "outputs" | "ownerId" | "resolveRoot">,
  fileSystem: PublicationFileSystem,
): Promise<{ register(): void; assertCurrent(): Promise<void> } | undefined> => {
  const store = options.outputs;
  if (!store) return undefined;
  const required = [
    ...(plan.media ?? []).flatMap((media) => [media.source, media.target]),
    ...plan.artifacts.map((artifact) => artifact.target),
    ...plan.assets.flatMap((asset) => (asset.type === "local" ? [asset.file] : [])),
    ...(plan.sidecars ?? []).flatMap((move) => [move.source, move.target]),
    ...plan.obsolete,
  ];
  const roots = new Map(
    await Promise.all(
      [...new Set(required.map((ref) => ref.rootId))].map(async (id) => [id, await options.resolveRoot(id)] as const),
    ),
  );
  const absolute = (ref: RootFileRef) => {
    const root = roots.get(ref.rootId);
    if (!root) throw new Error(`Publication root not found: ${ref.rootId}`);
    return resolveRootRelativePath(root, ref.relativePath);
  };
  const query = { paths: required.map(absolute), includeOwners: true };
  const snapshot = store.publicationSnapshot(query);
  const refs = [...snapshot.files, ...snapshot.assets, ...required];
  for (const id of new Set(refs.map((ref) => ref.rootId)))
    if (!roots.has(id)) roots.set(id, await options.resolveRoot(id));
  const physical = await resolvePublicationReferenceKeys(refs, required, async (id) => {
    const root = roots.get(id);
    if (!root) throw new Error(`Publication root not found: ${id}`);
    return root;
  });
  const key = (ref: RootFileRef, keys = physical) => {
    const path = keys.get(refKey(ref));
    if (path === undefined) throw new Error(`Publication path was not resolved: ${refKey(ref)}`);
    return path;
  };
  for (const media of plan.media ?? []) {
    const references = snapshot.files.filter((file) => key(file) === key(media.source));
    if (new Set(references.map((file) => file.itemId)).size > 1)
      throw new PublicationConflictError(absolute(media.source), absolute(media.target), "同一实际媒体被多个条目引用");
  }
  const owners = new Set([
    ...(options.ownerId ? [options.ownerId] : []),
    ...(plan.media ?? []).flatMap((media) =>
      snapshot.files.filter((file) => key(file) === key(media.source)).map((file) => file.itemId),
    ),
  ]);
  if (options.ownerId && [...owners].some((owner) => owner !== options.ownerId)) {
    throw new PublicationConflictError(
      plan.media?.[0] ? absolute(plan.media[0].source) : plan.operationId,
      plan.media?.[0] ? absolute(plan.media[0].target) : plan.operationId,
      "发布声明的影片归属与已登记媒体不一致",
    );
  }
  if (!plan.media?.length) {
    const referenced = snapshot.assets.filter(
      (asset) =>
        asset.published &&
        [...plan.artifacts.map((artifact) => artifact.target), ...plan.obsolete].some((ref) => key(ref) === key(asset)),
    );
    const ids = new Set(referenced.map((asset) => asset.itemId));
    if (ids.size === 1) for (const id of ids) owners.add(id);
  }
  const removable = (ref: RootFileRef) => {
    if (
      plan.boundary &&
      plan.obsolete.includes(ref) &&
      !plan.boundary.writablePaths.some(
        (location) => publicationPathKey(location.path) === publicationPathKey(absolute(ref)),
      )
    )
      throw new Error(`Publication mutation was not declared: ${absolute(ref)}`);
    const references = snapshot.assets.filter((asset) => key(asset) === key(ref));
    return (
      references.length > 0 &&
      references.every((asset) => asset.published && !asset.historical && owners.has(asset.itemId)) &&
      !snapshot.files.some((file) => key(file) === key(ref) && !owners.has(file.itemId))
    );
  };
  const targets = [
    ...plan.artifacts.map((artifact) => artifact.target),
    ...(plan.sidecars ?? []).map((move) => move.target),
  ];
  const missing: RootFileRef[] = [];
  for (const target of targets) {
    const exists = await fileSystem
      .stat(absolute(target))
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
    if (!exists) {
      missing.push(...snapshot.assets.filter((asset) => key(asset) === key(target)));
      continue;
    }
    if (
      !removable(target) &&
      !(
        plan.editFiles?.some((ref) => refKey(ref) === refKey(target)) &&
        !snapshot.assets.some((asset) => key(asset) === key(target)) &&
        !snapshot.files.some((file) => key(file) === key(target))
      )
    )
      throw new PublicationConflictError(
        plan.media?.[0] ? absolute(plan.media[0].source) : absolute(target),
        absolute(target),
        "输出未登记为当前媒体所有，或仍被其他媒体引用",
      );
  }
  plan.replaceExistingTargets = targets;
  plan.obsolete = plan.obsolete.filter(removable);
  for (const move of plan.sidecars ?? []) {
    if (snapshot.assets.some((asset) => key(asset) === key(move.source) && !owners.has(asset.itemId)))
      move.preserveSource = true;
  }
  const retainedOutputs = plan.assets.flatMap((asset) =>
    asset.type === "local" &&
    !targets.some((target) => key(target) === key(asset.file)) &&
    snapshot.assets.some((reference) => reference.published && key(reference) === key(asset.file))
      ? [asset.file]
      : [],
  );
  for (const ref of retainedOutputs)
    if (snapshot.assets.some((asset) => key(asset) === key(ref) && !owners.has(asset.itemId)))
      throw new PublicationConflictError(
        plan.media?.[0] ? absolute(plan.media[0].source) : absolute(ref),
        absolute(ref),
        "共享资源的其他媒体未参与本次发布",
      );
  const registrations = [...targets, ...retainedOutputs].map((target) => ({
    target,
    media: (plan.media ?? []).filter((media) =>
      (media.assets ?? plan.assets).some((asset) => asset.type === "local" && refKey(asset.file) === refKey(target)),
    ),
    kinds: plan.assets
      .filter((asset) => asset.type === "local" && refKey(asset.file) === refKey(target))
      .map((asset) => asset.kind),
    existingOwners: snapshot.assets
      .filter((asset) => asset.published && key(asset) === key(target) && owners.has(asset.itemId))
      .map((asset) => ({ itemId: asset.itemId, fileId: asset.fileId })),
  }));
  const sourceKeys = new Set((plan.media ?? []).map((media) => key(media.source)));
  const targetPaths = new Set([...targets, ...retainedOutputs].map((ref) => key(ref)));
  const relevant = (value: typeof snapshot, keys: Map<string, string>) =>
    JSON.stringify({
      files: value.files
        .filter((file) => owners.has(file.itemId) || sourceKeys.has(key(file, keys)))
        .sort((a, b) => refKey(a).localeCompare(refKey(b))),
      assets: value.assets
        .filter((asset) => owners.has(asset.itemId) || targetPaths.has(key(asset, keys)))
        .sort((a, b) => `${a.itemId}:${refKey(a)}:${a.kind}`.localeCompare(`${b.itemId}:${refKey(b)}:${b.kind}`)),
    });
  const expected = relevant(snapshot, physical);
  return {
    async assertCurrent() {
      const current = store.publicationSnapshot(query);
      const keys = await resolvePublicationReferenceKeys(
        [...current.files, ...current.assets, ...required],
        required,
        options.resolveRoot,
      );
      if (relevant(current, keys) !== expected)
        throw new PublicationConflictError(
          plan.media?.[0] ? absolute(plan.media[0].source) : plan.operationId,
          targets[0] ? absolute(targets[0]) : plan.operationId,
          "输出归属或媒体引用在发布期间发生变化",
        );
    },
    register() {
      const released = [
        ...plan.obsolete,
        ...(plan.sidecars ?? [])
          .filter((move) => !move.preserveSource && key(move.source) !== key(move.target))
          .map((move) => move.source),
      ];
      store.releaseOutputReferences([
        ...missing,
        ...snapshot.assets.filter((asset) => released.some((ref) => key(ref) === key(asset))),
      ]);
      const current = store.publicationSnapshot({ paths: (plan.media ?? []).map((media) => absolute(media.target)) });
      const outputs: Parameters<PublicationOutputPort["registerPublishedOutputs"]>[0] = [];
      for (const registration of registrations) {
        const media = registration.media.length ? registration.media : (plan.media ?? []);
        const outputOwners = media.length
          ? media.flatMap((participant) =>
              current.files
                .filter(
                  (file) =>
                    refKey(file) === refKey(participant.target) ||
                    physical.get(refKey(file)) === key(participant.target),
                )
                .map((file) => ({ itemId: file.itemId, fileId: file.fileId ?? null })),
            )
          : registration.existingOwners;
        if (!outputOwners.length && options.ownerId) {
          outputOwners.push({ itemId: options.ownerId, fileId: null });
        }
        if (!outputOwners.length) {
          if (plan.editFiles?.some((ref) => refKey(ref) === refKey(registration.target))) continue;
          throw new Error(`发布输出缺少媒体归属：${absolute(registration.target)}`);
        }
        const kinds = registration.kinds.length
          ? registration.kinds
          : [extname(registration.target.relativePath).toLowerCase() === ".nfo" ? "nfo" : "sidecar"];
        for (const kind of new Set(kinds)) {
          const fileScoped = kind === "strm" || kind === "subtitle";
          for (const owner of new Map(
            outputOwners.map((value) => [fileScoped ? `${value.itemId}:${value.fileId ?? ""}` : value.itemId, value]),
          ).values()) {
            if (fileScoped && !owner.fileId) {
              throw new Error(`发布文件资源缺少文件归属：${absolute(registration.target)}`);
            }
            outputs.push({
              ...registration.target,
              itemId: owner.itemId,
              fileId: fileScoped ? owner.fileId : null,
              kind,
            });
          }
        }
      }
      store.registerPublishedOutputs(outputs);
    },
  };
};
