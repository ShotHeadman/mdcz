import type { Website } from "@shared/enums";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Eraser,
  FileCheck,
  FileSearch,
  FolderOpen,
  Link2,
  Search,
  Settings2,
  Trash2,
  UserCheck,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteFile } from "@/api/manual";
import { createSymlink, listEntries, scrapeSingleFile } from "@/client/api";
import { ipc } from "@/client/ipc";
import type { CreateSoftlinksBody, FileItem, ScrapeFileBody } from "@/client/types";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { TabButton } from "@/components/ui/TabButton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/contexts/ToastProvider";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tool")({
  component: ToolComponent,
});

interface MissingResultRow {
  index: number;
  number: string;
}

interface CleanupCandidate {
  path: string;
  name: string;
  ext: string;
  size: number;
  lastModified: string | null;
}

const CLEANUP_PRESET_EXTENSIONS = [".html", ".url", ".txt", ".nfo", ".jpg", ".png", ".torrent", ".ass", ".srt"];
const CLEANUP_MAX_SCANNED_DIRECTORIES = 50000;

const TOOLS_TABS = [
  { id: "scraping", label: "数据刮削", icon: FileCheck },
  { id: "maintenance", label: "维护管理", icon: Settings2 },
  { id: "cleanup", label: "垃圾清理", icon: Eraser },
  { id: "utility", label: "实用工具", icon: ClipboardList },
] as const;

function toVisitedDirectoryKey(dirPath: string) {
  const trimmed = dirPath.trim();
  if (!trimmed) return "";

  const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/u, "");
  return (withoutTrailingSeparators || trimmed).toLowerCase();
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseRangeInput(text: string): { start: number; end: number; width: number } | null {
  const match = text.trim().match(/^(\d+)\s*[-~—到]+\s*(\d+)$/u);
  if (!match) return null;
  const startRaw = match[1];
  const endRaw = match[2];
  const start = Number(startRaw);
  const end = Number(endRaw);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0 || start > end) {
    return null;
  }
  return { start, end, width: Math.max(startRaw.length, endRaw.length, 3) };
}

function normalizeExtension(ext: string) {
  const val = ext.trim().toLowerCase();
  if (!val) return "";
  return val.startsWith(".") ? val : `.${val}`;
}

function extensionFromName(fileName: string) {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "";
  return normalizeExtension(fileName.slice(dot));
}

