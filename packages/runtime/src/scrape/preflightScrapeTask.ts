import { dirname, join, parse } from "node:path";
import { filesystemPathKey } from "@mdcz/media-store";
import type { DirectoryInventory } from "./DirectoryInventory";

export interface ScrapeTargetMember {
  itemId: string;
  sourcePath: string;
  targetVideoPath: string;
  artifactPaths?: readonly string[];
}

export interface ScrapeTargetGroup {
  members: readonly ScrapeTargetMember[];
}

export interface ScrapeTargetConflict {
  itemId: string;
  sourcePath: string;
  targetPath: string;
  message: string;
}

export class ScrapeTargetConflictError extends Error {
  constructor(readonly conflicts: readonly ScrapeTargetConflict[]) {
    super(
      conflicts
        .map((conflict) => `${conflict.message}\n待处理：${conflict.sourcePath}\n目标路径：${conflict.targetPath}`)
        .join("\n\n"),
    );
    this.name = "ScrapeTargetConflictError";
  }
}

const addConflict = (
  conflicts: Map<string, ScrapeTargetConflict>,
  member: ScrapeTargetMember,
  targetPath: string,
  message: string,
): void => {
  if (conflicts.has(member.itemId)) return;
  conflicts.set(member.itemId, {
    itemId: member.itemId,
    sourcePath: member.sourcePath,
    targetPath,
    message,
  });
};

const markGroup = (
  conflicts: Map<string, ScrapeTargetConflict>,
  group: ScrapeTargetGroup,
  targetPath: string,
  message: string,
): void => {
  for (const member of group.members) addConflict(conflicts, member, targetPath, message);
};

export async function checkScrapeTargets(
  groups: readonly ScrapeTargetGroup[],
  inventory: DirectoryInventory,
): Promise<void> {
  const conflicts = new Map<string, ScrapeTargetConflict>();
  const sources = new Map<string, string>();
  const planned = new Map<string, Array<{ group: ScrapeTargetGroup; member: ScrapeTargetMember }>>();
  const directories = new Set<string>();
  const videos = new Map<string, { group: ScrapeTargetGroup; member: ScrapeTargetMember; kind: "source" | "target" }>();
  const artifacts = new Map<string, { group: ScrapeTargetGroup; path: string }[]>();

  for (const group of groups) {
    const groupArtifacts = new Set<string>();
    for (const member of group.members) {
      const source = filesystemPathKey(await inventory.entryPath(member.sourcePath));
      sources.set(member.itemId, source);
      videos.set(source, { group, member, kind: "source" });
      const target = await inventory.entryPath(member.targetVideoPath);
      const targetKey = filesystemPathKey(target);
      videos.set(targetKey, { group, member, kind: "target" });
      const key = filesystemPathKey(join(dirname(target), parse(target).name));
      const siblings = planned.get(key) ?? [];
      siblings.push({ group, member });
      planned.set(key, siblings);
      directories.add(dirname(target));
      for (const artifact of member.artifactPaths ?? []) {
        groupArtifacts.add(filesystemPathKey(await inventory.entryPath(artifact)));
      }
    }
    for (const path of groupArtifacts) {
      const owners = artifacts.get(path) ?? [];
      owners.push({ group, path });
      artifacts.set(path, owners);
    }
  }

  for (const siblings of planned.values()) {
    const distinctSources = new Set(siblings.map(({ member }) => sources.get(member.itemId)));
    if (distinctSources.size < 2) continue;
    const message =
      new Set(siblings.map(({ group }) => group)).size === 1
        ? "同一影片的多个视频目标文件名重复，请调整命名规则以区分这些视频"
        : "多部影片目标文件名重复";
    for (const { member } of siblings) addConflict(conflicts, member, member.targetVideoPath, message);
  }

  for (const directory of directories) {
    for (const entry of await inventory.mediaEntries(directory)) {
      const targetPath = join(directory, entry.name);
      const matches = planned.get(filesystemPathKey(join(directory, parse(entry.name).name)));
      if (!matches) continue;
      if (entry.isSymbolicLink()) {
        try {
          if (!(await inventory.stats(targetPath)).isFile()) continue;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
      }
      for (const { member } of matches) {
        if (sources.get(member.itemId) === filesystemPathKey(targetPath)) continue;
        addConflict(conflicts, member, targetPath, "目标目录已存在同名影片");
      }
    }
  }

  for (const [path, owners] of artifacts) {
    const distinctGroups = [...new Map(owners.map((owner) => [owner.group, owner])).values()];
    if (distinctGroups.length > 1) {
      for (const owner of distinctGroups) markGroup(conflicts, owner.group, owner.path, "多部影片生成文件路径冲突");
    }
    const video = videos.get(path);
    if (video && distinctGroups.some((owner) => owner.group !== video.group)) {
      markGroup(conflicts, video.group, video.member.targetVideoPath, "生成文件与视频文件名冲突");
      for (const owner of distinctGroups) {
        if (owner.group !== video.group) markGroup(conflicts, owner.group, owner.path, "生成文件与视频文件名冲突");
      }
    }
  }

  if (conflicts.size) throw new ScrapeTargetConflictError([...conflicts.values()]);
}
