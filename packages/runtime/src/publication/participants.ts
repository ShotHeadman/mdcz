import { randomUUID } from "node:crypto";
import type { MediaRoot } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { PublicationConflictError } from "./conflicts";
import { publicationRefKey, resolvePublicationReferenceKeys } from "./paths";
import type { PublicationOutputPort, PublicationParticipants } from "./types";

export const resolvePublicationSourceOwners = async (input: {
  sources: readonly RootFileRef[];
  snapshot: ReturnType<PublicationOutputPort["publicationSnapshot"]>;
  resolveRoot(rootId: string): Promise<Pick<MediaRoot, "id" | "hostPath">>;
}): Promise<ReadonlyMap<string, string | null>> => {
  const keys = await resolvePublicationReferenceKeys(
    [...input.snapshot.files, ...input.sources],
    input.sources,
    input.resolveRoot,
  );
  const physicalKey = (ref: RootFileRef) => {
    const value = keys.get(publicationRefKey(ref));
    if (!value) throw new Error(`Publication path was not resolved: ${publicationRefKey(ref)}`);
    return value;
  };
  return new Map(
    input.sources.map((source) => {
      const owners = new Set(
        input.snapshot.files.filter((file) => physicalKey(file) === physicalKey(source)).map((file) => file.itemId),
      );
      if (owners.size > 1)
        throw new PublicationConflictError(
          source.relativePath,
          source.relativePath,
          "同一视频文件已被媒体库中的多个影片重复引用",
        );
      return [publicationRefKey(source), [...owners][0] ?? null];
    }),
  );
};

export const resolvePublicationParticipants = async <TMember extends { source: RootFileRef; fileId?: string }>(input: {
  members: readonly TMember[];
  outputs?: readonly RootFileRef[];
  identity?: string;
  movieId?: string;
  snapshot: ReturnType<PublicationOutputPort["publicationSnapshot"]>;
  resolveRoot(rootId: string): Promise<Pick<MediaRoot, "id" | "hostPath">>;
}): Promise<PublicationParticipants<TMember>> => {
  const sources = input.members.map((member) => member.source);
  const requested = [...sources, ...(input.outputs ?? [])];
  const keys = await resolvePublicationReferenceKeys(
    [...input.snapshot.files, ...input.snapshot.assets, ...requested],
    requested,
    input.resolveRoot,
  );
  const key = (ref: RootFileRef) => {
    const value = keys.get(publicationRefKey(ref));
    if (!value) throw new Error(`Publication path was not resolved: ${publicationRefKey(ref)}`);
    return value;
  };
  const selected = input.members.map((member) => {
    const matches = input.snapshot.files.filter((file) => key(file) === key(member.source));
    if (new Set(matches.map((file) => file.itemId)).size > 1)
      throw new PublicationConflictError(
        member.source.relativePath,
        member.source.relativePath,
        "同一视频文件已被媒体库中的多个影片重复引用",
      );
    return { member, match: matches[0] };
  });
  const identity = input.identity?.trim().toUpperCase();
  const outputKeys = new Set((input.outputs ?? []).map(key));
  const owners = new Set([
    ...(input.movieId ? [input.movieId] : []),
    ...selected.flatMap(({ match }) => (match ? [match.itemId] : [])),
  ]);
  const sourcePath = sources[0]?.relativePath ?? "publication";
  for (const asset of input.snapshot.assets) {
    if (!asset.published || asset.historical || !outputKeys.has(key(asset))) continue;
    const identityMatches =
      !identity ||
      input.snapshot.files.some(
        (file) => file.itemId === asset.itemId && file.mediaIdentity?.trim().toUpperCase() === identity,
      );
    if (!owners.has(asset.itemId) && !identityMatches)
      throw new PublicationConflictError(sourcePath, asset.relativePath, "生成输出已属于媒体标识不同的影片");
    owners.add(asset.itemId);
  }
  for (const file of input.snapshot.files) {
    if (!outputKeys.has(key(file))) continue;
    if (!owners.has(file.itemId) && identity && file.mediaIdentity?.trim().toUpperCase() !== identity)
      throw new PublicationConflictError(sourcePath, file.relativePath, "生成输出已属于媒体标识不同的影片");
    owners.add(file.itemId);
  }
  if (owners.size > 1)
    throw new PublicationConflictError(
      sourcePath,
      input.outputs?.[0]?.relativePath ?? "publication",
      "所选视频文件或关联资源已属于不同的媒体库影片",
    );
  const movieId = [...owners][0] ?? randomUUID();
  return {
    movieId,
    members: selected.map(({ member, match }) => {
      if (match && !match.fileId)
        throw new Error(`Registered publication source has no file ID: ${publicationRefKey(member.source)}`);
      return { ...member, fileId: match?.fileId ?? member.fileId ?? randomUUID() };
    }),
    expected: {
      files: input.snapshot.files.filter((file) => file.itemId === movieId),
      assets: input.snapshot.assets.filter((asset) => asset.itemId === movieId && !asset.historical),
    },
  };
};
