import { toErrorMessage } from "@mdcz/shared/error";
import { FolderOpen, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { deleteFile } from "@/api/manual";
import { listEntries } from "@/client/api";
import type { FileItem } from "@/client/types";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Progress } from "@/components/ui/Progress";
import { useToast } from "@/contexts/ToastProvider";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/utils/format";
import { ToolPanel } from "./ToolPanel";
import {
  TOOL_ICON_BUTTON_CLASS,
  TOOL_INPUT_CLASS,
  TOOL_SECONDARY_BUTTON_CLASS,
  TOOL_SUBSECTION_CLASS,
  TOOL_TABLE_SHELL_CLASS,
} from "./toolStyles";
import { browseDirectoryPath } from "./toolUtils";

interface CleanupCandidate {
  path: string;
  ext: string;
  size: number;
  lastModified: string | null;
}

const CLEANUP_PRESET_EXTENSIONS = [".html", ".url", ".txt", ".nfo", ".jpg", ".png", ".torrent", ".ass", ".srt"];
const CLEANUP_MAX_SCANNED_DIRECTORIES = 50000;

function toVisitedDirectoryKey(dirPath: string) {
  const trimmed = dirPath.trim();
  if (!trimmed) {
    return "";
  }

  const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/u, "");
  return (withoutTrailingSeparators || trimmed).toLowerCase();
}

function normalizeExtension(ext: string) {
  const value = ext.trim().toLowerCase();
  if (!value) {
    return "";
  }
  return value.startsWith(".") ? value : `.${value}`;
}

function extensionFromName(fileName: string) {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) {
    return "";
  }
  return normalizeExtension(fileName.slice(dot));
}

function shouldKeepForCleanup(item: FileItem, extensionSet: Set<string>) {
  if (item.type !== "file") {
    return false;
  }
  const ext = extensionFromName(item.name);
  return ext.length > 0 && extensionSet.has(ext);
}

