import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { filesystemPathKey, type MediaRoot, resolveRootRelativePath, toRootRelativePath } from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { FileInfo } from "@mdcz/shared/types";
import type { ManualScrapeOptions } from "./aggregation";
import type { DirectoryInventory } from "./DirectoryInventory";
import { parseFileInfo } from "./utils/number";

export type MovieOwnership = RootFileRef & { movieId: string; fileId: string | null; kind: string; published: number };
export interface MovieMember {
  source: RootFileRef;
  fileId: string;
  fileInfo: FileInfo;
  entryIdentity: string;
  canonicalDirectory: string;
  ownerId?: string;
  manualScrape?: ManualScrapeOptions;
  error?: string;
}
export interface AdmittedMovieGroup {
  movieId: string;
  members: MovieMember[];
  assets: Array<RootFileRef & { fileId: string | null; kind: string; published: boolean }>;
  error?: string;
}

export const groupMovieMembers = (members: readonly MovieMember[]): AdmittedMovieGroup[] => {
  const groups = new Map<string, AdmittedMovieGroup>();
  for (const member of members) {
    const key =
      member.ownerId ??
      JSON.stringify([
        member.canonicalDirectory,
        member.fileInfo.number.trim().toUpperCase() || member.entryIdentity,
        member.manualScrape?.site,
        member.manualScrape?.detailUrl,
      ]);
    const group = groups.get(key) ?? { movieId: member.ownerId ?? randomUUID(), members: [], assets: [] };
    if (!group.members.some((candidate) => candidate.entryIdentity === member.entryIdentity))
      group.members.push(member);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const parts = group.members.flatMap((member) => (member.fileInfo.part ? [member.fileInfo.part.number] : []));
    const memberError = group.members.find((member) => member.error)?.error;
    if (memberError) {
      group.error = memberError;
    } else if (!group.members[0]?.ownerId && parts.length && parts.length !== group.members.length) {
      group.error = "同一影片同时包含分盘文件和独立文件，需要手动核对";
    } else if (new Set(parts).size !== parts.length) {
      group.error = "同一影片存在重复分盘号，需要手动核对";
    } else if (new Set(group.members.map((member) => JSON.stringify(member.manualScrape ?? null))).size > 1) {
      group.error = "同一影片包含冲突的手动刮削指令";
    }
  }
  return [...groups.values()];
};

export const admitMovieGroups = async (input: {
  refs: readonly (RootFileRef & { manualScrape?: ManualScrapeOptions })[];
  ownership: readonly MovieOwnership[];
  resolveRoot(id: string): Promise<MediaRoot>;
  inventory: DirectoryInventory;
  configuration: Configuration;
}): Promise<AdmittedMovieGroup[]> => {
  const { inventory, resolveRoot, configuration } = input;
  const locations = await Promise.all(
    input.ownership.map(async (entry) => ({
      ...entry,
      identity: filesystemPathKey(
        await inventory.entryPath(resolveRootRelativePath(await resolveRoot(entry.rootId), entry.relativePath)),
      ),
    })),
  );
  const owners = new Map<string, (typeof locations)[number]>();
  for (const entry of locations) {
    if (entry.kind === "strm" && entry.published) inventory.generatedStrms.add(entry.identity);
    if (entry.kind !== "video") continue;
    const previous = owners.get(entry.identity);
    if (previous && previous.movieId !== entry.movieId)
      throw new Error(`Media entry belongs to multiple movies: ${entry.identity}`);
    owners.set(entry.identity, entry);
  }
  const members: MovieMember[] = [];
  const seen = new Set<string>();
  const pending = [...input.refs];
  for (let index = 0; index < pending.length; index++) {
    const ref = pending[index];
    const root = await resolveRoot(ref.rootId);
    const filePath = resolveRootRelativePath(root, ref.relativePath);
    const entryPath = await inventory.entryPath(filePath);
    const entryIdentity = filesystemPathKey(entryPath);
    const directive = JSON.stringify(ref.manualScrape ?? null);
    const key = `${entryIdentity}\0${directive}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const owner = owners.get(entryIdentity);
    const fileInfo = parseFileInfo(filePath, configuration.scrape.filenameIgnoreTokens);
    const member: MovieMember = {
      source: { rootId: ref.rootId, relativePath: ref.relativePath },
      fileId: owner?.fileId ?? `${ref.rootId}:${ref.relativePath}`,
      fileInfo,
      entryIdentity,
      canonicalDirectory: filesystemPathKey(dirname(entryPath)),
      ownerId: owner?.movieId,
      manualScrape: ref.manualScrape,
    };
    try {
      await inventory.admitRefs([ref], resolveRoot);
    } catch (error) {
      member.error = error instanceof Error ? error.message : String(error);
    }
    const primary = await inventory.mediaEntries(dirname(filePath));
    if (
      inventory.generatedStrms.has(entryIdentity) ||
      (fileInfo.extension.toLowerCase() === ".strm" &&
        !primary.some((entry) => entry.name === `${fileInfo.fileName}${fileInfo.extension}`))
    )
      member.error = `不能单独处理生成的视频附属文件：${filePath}`;
    members.push(member);
    if (owner) {
      const nfos = locations.filter(
        (entry) =>
          entry.movieId === owner.movieId &&
          entry.kind === "nfo" &&
          (entry.fileId === null || entry.fileId === owner.fileId),
      );
      inventory.registeredNfos.set(
        entryIdentity,
        await Promise.all(
          nfos.map(async (entry) => resolveRootRelativePath(await resolveRoot(entry.rootId), entry.relativePath)),
        ),
      );
      for (const sibling of locations.filter((entry) => entry.kind === "video" && entry.movieId === owner.movieId)) {
        if (
          input.refs.some(
            (selected) => selected.rootId === sibling.rootId && selected.relativePath === sibling.relativePath,
          )
        )
          continue;
        pending.push({ rootId: sibling.rootId, relativePath: sibling.relativePath, manualScrape: ref.manualScrape });
      }
    } else if (fileInfo.part) {
      for (const sibling of primary) {
        const siblingPath = join(dirname(filePath), sibling.name);
        const parsed = parseFileInfo(siblingPath, configuration.scrape.filenameIgnoreTokens);
        if (parsed.number.trim().toUpperCase() !== fileInfo.number.trim().toUpperCase()) continue;
        if (owners.has(filesystemPathKey(await inventory.entryPath(siblingPath)))) continue;
        pending.push({
          rootId: root.id,
          relativePath: toRootRelativePath(root, siblingPath),
          manualScrape: ref.manualScrape,
        });
      }
    }
  }
  const groups = groupMovieMembers(members);
  for (const group of groups)
    group.assets = locations
      .filter((entry) => entry.movieId === group.movieId && entry.kind !== "video")
      .map((entry) => ({
        rootId: entry.rootId,
        relativePath: entry.relativePath,
        fileId: entry.fileId,
        kind: entry.kind,
        published: Boolean(entry.published),
      }));
  return groups;
};
