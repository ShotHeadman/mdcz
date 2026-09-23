import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { filesystemPathKey, type MediaRoot, resolveRootRelativePath, toRootRelativePath } from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { FileInfo, UncensoredChoice } from "@mdcz/shared/types";
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
  uncensoredChoice?: UncensoredChoice;
  error?: string;
}
export interface MovieGroup<TMember = MovieMember> {
  movieId: string;
  members: TMember[];
  assets: Array<RootFileRef & { fileId: string | null; kind: string; published: boolean }>;
  error?: string;
}

type ResolveRoot = (id: string) => Promise<MediaRoot>;
type MovieMemberInput = RootFileRef & {
  fileId?: string;
  manualScrape?: ManualScrapeOptions;
  uncensoredChoice?: UncensoredChoice;
};

const cacheResolveRoot = (resolveRoot: ResolveRoot): ResolveRoot => {
  const roots = new Map<string, Promise<MediaRoot>>();
  return (id) => {
    const pending = roots.get(id) ?? resolveRoot(id);
    roots.set(id, pending);
    return pending;
  };
};

export const groupMovieMembers = (members: readonly MovieMember[]): MovieGroup[] => {
  const groups = new Map<string, MovieGroup>();
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

const inspectMember = async (
  ref: MovieMemberInput,
  inventory: DirectoryInventory,
  resolveRoot: ResolveRoot,
  configuration: Configuration,
): Promise<MovieMember> => {
  const root = await resolveRoot(ref.rootId);
  const filePath = resolveRootRelativePath(root, ref.relativePath);
  const entryPath = await inventory.entryPath(filePath);
  const entryIdentity = filesystemPathKey(entryPath);
  const fileInfo = parseFileInfo(filePath, configuration.scrape.filenameIgnoreTokens);
  const member: MovieMember = {
    source: { rootId: ref.rootId, relativePath: ref.relativePath },
    fileId: ref.fileId ?? randomUUID(),
    fileInfo,
    entryIdentity,
    canonicalDirectory: filesystemPathKey(dirname(entryPath)),
    manualScrape: ref.manualScrape,
    uncensoredChoice: ref.uncensoredChoice,
  };
  try {
    await inventory.admitRefs([ref], resolveRoot);
  } catch (error) {
    member.error = error instanceof Error ? error.message : String(error);
  }
  const primary = await inventory.mediaEntries(dirname(filePath));
  if (
    fileInfo.extension.toLowerCase() === ".strm" &&
    !primary.some((entry) => entry.name === `${fileInfo.fileName}${fileInfo.extension}`)
  ) {
    member.error = `不能单独处理生成的视频附属文件：${filePath}`;
  }
  return member;
};

const expandLocalParts = async (
  member: MovieMember,
  inventory: DirectoryInventory,
  resolveRoot: ResolveRoot,
  configuration: Configuration,
  owned: ReadonlySet<string>,
  pending: MovieMemberInput[],
): Promise<void> => {
  if (member.ownerId || !member.fileInfo.part || !member.fileInfo.number.trim()) return;
  const root = await resolveRoot(member.source.rootId);
  const filePath = resolveRootRelativePath(root, member.source.relativePath);
  const manualScrape = JSON.stringify(member.manualScrape ?? null);
  for (const sibling of await inventory.mediaEntries(dirname(filePath))) {
    const siblingPath = join(dirname(filePath), sibling.name);
    const parsed = parseFileInfo(siblingPath, configuration.scrape.filenameIgnoreTokens);
    if (parsed.number.trim().toUpperCase() !== member.fileInfo.number.trim().toUpperCase()) continue;
    const relativePath = toRootRelativePath(root, siblingPath);
    const queued = pending.some(
      (item) =>
        `${item.rootId}\0${item.relativePath}\0${JSON.stringify(item.manualScrape ?? null)}` ===
        `${root.id}\0${relativePath}\0${manualScrape}`,
    );
    if (queued || owned.has(filesystemPathKey(await inventory.entryPath(siblingPath)))) continue;
    pending.push({
      rootId: root.id,
      relativePath,
      manualScrape: member.manualScrape,
      uncensoredChoice: member.uncensoredChoice,
    });
  }
};

const collectMembers = async (input: {
  refs: readonly MovieMemberInput[];
  inventory: DirectoryInventory;
  resolveRoot: ResolveRoot;
  configuration: Configuration;
  owned?: ReadonlySet<string>;
  attach?: (member: MovieMember) => Promise<void>;
  expandParts?: boolean;
}): Promise<MovieMember[]> => {
  const members: MovieMember[] = [];
  const seen = new Set<string>();
  const pending = [...input.refs];
  const owned = input.owned ?? new Set<string>();
  for (let index = 0; index < pending.length; index++) {
    const ref = pending[index];
    const root = await input.resolveRoot(ref.rootId);
    const filePath = resolveRootRelativePath(root, ref.relativePath);
    const key = `${filesystemPathKey(await input.inventory.entryPath(filePath))}\0${JSON.stringify(ref.manualScrape ?? null)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const member = await inspectMember(ref, input.inventory, input.resolveRoot, input.configuration);
    await input.attach?.(member);
    members.push(member);
    if (input.expandParts ?? true) {
      await expandLocalParts(member, input.inventory, input.resolveRoot, input.configuration, owned, pending);
    }
  }
  return members;
};

export const admitScrapeGroups = async (input: {
  refs: readonly MovieMemberInput[];
  resolveRoot: ResolveRoot;
  inventory: DirectoryInventory;
  configuration: Configuration;
  expandParts?: boolean;
}): Promise<MovieGroup[]> =>
  groupMovieMembers(
    await collectMembers({
      refs: input.refs,
      inventory: input.inventory,
      resolveRoot: cacheResolveRoot(input.resolveRoot),
      configuration: input.configuration,
      expandParts: input.expandParts ?? true,
    }),
  );

export const admitMaintenanceGroups = async (input: {
  refs: readonly MovieMemberInput[];
  ownership: readonly MovieOwnership[];
  resolveRoot: ResolveRoot;
  inventory: DirectoryInventory;
  configuration: Configuration;
}): Promise<MovieGroup[]> => {
  const { inventory, configuration } = input;
  const resolveRoot = cacheResolveRoot(input.resolveRoot);
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
    if (entry.kind !== "video") continue;
    const previous = owners.get(entry.identity);
    if (previous && previous.movieId !== entry.movieId)
      throw new Error(`Media entry belongs to multiple movies: ${entry.identity}`);
    owners.set(entry.identity, entry);
  }
  const members = await collectMembers({
    refs: input.refs,
    inventory,
    resolveRoot,
    configuration,
    owned: new Set(owners.keys()),
    attach: async (member) => {
      const owner = owners.get(member.entryIdentity);
      if (!owner) return;
      member.ownerId = owner.movieId;
      member.fileId = owner.fileId ?? member.fileId;
      const nfos = locations.filter(
        (entry) =>
          entry.movieId === owner.movieId &&
          entry.kind === "nfo" &&
          (entry.fileId === null || entry.fileId === owner.fileId),
      );
      inventory.registeredNfos.set(
        member.entryIdentity,
        await Promise.all(
          nfos.map(async (entry) => resolveRootRelativePath(await resolveRoot(entry.rootId), entry.relativePath)),
        ),
      );
    },
  });
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