export function FileCleaner() {
  const { showError, showInfo, showSuccess } = useToast();
  const [cleanPath, setCleanPath] = useState("");
  const [cleanExtensions, setCleanExtensions] = useState<string[]>([".html", ".url"]);
  const [cleanCustomExt, setCleanCustomExt] = useState("");
  const [includeSubdirs, setIncludeSubdirs] = useState(true);
  const [cleanupScanning, setCleanupScanning] = useState(false);
  const [cleanupDeleting, setCleanupDeleting] = useState(false);
  const [cleanupProgress, setCleanupProgress] = useState(0);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);
  const [cleanupCandidates, setCleanupCandidates] = useState<CleanupCandidate[]>([]);
  const cleanupPreviewRows = cleanupCandidates.slice(0, 400);
  const cleanupTotalSize = useMemo(
    () => cleanupCandidates.reduce((sum, item) => sum + (Number.isFinite(item.size) ? item.size : 0), 0),
    [cleanupCandidates],
  );

  const handleChooseDirectory = async () => {
    try {
      const selectedPath = await browseDirectoryPath();
      if (selectedPath) {
        setCleanPath(selectedPath);
      }
    } catch (error) {
      showError(`目录选择失败: ${toErrorMessage(error)}`);
    }
  };

  const toggleCleanExtension = (extension: string) => {
    const normalized = normalizeExtension(extension);
    if (!normalized) {
      return;
    }
    setCleanExtensions((prev) =>
      prev.includes(normalized) ? prev.filter((ext) => ext !== normalized) : [...prev, normalized],
    );
  };

  const handleAddCustomExtension = () => {
    const normalized = normalizeExtension(cleanCustomExt);
    if (!normalized) {
      showError("请输入有效的扩展名");
      return;
    }
    if (cleanExtensions.includes(normalized)) {
      setCleanCustomExt("");
      showInfo(`文件类型 ${normalized} 已存在`);
      return;
    }
    setCleanExtensions((prev) => [...prev, normalized]);
    setCleanCustomExt("");
  };

  const scanCleanupCandidates = async () => {
    const targetPath = cleanPath.trim();
    if (!targetPath) {
      showError("请输入需要扫描的目录");
      return;
    }
    if (cleanExtensions.length === 0) {
      showError("请至少选择一种文件类型");
      return;
    }

    setCleanupScanning(true);
    setCleanupCandidates([]);
    setCleanupProgress(0);

    const extensionSet = new Set(cleanExtensions.map(normalizeExtension).filter(Boolean));
    const found: CleanupCandidate[] = [];
    const queue: string[] = [targetPath];
    const visited = new Set<string>();

    try {
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
          continue;
        }

        const currentKey = toVisitedDirectoryKey(current);
        if (!currentKey || visited.has(currentKey)) {
          continue;
        }
        visited.add(currentKey);
        if (visited.size > CLEANUP_MAX_SCANNED_DIRECTORIES) {
          throw new Error(`扫描目录数量超过 ${CLEANUP_MAX_SCANNED_DIRECTORIES}，请缩小路径范围后重试`);
        }

        const response = await listEntries({ query: { path: current }, throwOnError: true });
        const items = response.data?.items ?? [];
        for (const item of items) {
          if (item.type === "directory") {
            if (includeSubdirs) {
              queue.push(item.path);
            }
            continue;
          }
          if (!shouldKeepForCleanup(item, extensionSet)) {
            continue;
          }
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
      setCleanupConfirmOpen(false);
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
    <>
      <ToolPanel toolId="file-cleaner" icon={<Trash2 className="h-5 w-5" />}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
          <div className={cn(TOOL_SUBSECTION_CLASS, "flex-1")}>
            <Label
              htmlFor="clean-path"
              className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
            >
              扫描目录
            </Label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                id="clean-path"
                value={cleanPath}
                onChange={(event) => setCleanPath(event.target.value)}
                placeholder="/path/to/library"
                className={cn(TOOL_INPUT_CLASS, "flex-1")}
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className={TOOL_ICON_BUTTON_CLASS}
                onClick={handleChooseDirectory}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <Button
            variant="secondary"
            onClick={scanCleanupCandidates}
            disabled={cleanupScanning}
            className={cn(TOOL_SECONDARY_BUTTON_CLASS, "w-full xl:w-auto")}
          >
            {cleanupScanning ? "正在扫描..." : "开始扫描"}
          </Button>
        </div>

        <div className={TOOL_SUBSECTION_CLASS}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              文件类型过滤
            </Label>
            <div className="flex items-center gap-2">
              <Checkbox
                id="include-subdirs"
                checked={includeSubdirs}
                onCheckedChange={(checked) => setIncludeSubdirs(Boolean(checked))}
              />
              <Label htmlFor="include-subdirs" className="cursor-pointer text-sm text-foreground">
                包含子目录
              </Label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {CLEANUP_PRESET_EXTENSIONS.map((ext) => (
              <button
                key={ext}
                type="button"
                onClick={() => toggleCleanExtension(ext)}
                className={cn(
                  "rounded-quiet-capsule px-3.5 py-2 text-xs font-mono transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                  cleanExtensions.includes(ext)
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-floating text-muted-foreground hover:bg-surface-raised/70",
                )}
              >
                {ext}
              </button>
            ))}
          </div>

          <div className="flex max-w-md gap-2">
            <Input
              value={cleanCustomExt}
              onChange={(event) => setCleanCustomExt(event.target.value)}
              placeholder="自定义扩展名, 如 .bak"
              className="h-10 rounded-quiet-sm border-none bg-surface-floating px-4 text-sm shadow-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={handleAddCustomExtension}
              className="rounded-quiet-capsule px-4"
            >
              添加
            </Button>
          </div>
        </div>

        {cleanupDeleting ? (
          <div className={TOOL_SUBSECTION_CLASS}>
            <div className="flex justify-between text-xs font-semibold text-muted-foreground">
              <span>正在删除文件...</span>
              <span>{cleanupProgress}%</span>
            </div>
            <Progress value={cleanupProgress} className="h-2 bg-surface-floating" />
          </div>
        ) : null}

        <div className={TOOL_TABLE_SHELL_CLASS}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface-low/90 text-muted-foreground">
                  <th className="w-20 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">类型</th>
                  <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">文件路径</th>
                  <th className="w-24 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">大小</th>
                  <th className="w-40 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">最后修改</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/5">
                {cleanupPreviewRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground italic">
                      暂无待清理文件
                    </td>
                  </tr>
                ) : (
                  cleanupPreviewRows.map((item) => (
                    <tr key={item.path} className="transition-colors hover:bg-surface-low/45">
                      <td className="px-4 py-3 font-mono text-foreground/70">{item.ext || "-"}</td>
                      <td className="max-w-md truncate px-4 py-3 font-mono" title={item.path}>
                        {item.path}
                      </td>
                      <td className="px-4 py-3 font-numeric text-muted-foreground">
                        {formatBytes(item.size, { fractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 font-numeric text-[11px] text-muted-foreground">
                        {item.lastModified ?? "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-quiet-lg bg-surface-low/90 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">匹配文件</span>
            <span className="font-numeric font-semibold text-foreground">{cleanupCandidates.length}</span>
            <span className="text-muted-foreground">总大小</span>
            <span className="font-numeric font-semibold text-destructive">
              {formatBytes(cleanupTotalSize, { fractionDigits: 2 })}
            </span>
          </div>

          <Button
            variant="destructive"
            onClick={() => setCleanupConfirmOpen(true)}
            disabled={cleanupCandidates.length === 0 || cleanupDeleting}
            className="h-11 rounded-quiet-capsule px-6 text-sm font-semibold"
          >
            <Trash2 className="h-4 w-4" />
            确认清理
          </Button>
        </div>
      </ToolPanel>

      <Dialog open={cleanupConfirmOpen} onOpenChange={setCleanupConfirmOpen}>
        <DialogContent className="rounded-quiet-lg border-none bg-surface-floating shadow-[0_24px_60px_rgba(15,23,42,0.12)]">
          <DialogHeader>
            <DialogTitle>确认清理文件</DialogTitle>
            <DialogDescription>
              将永久删除 <span className="font-bold text-foreground">{cleanupCandidates.length}</span> 个文件 (约{" "}
              <span className="font-bold text-destructive">{formatBytes(cleanupTotalSize, { fractionDigits: 2 })}</span>
              )。此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setCleanupConfirmOpen(false)}
              disabled={cleanupDeleting}
              className="rounded-quiet-capsule"
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteCleanupCandidates}
              disabled={cleanupDeleting}
              className="rounded-quiet-capsule px-8"
            >
              {cleanupDeleting ? "正在清理..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
