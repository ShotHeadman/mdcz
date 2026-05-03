import { toErrorMessage } from "@mdcz/shared/error";
import {
  type FileCleanerCandidateView,
  type FileCleanerScanInput,
  FileCleanerWorkspaceDetail,
} from "@mdcz/views/tools";
import { useState } from "react";
import { deleteFile } from "@/api/manual";
import { listEntries } from "@/client/api";
import type { FileItem } from "@/client/types";
import { useToast } from "@/contexts/ToastProvider";
import { formatBytes } from "@/utils/format";
import { browseDirectoryPath } from "./toolUtils";

const CLEANUP_MAX_SCANNED_DIRECTORIES = 50000;

function toVisitedDirectoryKey(dirPath: string) {
  const trimmed = dirPath.trim();
  if (!trimmed) return "";
  const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/u, "");
  return (withoutTrailingSeparators || trimmed).toLowerCase();
}

function normalizeExtension(ext: string) {
  const value = ext.trim().toLowerCase();
  if (!value) return "";
  return value.startsWith(".") ? value : `.${value}`;
}

function extensionFromName(fileName: string) {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "";
  return normalizeExtension(fileName.slice(dot));
}

function shouldKeepForCleanup(item: FileItem, extensionSet: Set<string>) {
  if (item.type !== "file") return false;
  const ext = extensionFromName(item.name);
  return ext.length > 0 && extensionSet.has(ext);
}

export function FileCleaner() {
  const { showError, showInfo, showSuccess } = useToast();
  const [cleanupScanning, setCleanupScanning] = useState(false);
  const [cleanupDeleting, setCleanupDeleting] = useState(false);
  const [cleanupProgress, setCleanupProgress] = useState(0);
  const [cleanupCandidates, setCleanupCandidates] = useState<FileCleanerCandidateView[]>([]);
  const scanCleanupCandidates = async ({ targetPath, extensions, includeSubdirs }: FileCleanerScanInput) => {
    const cleanPath = targetPath.trim();
    if (!cleanPath) {
      showError("请输入需要扫描的目录");
      return;
    }
    if (extensions.length === 0) {
      showError("请至少选择一种文件类型");
      return;
    }

    setCleanupScanning(true);
    setCleanupCandidates([]);
    setCleanupProgress(0);

    const extensionSet = new Set(extensions.map(normalizeExtension).filter(Boolean));
    const found: FileCleanerCandidateView[] = [];
    const queue: string[] = [cleanPath];
    const visited = new Set<string>();

    try {
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) continue;

        const currentKey = toVisitedDirectoryKey(current);
        if (!currentKey || visited.has(currentKey)) continue;
        visited.add(currentKey);
        if (visited.size > CLEANUP_MAX_SCANNED_DIRECTORIES) {
          throw new Error(`扫描目录数量超过 ${CLEANUP_MAX_SCANNED_DIRECTORIES}，请缩小路径范围后重试`);
        }

        const response = await listEntries({ query: { path: current }, throwOnError: true });
        const items = response.data?.items ?? [];
        for (const item of items) {
          if (item.type === "directory") {
            if (includeSubdirs) queue.push(item.path);
            continue;
          }
          if (!shouldKeepForCleanup(item, extensionSet)) continue;
          found.push({
            path: item.path,
            ext: extensionFromName(item.name),
            size: item.size ?? 0,
            lastModified: item.last_modified ?? null,
          });
        }
      }

      found.sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));
      setCleanupCandidates(found);
      if (found.length === 0) {
        showInfo("未找到匹配文件。");
      } else {
        showSuccess(`扫描完成，共找到 ${found.length} 个匹配文件。`);
      }
    } catch (error) {
      showError(`扫描失败: ${toErrorMessage(error)}`);
    } finally {
      setCleanupScanning(false);
    }
  };

  const handleDeleteCleanupCandidates = async () => {
    if (cleanupCandidates.length === 0) {
      showInfo("当前没有可清理文件。");
      return;
    }

    setCleanupDeleting(true);
    setCleanupProgress(0);

    const failedPaths = new Set<string>();
    let successCount = 0;

    try {
      for (const [index, candidate] of cleanupCandidates.entries()) {
        try {
          await deleteFile(candidate.path);
          successCount += 1;
        } catch {
          failedPaths.add(candidate.path);
        }

        setCleanupProgress(Math.round(((index + 1) / cleanupCandidates.length) * 100));
      }

      setCleanupCandidates((prev) => prev.filter((item) => failedPaths.has(item.path)));
      if (failedPaths.size === 0) {
        showSuccess(`文件清理完成，成功删除 ${successCount} 个文件。`);
      } else {
        showError(`删除完成：成功 ${successCount}，失败 ${failedPaths.size}。`);
      }
    } finally {
      setCleanupDeleting(false);
      window.setTimeout(() => setCleanupProgress(0), 1200);
    }
  };

  return (
    <FileCleanerWorkspaceDetail
      candidates={cleanupCandidates}
      deleting={cleanupDeleting}
      formatBytes={formatBytes}
      progress={cleanupProgress}
      scanning={cleanupScanning}
      onBrowseDirectory={browseDirectoryPath}
      onDelete={handleDeleteCleanupCandidates}
      onScan={scanCleanupCandidates}
    />
  );
}