function formatError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function ToolComponent() {
  const navigate = useNavigate();
  const { showSuccess, showError, showInfo } = useToast();
  const [activeTab, setActiveTab] = useState<(typeof TOOLS_TABS)[number]["id"]>("scraping");

  // 单文件刮削
  const [singleFilePath, setSingleFilePath] = useState("");
  const scrapeSingleFileMut = useMutation({
    mutationFn: async (body: ScrapeFileBody) => scrapeSingleFile({ body, throwOnError: true }),
  });

  const [sourceDir, setSourceDir] = useState("");
  const [destDir, setDestDir] = useState("");
  const [copyFiles, setCopyFiles] = useState(false);
  const createSymlinkMut = useMutation({
    mutationFn: async (body: CreateSoftlinksBody) => createSymlink({ body, throwOnError: true }),
  });

  // 演员相关
  const checkServerConnectionMut = useMutation({
    mutationFn: async () => ipc.tool.checkServerConnection(),
  });
  const [actorInfoMode, setActorInfoMode] = useState<"all" | "missing">("missing");
  const [actorPhotoMode, setActorPhotoMode] = useState<"all" | "missing">("missing");
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);

  // 缺番查找
  const [missingPrefix, setMissingPrefix] = useState("");
  const [missingRange, setMissingRange] = useState("");
  const [existingNumbers, setExistingNumbers] = useState("");
  const [missingRows, setMissingRows] = useState<MissingResultRow[]>([]);
  const [missingSummary, setMissingSummary] = useState("");

  // 文件清理
  const [cleanPath, setCleanPath] = useState("");
  const [cleanExtensions, setCleanExtensions] = useState<string[]>([".html", ".url"]);
  const [cleanCustomExt, setCleanCustomExt] = useState("");
  const [includeSubdirs, setIncludeSubdirs] = useState(true);
  const [cleanupScanning, setCleanupScanning] = useState(false);
  const [cleanupDeleting, setCleanupDeleting] = useState(false);
  const [cleanupProgress, setCleanupProgress] = useState(0);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);
  const [cleanupCandidates, setCleanupCandidates] = useState<CleanupCandidate[]>([]);

  // 爬虫测试
  const sitesQ = useQuery({
    queryKey: ["crawler", "sites"],
    queryFn: async () => {
      const result = (await ipc.crawler.listSites()) as {
        sites: Array<{ site: string; name: string; enabled: boolean; native: boolean }>;
      };
      return result.sites;
    },
  });
  const [crawlerTestSite, setCrawlerTestSite] = useState("");
  const [crawlerTestNumber, setCrawlerTestNumber] = useState("");
  const [crawlerTestResult, setCrawlerTestResult] = useState<{
    data: {
      title?: string;
      actors?: string[];
      genres?: string[];
      release_date?: string;
      studio?: string;
    } | null;
    error?: string;
    elapsed: number;
  } | null>(null);
  const [crawlerTesting, setCrawlerTesting] = useState(false);

  // Navigation arrows logic
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setCanScrollLeft(scrollLeft > 2);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 2);
    }
  }, []);

  useEffect(() => {
    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
  }, [checkScroll]);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const { clientWidth } = scrollRef.current;
      const scrollAmount = clientWidth * 0.75;
      scrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheelNative = (e: WheelEvent) => {
      if (el.scrollWidth > el.clientWidth) {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          e.stopPropagation();
          el.scrollLeft += e.deltaY;
        } else if (Math.abs(e.deltaX) > 0) {
          e.stopPropagation();
        }
      }
    };

    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, []);

  const handleScrapeSingleFile = async () => {
    if (!singleFilePath) {
      showError("请输入文件路径");
      return;
    }
    showInfo("正在启动单文件刮削任务...");
    try {
      await scrapeSingleFileMut.mutateAsync({
        path: singleFilePath,
      });
      showSuccess("单文件刮削任务已成功启动，正在跳转到日志页面...");
      setTimeout(() => navigate({ to: "/logs" }), 1000);
    } catch (error) {
      showError(`单文件刮削任务启动失败: ${error}`);
    }
  };

  const handleCreateSymlink = async () => {
    if (!sourceDir || !destDir) {
      showError("请输入源目录和目标目录");
      return;
    }

    showInfo("正在启动软链接创建任务...");
    try {
      await createSymlinkMut.mutateAsync({
        source_dir: sourceDir,
        dest_dir: destDir,
        copy_files: copyFiles,
      });
      showSuccess("软链接创建任务已成功启动，正在跳转到日志页面...");
      setTimeout(() => navigate({ to: "/logs" }), 1000);
    } catch (error) {
      showError(`软链接创建任务启动失败: ${formatError(error)}`);
    }
  };

  const runServerConnectionCheck = async (silentSuccess = false): Promise<boolean> => {
    try {
      await checkServerConnectionMut.mutateAsync();
      if (!silentSuccess) {
        showSuccess("服务器连通性测试通过");
      }
      return true;
    } catch (error) {
      showError(`服务器连通性测试失败: ${formatError(error)}`);
      return false;
    }
  };

  const handleCheckServerConnection = async () => {
    showInfo("正在测试 Emby/Jellyfin 连通性...");
    await runServerConnectionCheck();
  };

  const handleSyncActorInfo = async () => {
    showInfo("正在测试服务器连接...");
    const connected = await runServerConnectionCheck(true);
    if (!connected) {
      return;
    }

    setSyncRunning(true);
    setSyncProgress(5);
    showInfo("正在同步演员信息...");
    try {
      const result = await ipc.tool.syncActorInfo(actorInfoMode);
      setSyncProgress(100);
      showSuccess(`演员信息同步完成: 成功 ${result.processedCount}，失败 ${result.failedCount}`);
    } catch (error) {
      showError(`演员信息同步失败: ${formatError(error)}`);
    } finally {
      setSyncRunning(false);
      window.setTimeout(() => setSyncProgress(0), 1200);
    }
  };

  const handleSyncPhotos = async () => {
    showInfo("正在测试服务器连接...");
    const connected = await runServerConnectionCheck(true);
    if (!connected) {
      return;
    }

    setSyncRunning(true);
    setSyncProgress(5);
    showInfo("正在同步演员头像...");
    try {
      const result = await ipc.tool.syncActorPhoto(actorPhotoMode);
      setSyncProgress(100);
      showSuccess(`头像同步完成: 成功 ${result.processedCount}，失败 ${result.failedCount}`);
    } catch (error) {
      showError(`头像同步失败: ${formatError(error)}`);
    } finally {
      setSyncRunning(false);
      window.setTimeout(() => setSyncProgress(0), 1200);
    }
  };

  const toggleCleanExtension = (extension: string) => {
    const normalized = normalizeExtension(extension);
    if (!normalized) return;
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

  const handleBrowseCleanPath = async () => {
    const result = await ipc.file.browse("directory");
    if (result.paths && result.paths.length > 0) {
      setCleanPath(result.paths[0]);
    }
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
            name: item.name,
            ext: extensionFromName(item.name),
            size: item.size ?? 0,
            lastModified: item.last_modified ?? null,
          });
        }
      }

      found.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));
      setCleanupCandidates(found);
      if (found.length === 0) {
        showInfo("未找到匹配文件。");
      } else {
        showSuccess(`扫描完成，共找到 ${found.length} 个匹配文件。`);
      }
    } catch (error) {
      showError(`扫描失败: ${formatError(error)}`);
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

  const handleFindMissing = () => {
    const prefix = missingPrefix.trim().toUpperCase();
    if (!prefix) {
      showError("请输入番号前缀");
      return;
    }

    const range = parseRangeInput(missingRange);
    if (!range) {
      showError("请输入有效范围，例如 1-200 或 001-120");
      return;
    }
    if (range.end - range.start > 20000) {
      showError("范围过大，请缩小后再查询");
      return;
    }

    const matchedNumbers = new Set<number>();
    const re = new RegExp(`${escapeRegExp(prefix)}[-_\\s]?(\\d+)`, "giu");
    for (const match of existingNumbers.toUpperCase().matchAll(re)) {
      const num = Number(match[1]);
      if (Number.isInteger(num)) matchedNumbers.add(num);
    }
    if (matchedNumbers.size === 0) {
      for (const raw of existingNumbers.match(/\d+/g) ?? []) {
        const num = Number(raw);
        if (Number.isInteger(num)) matchedNumbers.add(num);
      }
    }

    const rows: MissingResultRow[] = [];
    for (let i = range.start; i <= range.end; i += 1) {
      if (!matchedNumbers.has(i)) {
        rows.push({
          index: rows.length + 1,
          number: `${prefix}-${String(i).padStart(range.width, "0")}`,
        });
      }
    }

    const expectedTotal = range.end - range.start + 1;
    setMissingRows(rows);
    setMissingSummary(
      `范围 ${range.start}-${range.end}，期望 ${expectedTotal}，已识别 ${matchedNumbers.size}，缺失 ${rows.length}`,
    );
    if (rows.length === 0) {
      showSuccess("未发现缺失番号");
    } else {
      showInfo(`查找完成，缺失 ${rows.length} 条`);
    }
  };

  const handleCrawlerTest = async () => {
    if (!crawlerTestSite) {
      showError("请选择站点");
      return;
    }
    if (!crawlerTestNumber.trim()) {
      showError("请输入番号");
      return;
    }
    setCrawlerTesting(true);
    setCrawlerTestResult(null);
    try {
      const result = await ipc.crawler.test(crawlerTestSite as Website, crawlerTestNumber.trim());
      setCrawlerTestResult(result);
      if (result.data) {
        showSuccess(`测试成功，耗时 ${(result.elapsed / 1000).toFixed(1)}s`);
      } else {
        showError(result.error ?? "未获取到数据");
      }
    } catch (error) {
      showError(`爬虫测试失败: ${formatError(error)}`);
    } finally {
      setCrawlerTesting(false);
    }
  };

  const cleanupTotalSize = useMemo(
    () => cleanupCandidates.reduce((sum, item) => sum + (Number.isFinite(item.size) ? item.size : 0), 0),
    [cleanupCandidates],
  );
  const cleanupPreviewRows = cleanupCandidates.slice(0, 400);
  const missingPreviewRows = missingRows.slice(0, 300);

  return (
    <div className="h-full w-full overflow-y-auto relative scroll-smooth">
      <div className="sticky top-0 z-10 bg-background/60 backdrop-blur-xl border-b">
        <PageHeader title="工具" subtitle="常用批量任务与维护工具" icon={Wrench} />

        <div className="px-8 pb-2 h-11 flex items-center">
          <div className="relative flex items-center flex-1 min-w-0 group/tabs">
            {canScrollLeft && (
              <div className="absolute left-0 inset-y-0 z-10 flex items-center pr-10 bg-gradient-to-r from-background via-background/80 to-transparent pointer-events-none rounded-l-lg">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 ml-0.5 rounded-full bg-background shadow-md border pointer-events-auto hover:bg-accent hover:text-accent-foreground transition-all duration-200"
                  onClick={() => scroll("left")}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </div>
            )}

            <div
              ref={scrollRef}
              onScroll={checkScroll}
              className="flex-1 flex gap-1 p-1 bg-muted/40 rounded-lg overflow-x-auto no-scrollbar scroll-smooth"
            >
              {TOOLS_TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <TabButton key={tab.id} isActive={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
                    <Icon className="h-3.5 w-3.5 mr-1.5" />
                    {tab.label}
                  </TabButton>
                );
              })}
            </div>

            {canScrollRight && (
              <div className="absolute right-0 inset-y-0 z-10 flex items-center pl-10 bg-gradient-to-l from-background via-background/80 to-transparent pointer-events-none rounded-r-lg">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 mr-0.5 rounded-full bg-background shadow-md border pointer-events-auto hover:bg-accent hover:text-accent-foreground transition-all duration-200"
                  onClick={() => scroll("right")}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 space-y-8">
        {/* ── 数据刮削 ─────────────────────────── */}
        {activeTab === "scraping" && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="px-1">
              <h2 className="text-base font-semibold mb-1">数据刮削</h2>
              <p className="text-muted-foreground text-xs">按需处理单个文件，并测试爬虫抓取能力</p>
            </div>

            <div className="grid gap-6 md:grid-cols-1">
              <Card className="rounded-xl border shadow-sm flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-primary/8 rounded-lg">
                      <FileSearch className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-medium">单文件刮削</CardTitle>
                      <CardDescription className="text-xs">输入文件路径，快速处理指定视频</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="filePath" className="text-xs font-medium text-muted-foreground">
                      文件路径
                    </Label>
                    <Input
                      id="filePath"
                      value={singleFilePath}
                      onChange={(e) => setSingleFilePath(e.target.value)}
                      placeholder="/path/to/video.mp4"
                      className="h-9 bg-muted/30 rounded-lg border-none focus:ring-2"
                    />
                  </div>
                  <Button
                    variant="secondary"
                    onClick={handleScrapeSingleFile}
                    disabled={scrapeSingleFileMut.isPending}
                    className="w-full rounded-lg h-9 text-sm font-medium"
                  >
                    {scrapeSingleFileMut.isPending ? "正在刮削..." : "开始单文件刮削"}
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* 爬虫测试 */}
            <Card className="rounded-xl border shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-primary/8 rounded-lg">
                    <Search className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-medium">爬虫测试</CardTitle>
                    <CardDescription className="text-xs">选择站点和番号，测试爬虫是否能正确抓取数据</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label className="text-xs font-medium text-muted-foreground">站点</Label>
                    <Select value={crawlerTestSite} onValueChange={setCrawlerTestSite}>
                      <SelectTrigger className="h-9 bg-muted/30 rounded-lg border-none focus:ring-2">
                        <SelectValue placeholder="选择站点" />
                      </SelectTrigger>
                      <SelectContent>
                        {(sitesQ.data ?? []).map((s) => (
                          <SelectItem key={s.site} value={s.site}>
                            <span className="flex items-center gap-2">
                              {s.name}
                              {s.enabled && (
                                <Badge variant="secondary" className="h-4 text-[9px] px-1">
                                  已启用
                                </Badge>
                              )}
                              {!s.native && (
                                <Badge variant="outline" className="h-4 text-[9px] px-1">
                                  浏览器
                                </Badge>
                              )}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="crawlerTestNumber" className="text-xs font-medium text-muted-foreground">
                      番号
                    </Label>
                    <Input
                      id="crawlerTestNumber"
                      value={crawlerTestNumber}
                      onChange={(e) => setCrawlerTestNumber(e.target.value)}
                      placeholder="例如: ABP-001"
                      className="h-9 bg-muted/30 rounded-lg border-none focus:ring-2"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCrawlerTest();
                      }}
                    />
                  </div>
                </div>
                <Button
                  variant="secondary"
                  onClick={handleCrawlerTest}
                  disabled={crawlerTesting}
                  className="w-full rounded-lg h-9 text-sm font-medium"
                >
                  {crawlerTesting ? "测试中..." : "开始测试"}
                </Button>

                {crawlerTestResult && (
                  <div className="rounded-xl border bg-muted/10 p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">
                        {crawlerTestResult.data ? (
                          <span className="text-green-600">测试成功</span>
                        ) : (
                          <span className="text-destructive">测试失败</span>
                        )}
                      </span>
                      <span className="text-muted-foreground">
                        耗时 {(crawlerTestResult.elapsed / 1000).toFixed(1)}s
                      </span>
                    </div>
                    {crawlerTestResult.error && <p className="text-xs text-destructive">{crawlerTestResult.error}</p>}
                    {crawlerTestResult.data && (
                      <div className="space-y-1 text-xs">
                        {crawlerTestResult.data.title && (
                          <div>
                            <span className="text-muted-foreground">标题: </span>
                            <span className="font-medium">{crawlerTestResult.data.title}</span>
                          </div>
                        )}
                        {crawlerTestResult.data.actors && crawlerTestResult.data.actors.length > 0 && (
                          <div>
                            <span className="text-muted-foreground">演员: </span>
                            <span>{crawlerTestResult.data.actors.join(", ")}</span>
                          </div>
                        )}
                        {crawlerTestResult.data.genres && crawlerTestResult.data.genres.length > 0 && (
                          <div>
                            <span className="text-muted-foreground">标签: </span>
                            <span>{crawlerTestResult.data.genres.join(", ")}</span>
                          </div>
                        )}
                        {crawlerTestResult.data.release_date && (
                          <div>
                            <span className="text-muted-foreground">发行日期: </span>
                            <span>{crawlerTestResult.data.release_date}</span>
                          </div>
                        )}
                        {crawlerTestResult.data.studio && (
                          <div>
                            <span className="text-muted-foreground">片商: </span>
                            <span>{crawlerTestResult.data.studio}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── 维护管理 ─────────────────────────── */}
        {activeTab === "maintenance" && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="px-1">
              <h2 className="text-base font-semibold mb-1">维护与管理</h2>
              <p className="text-muted-foreground text-xs">补全演员资料，保持资料库更完整</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {/* 演员工具 */}
              <Card className="rounded-xl border shadow-sm md:col-span-2">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-primary/8 rounded-lg">
                        <UserCheck className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-sm font-medium">演员工具</CardTitle>
                        <CardDescription className="text-xs">同步演员头像与元数据</CardDescription>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleCheckServerConnection}
                      disabled={checkServerConnectionMut.isPending || syncRunning}
                      className="rounded-lg shrink-0 h-9 text-sm"
                    >
                      {checkServerConnectionMut.isPending ? "测试中..." : "测试连通"}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div className="grid gap-2">
                      <Label className="text-xs font-medium text-muted-foreground">信息同步</Label>
                      <div className="flex gap-2">
                        <Select value={actorInfoMode} onValueChange={(v) => setActorInfoMode(v as "all" | "missing")}>
                          <SelectTrigger className="h-9 bg-muted/30 rounded-lg border-none focus:ring-2 flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="missing">仅缺失</SelectItem>
                            <SelectItem value="all">全部</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="secondary"
                          onClick={handleSyncActorInfo}
                          disabled={syncRunning || checkServerConnectionMut.isPending}
                          className="flex-1 rounded-lg h-9 text-sm"
                        >
                          {syncRunning ? "同步中..." : "同步信息"}
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <div className="flex justify-between text-xs text-muted-foreground font-medium">
                        <span>任务进度</span>
                        <span>{Math.round(syncProgress)}%</span>
                      </div>
                      <Progress value={syncProgress} className="h-2 bg-muted/30" />
                    </div>

                    <div className="grid gap-2">
                      <Label className="text-xs font-medium text-muted-foreground">头像同步</Label>
                      <div className="flex gap-2">
                        <Select value={actorPhotoMode} onValueChange={(v) => setActorPhotoMode(v as "all" | "missing")}>
                          <SelectTrigger className="h-9 bg-muted/30 rounded-lg border-none focus:ring-2 flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="missing">仅缺失</SelectItem>
                            <SelectItem value="all">全部</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="secondary"
                          onClick={handleSyncPhotos}
                          disabled={syncRunning || checkServerConnectionMut.isPending}
                          className="flex-1 rounded-lg h-9 text-sm"
                        >
                          {syncRunning ? "同步中..." : "同步头像"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-xl border shadow-sm md:col-span-2">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-primary/8 rounded-lg">
                      <Link2 className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-medium">软链接管理</CardTitle>
                      <CardDescription className="text-xs">在不同目录间建立文件组织结构映射</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="sourceDir" className="text-xs font-medium text-muted-foreground">
                        源目录
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="sourceDir"
                          value={sourceDir}
                          onChange={(e) => setSourceDir(e.target.value)}
                          className="h-9 bg-muted/30 rounded-lg border-none focus:ring-2 flex-1"
                          placeholder="原始视频存放目录"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          onClick={async () => {
                            const result = await ipc.file.browse("directory");
                            if (result.paths && result.paths.length > 0) {
                              setSourceDir(result.paths[0]);
                            }
                          }}
                        >
                          <FolderOpen className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="destDir" className="text-xs font-medium text-muted-foreground">
                        目标目录
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="destDir"
                          value={destDir}
                          onChange={(e) => setDestDir(e.target.value)}
                          className="h-9 bg-muted/30 rounded-lg border-none focus:ring-2 flex-1"
                          placeholder="软链接存放目录"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          onClick={async () => {
                            const result = await ipc.file.browse("directory");
                            if (result.paths && result.paths.length > 0) {
                              setDestDir(result.paths[0]);
                            }
                          }}
                        >
                          <FolderOpen className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 p-3 bg-muted/20 rounded-xl">
                    <Checkbox
                      id="copyFiles"
                      checked={copyFiles}
                      onCheckedChange={(checked) => setCopyFiles(!!checked)}
                    />
                    <Label htmlFor="copyFiles" className="text-xs leading-tight cursor-pointer font-medium">
                      同时同步 NFO, 图片及字幕等附属文件
                    </Label>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={handleCreateSymlink}
                    disabled={createSymlinkMut.isPending}
                    className="w-full rounded-lg h-9 text-sm font-medium"
                  >
                    {createSymlinkMut.isPending ? "正在处理..." : "立即建立映射"}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* ── 垃圾清理 ─────────────────────────── */}
        {activeTab === "cleanup" && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="px-1">
              <h2 className="text-base font-semibold mb-1">垃圾清理</h2>
              <p className="text-muted-foreground text-xs">快速找出并清理无用的附带文件</p>
            </div>

            <Card className="rounded-xl border shadow-sm overflow-hidden">
              <CardHeader>
                <CardTitle className="text-sm font-medium">文件清理工具</CardTitle>
                <CardDescription className="text-xs">选择目录和文件类型，先预览再删除</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex flex-col lg:flex-row gap-4 items-end">
                  <div className="grid gap-2 flex-1 w-full">
                    <Label htmlFor="clean-path" className="text-xs font-medium text-muted-foreground">
                      扫描目录
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="clean-path"
                        value={cleanPath}
                        onChange={(e) => setCleanPath(e.target.value)}
                        placeholder="/path/to/library"
                        className="h-9 bg-muted/30 rounded-lg border-none focus:ring-2 flex-1"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        onClick={handleBrowseCleanPath}
                      >
                        <FolderOpen className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={scanCleanupCandidates}
                    disabled={cleanupScanning}
                    className="h-9 px-8 rounded-lg shrink-0 text-sm font-medium"
                  >
                    {cleanupScanning ? "正在扫描..." : "开始扫描"}
                  </Button>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-muted-foreground">文件类型过滤</Label>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="include-subdirs"
                        checked={includeSubdirs}
                        onCheckedChange={(checked) => setIncludeSubdirs(!!checked)}
                      />
                      <Label htmlFor="include-subdirs" className="text-xs font-medium cursor-pointer">
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
                          "px-3 py-1.5 rounded-lg text-xs font-mono transition-all border",
                          cleanExtensions.includes(ext)
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "bg-muted/20 border-transparent text-muted-foreground hover:bg-muted/40",
                        )}
                      >
                        {ext}
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-2 max-w-sm">
                    <Input
                      value={cleanCustomExt}
                      onChange={(e) => setCleanCustomExt(e.target.value)}
                      placeholder="自定义扩展名, 如 .bak"
                      className="h-8 text-xs bg-muted/20 rounded-lg border-none"
                    />
                    <Button variant="ghost" size="sm" onClick={handleAddCustomExtension} className="h-8">
                      添加
                    </Button>
                  </div>
                </div>

                {cleanupDeleting && (
                  <div className="grid gap-2">
                    <div className="flex justify-between text-xs text-muted-foreground font-medium">
                      <span>正在删除文件...</span>
                      <span>{cleanupProgress}%</span>
                    </div>
                    <Progress value={cleanupProgress} className="h-2 bg-muted/30" />
                  </div>
                )}

                <div className="rounded-xl border bg-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/30 text-muted-foreground">
                          <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider w-20">类型</th>
                          <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider">文件路径</th>
                          <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider w-24">大小</th>
                          <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider w-40">最后修改</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-muted/20">
                        {cleanupPreviewRows.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground italic">
                              暂无待清理文件
                            </td>
                          </tr>
                        ) : (
                          cleanupPreviewRows.map((item) => (
                            <tr key={item.path} className="hover:bg-muted/5 transition-colors">
                              <td className="px-4 py-3 font-mono text-primary/70">{item.ext || "-"}</td>
                              <td className="px-4 py-3 font-mono truncate max-w-md" title={item.path}>
                                {item.path}
                              </td>
                              <td className="px-4 py-3 text-muted-foreground">{formatBytes(item.size)}</td>
                              <td className="px-4 py-3 text-muted-foreground text-[10px]">
                                {item.lastModified ?? "-"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-muted/20 rounded-xl">
                  <div className="text-sm">
                    <span className="text-muted-foreground">匹配文件: </span>
                    <span className="font-bold">{cleanupCandidates.length}</span>
                    <span className="mx-2 opacity-30">|</span>
                    <span className="text-muted-foreground">总大小: </span>
                    <span className="font-bold text-destructive">{formatBytes(cleanupTotalSize)}</span>
                  </div>
                  <Button
                    variant="destructive"
                    onClick={() => setCleanupConfirmOpen(true)}
                    disabled={cleanupCandidates.length === 0 || cleanupDeleting}
                    className="rounded-lg px-6 h-9 text-sm font-medium"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    确认清理
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── 实用工具 ─────────────────────────── */}
        {activeTab === "utility" && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="px-1">
              <h2 className="text-base font-semibold mb-1">实用工具</h2>
              <p className="text-muted-foreground text-xs">提供缺番查找等轻量辅助功能</p>
            </div>

            <div className="grid gap-8 md:grid-cols-1 items-start">
              {/* 缺番查找工具 */}
              <Card className="rounded-xl border shadow-sm">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-primary/8 rounded-lg">
                      <Link2 className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-medium">缺番查找</CardTitle>
                      <CardDescription className="text-xs">根据编号范围和现有列表快速识别缺失的番号</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="missing-prefix" className="text-xs font-medium text-muted-foreground">
                        番号前缀
                      </Label>
                      <Input
                        id="missing-prefix"
                        placeholder="例如: ABC"
                        value={missingPrefix}
                        onChange={(e) => setMissingPrefix(e.target.value)}
                        className="h-9 bg-muted/30 rounded-lg border-none focus:ring-2"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="missing-range" className="text-xs font-medium text-muted-foreground">
                        数字范围
                      </Label>
                      <Input
                        id="missing-range"
                        placeholder="例如: 1-120"
                        value={missingRange}
                        onChange={(e) => setMissingRange(e.target.value)}
                        className="h-9 bg-muted/30 rounded-lg border-none focus:ring-2"
                      />
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="existing-numbers" className="text-xs font-medium text-muted-foreground">
                      已存在番号列表
                    </Label>
                    <Textarea
                      id="existing-numbers"
                      value={existingNumbers}
                      onChange={(e) => setExistingNumbers(e.target.value)}
                      placeholder="ABC-001, ABC-002, ABC-004..."
                      className="min-h-[120px] bg-muted/30 rounded-lg border-none focus:ring-2 p-4 text-sm"
                    />
                  </div>

                  <Button
                    variant="secondary"
                    onClick={handleFindMissing}
                    className="w-full rounded-lg h-9 text-sm font-medium"
                  >
                    开始查找缺失番号
                  </Button>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between px-1">
                      <Label className="text-xs font-medium text-muted-foreground">查找结果</Label>
                      {missingSummary && <span className="text-[10px] font-medium text-primary">{missingSummary}</span>}
                    </div>
                    <div className="rounded-xl border bg-muted/10 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/30 text-muted-foreground">
                            <th className="px-4 py-2 text-left w-16">序号</th>
                            <th className="px-4 py-2 text-left">建议番号</th>
                          </tr>
                        </thead>
                        <tbody>
                          {missingPreviewRows.length === 0 ? (
                            <tr>
                              <td colSpan={2} className="px-4 py-8 text-center text-muted-foreground italic">
                                无查找结果
                              </td>
                            </tr>
                          ) : (
                            missingPreviewRows.map((row) => (
                              <tr
                                key={row.number}
                                className="border-t border-muted/10 hover:bg-muted/5 transition-colors"
                              >
                                <td className="px-4 py-2 text-muted-foreground">{row.index}</td>
                                <td className="px-4 py-2 font-mono font-medium">{row.number}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Bottom spacing */}
        <div className="h-10" />
      </div>

      <Dialog open={cleanupConfirmOpen} onOpenChange={setCleanupConfirmOpen}>
        <DialogContent className="rounded-xl">
          <DialogHeader>
            <DialogTitle>确认清理文件</DialogTitle>
            <DialogDescription>
              将永久删除 <span className="font-bold text-foreground">{cleanupCandidates.length}</span> 个文件 (约{" "}
              <span className="font-bold text-destructive">{formatBytes(cleanupTotalSize)}</span>)。此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setCleanupConfirmOpen(false)}
              disabled={cleanupDeleting}
              className="rounded-lg"
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteCleanupCandidates}
              disabled={cleanupDeleting}
              className="rounded-lg px-8"
            >
              {cleanupDeleting ? "正在清理..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function shouldKeepForCleanup(item: FileItem, extensionSet: Set<string>) {
  if (item.type !== "file") return false;
  const ext = extensionFromName(item.name);
  return ext.length > 0 && extensionSet.has(ext);
}
