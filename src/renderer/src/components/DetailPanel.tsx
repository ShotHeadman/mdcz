import { CheckCircle2, FileText, FolderOpen, ImageIcon, Play, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { readNfo, updateNfo } from "@/api/manual";
import { SceneImageGallery } from "@/components/SceneImageGallery";
import { Row } from "@/components/shared/Row";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { Separator } from "@/components/ui/Separator";
import { useScrapeStore } from "@/store/scrapeStore";
import { useUIStore } from "@/store/uiStore";
import { buildImageSourceCandidates, getImageSrc } from "@/utils/image";

function getDirFromPath(filePath: string) {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (slash <= 0) return filePath;
  return filePath.slice(0, slash);
}

function toRenderableSrc(path: string | undefined): string {
  if (!path) {
    return "";
  }

  return getImageSrc(path);
}

export function DetailPanel() {
  const { results } = useScrapeStore();
  const { selectedResultId } = useUIStore();
  const [nfoOpen, setNfoOpen] = useState(false);
  const [nfoPath, setNfoPath] = useState("");
  const [nfoContent, setNfoContent] = useState("");
  const [nfoLoading, setNfoLoading] = useState(false);
  const [nfoSaving, setNfoSaving] = useState(false);
  const [posterSrc, setPosterSrc] = useState("");
  const [thumbSrc, setThumbSrc] = useState("");

  const selectedItem = results.find((r) => r.id === selectedResultId);
  const posterCandidates = buildImageSourceCandidates({
    remotePath: selectedItem?.poster_url,
    filePath: selectedItem?.path,
    outputPath: selectedItem?.output_path,
    fileName: "poster.jpg",
  });
  const thumbCandidates = buildImageSourceCandidates({
    remotePath: selectedItem?.thumb_url,
    filePath: selectedItem?.path,
    outputPath: selectedItem?.output_path,
    fileName: "cover.jpg",
  });

  useEffect(() => {
    setPosterSrc(toRenderableSrc(posterCandidates.primary));
    setThumbSrc(toRenderableSrc(thumbCandidates.primary));
  }, [posterCandidates.primary, thumbCandidates.primary]);

  const handlePlay = () => {
    if (!selectedItem?.path) {
      toast.info("请先选择一个项目");
      return;
    }
    if (window.electron?.openPath) {
      window.electron.openPath(selectedItem.path);
    } else {
      toast.info("播放功能仅在桌面模式下可用");
    }
  };

  const handleOpenFolder = () => {
    if (!selectedItem?.path) {
      toast.info("请先选择一个项目");
      return;
    }
    if (window.electron?.openPath) {
      const dir = getDirFromPath(selectedItem.path);
      window.electron.openPath(dir);
    } else {
      toast.info("打开文件夹功能仅在桌面模式下可用");
    }
  };

  const openNfoEditor = useCallback(async (path: string) => {
    try {
      setNfoLoading(true);
      const response = await readNfo(path);
      setNfoPath(path);
      setNfoContent(response.data?.content ?? "");
      setNfoOpen(true);
    } catch {
      toast.error("加载 NFO 失败");
    } finally {
      setNfoLoading(false);
    }
  }, []);

  const handleSaveNfo = async () => {
    try {
      setNfoSaving(true);
      await updateNfo(nfoPath, nfoContent);
      toast.success("NFO 已保存");
      setNfoOpen(false);
    } catch {
      toast.error("保存 NFO 失败");
    } finally {
      setNfoSaving(false);
    }
  };

  const handleOpenNfo = async () => {
    if (!selectedItem?.path) {
      toast.info("请先选择一个项目");
      return;
    }
    await openNfoEditor(selectedItem.path);
  };

  const handlePosterError = () => {
    const localPoster = toRenderableSrc(posterCandidates.fallback);
    if (localPoster && localPoster !== posterSrc) {
      setPosterSrc(localPoster);
    }
  };

  const handleThumbError = () => {
    const localThumb = toRenderableSrc(thumbCandidates.fallback);
    if (localThumb && localThumb !== thumbSrc) {
      setThumbSrc(localThumb);
    }
  };

  useEffect(() => {
    const listener = (event: Event) => {
      const custom = event as CustomEvent<{ path?: string }>;
      const path = custom.detail?.path || selectedItem?.path;
      if (!path) return;
      void openNfoEditor(path);
    };
    window.addEventListener("app:open-nfo", listener);
    return () => {
      window.removeEventListener("app:open-nfo", listener);
    };
  }, [openNfoEditor, selectedItem?.path]);

  if (!selectedItem) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-xs opacity-60">
        <FileText className="h-12 w-12 mb-2 opacity-20" />
        请选择一个项目以查看详情
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Sticky Header */}
      <div className="shrink-0 px-4 py-2.5 border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">{selectedItem.number}</h2>
              {selectedItem.status === "success" ? (
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500 shrink-0" />
              )}
            </div>
            {selectedItem.title && (
              <p className="text-sm text-muted-foreground leading-snug mt-1">{selectedItem.title}</p>
            )}
          </div>
          <div className="flex gap-1 shrink-0">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handlePlay} title="播放">
              <Play className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleOpenFolder} title="打开文件夹">
              <FolderOpen className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={handleOpenNfo}
              title="编辑 NFO"
              disabled={nfoLoading}
            >
              <FileText className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4 min-w-0">
          {/* Poster + Metadata Side by Side */}
          <div className="flex gap-4 items-stretch">
            {/* Poster (left, fixed width) */}
            <div className="shrink-0 w-36 self-stretch">
              {posterSrc ? (
                <div className="relative bg-muted/20 rounded-lg overflow-hidden border aspect-[2/3]">
                  <img
                    src={posterSrc}
                    alt="Poster"
                    className="w-full h-full object-cover"
                    onError={handlePosterError}
                  />
                </div>
              ) : (
                <div className="w-full aspect-2/3 bg-muted/20 rounded-lg flex items-center justify-center border border-dashed">
                  <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
                </div>
              )}
            </div>

            {/* Metadata (right, flexible) */}
            <div className="flex-1 min-w-0 space-y-1">
              {selectedItem.actors && selectedItem.actors.length > 0 && (
                <Row label="演员" variant="metadata">
                  {selectedItem.actors.join(", ")}
                </Row>
              )}
              {selectedItem.release && (
                <Row label="发行" variant="metadata">
                  {selectedItem.release}
                </Row>
              )}
              {selectedItem.duration && (
                <Row label="时长" variant="metadata">
                  {selectedItem.duration}
                </Row>
              )}
              {selectedItem.resolution && (
                <Row label="分辨率" variant="metadata">
                  {selectedItem.resolution}
                </Row>
              )}
              {selectedItem.codec && (
                <Row label="编码" variant="metadata">
                  {selectedItem.codec}
                </Row>
              )}
              {selectedItem.bitrate && (
                <Row label="码率" variant="metadata">
                  {selectedItem.bitrate}
                </Row>
              )}
              {selectedItem.studio && (
                <Row label="制片" variant="metadata">
                  {selectedItem.studio}
                </Row>
              )}
              {selectedItem.series && (
                <Row label="系列" variant="metadata">
                  {selectedItem.series}
                </Row>
              )}
              {selectedItem.publisher && (
                <Row label="发行商" variant="metadata">
                  {selectedItem.publisher}
                </Row>
              )}
              {selectedItem.score && (
                <Row label="评分" variant="metadata">
                  {selectedItem.score}
                </Row>
              )}
              {selectedItem.directors && selectedItem.directors.length > 0 && (
                <Row label="导演" variant="metadata">
                  {selectedItem.directors.join(", ")}
                </Row>
              )}
            </div>
          </div>

          {/* Tags */}
          {selectedItem.tags && selectedItem.tags.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-2">标签</div>
              <div className="flex flex-wrap gap-1.5">
                {selectedItem.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px] py-0.5 h-5 px-2">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <Separator />

          {/* Cover / Thumbnail (full width, 16:9) */}
          {thumbSrc && (
            <div className="bg-black/5 rounded-xl overflow-hidden border">
              <div className="aspect-video flex items-center justify-center">
                <img src={thumbSrc} alt="Cover" className="w-full h-full object-cover" onError={handleThumbError} />
              </div>
            </div>
          )}

          {/* Scene Image Gallery */}
          {selectedItem.scene_images && selectedItem.scene_images.length > 0 && (
            <>
              <Separator />
              <SceneImageGallery images={selectedItem.scene_images} />
            </>
          )}

          <Separator />

          {/* Outline */}
          {selectedItem.outline && (
            <div>
              <div className="text-xs text-muted-foreground mb-2">内容简介</div>
              <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">
                {selectedItem.outline}
              </p>
            </div>
          )}

          {/* File Path */}
          {selectedItem.path && (
            <div>
              <div className="text-xs text-muted-foreground mb-2">文件路径</div>
              <div className="font-mono text-[10px] bg-muted/50 px-2 py-1.5 rounded break-all opacity-70">
                {selectedItem.path}
              </div>
            </div>
          )}

          {/* Error Message */}
          {selectedItem.error_msg && (
            <div>
              <div className="text-xs text-muted-foreground mb-2">错误详情</div>
              <div className="text-xs text-red-500 bg-red-50 dark:bg-red-950/20 px-2 py-1.5 rounded">
                {selectedItem.error_msg}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* NFO Editor Dialog */}
      <Dialog open={nfoOpen} onOpenChange={setNfoOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>编辑 NFO 文件</DialogTitle>
          </DialogHeader>
          <textarea
            value={nfoContent}
            onChange={(e) => setNfoContent(e.target.value)}
            className="h-[60vh] w-full resize-none rounded-md border bg-background p-3 font-mono text-[11px]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNfoOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveNfo} disabled={nfoSaving}>
              保存修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
