import { toErrorMessage } from "@mdcz/shared/error";
import type { AmazonPosterApplyItem, AmazonPosterImageOptionProps } from "@mdcz/views/tools";
import { AmazonPosterWorkspaceDetail } from "@mdcz/views/tools";
import { useCallback, useState } from "react";
import { ipc } from "@/client/ipc";
import { ImageOptionCard } from "@/components/ImageOptionCard";
import { useToast } from "@/contexts/ToastProvider";
import { useResolvedImageSrc } from "@/hooks/useResolvedImageSources";
import { browseDirectoryPath } from "./toolUtils";

function SummaryThumb({
  empty = false,
  loading = false,
  src,
}: {
  empty?: boolean;
  loading?: boolean;
  src?: string | null;
}) {
  const resolvedSrc = useResolvedImageSrc(src ? [src] : []);

  if (loading) return <div className="h-[22px] w-8 animate-pulse rounded-md bg-muted/50" />;
  if (empty || !resolvedSrc) {
    return (
      <div className="flex h-[22px] w-8 items-center justify-center rounded-md border border-dashed border-muted-foreground/30 bg-muted/20">
        <span className="text-[10px] text-muted-foreground/50">IMG</span>
      </div>
    );
  }

  return <img src={resolvedSrc} alt="thumbnail" className="h-[22px] w-8 rounded-md border bg-muted/20 object-cover" />;
}

export function AmazonPoster() {
  const { showError, showInfo, showSuccess } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [items, setItems] = useState<Awaited<ReturnType<typeof ipc.tool.amazonPosterScan>>["items"]>([]);
  const [scanning, setScanning] = useState(false);

  const handleScan = async (directory: string) => {
    const targetDirectory = directory.trim();
    if (!targetDirectory) {
      showError("请输入需要扫描的媒体目录");
      return;
    }

    setScanning(true);
    try {
      const result = await ipc.tool.amazonPosterScan(targetDirectory);
      setItems(result.items);
      setDialogOpen(true);

      if (result.items.length === 0) {
        showInfo("扫描完成，但未找到可处理的 NFO 条目。");
      } else {
        showSuccess(`扫描完成，共找到 ${result.items.length} 个条目。`);
      }
    } catch (error) {
      showError(`Amazon 海报扫描失败: ${toErrorMessage(error)}`);
    } finally {
      setScanning(false);
    }
  };

  const handleApply = async (selectedItems: AmazonPosterApplyItem[]) => {
    if (selectedItems.length === 0) {
      showInfo("当前没有选中的 Amazon 海报。");
      return;
    }

    try {
      const result = await ipc.tool.amazonPosterApply(selectedItems);
      const successCount = result.results.filter((item) => item.success).length;
      const failedCount = result.results.length - successCount;

      if (failedCount === 0) {
        showSuccess(`已替换 ${successCount} 个海报文件。`);
      } else {
        showError(`替换完成：成功 ${successCount}，失败 ${failedCount}。`);
      }

      setDialogOpen(false);
    } catch (error) {
      showError(`海报替换失败: ${toErrorMessage(error)}`);
    }
  };

  const renderImageOption = useCallback((props: AmazonPosterImageOptionProps) => <ImageOptionCard {...props} />, []);

  const renderThumbnail = useCallback(
    (src: string | null | undefined, options?: { empty?: boolean; loading?: boolean }) => (
      <SummaryThumb src={src} empty={options?.empty} loading={options?.loading} />
    ),
    [],
  );
  const handleLookup = useCallback(
    (item: (typeof items)[number]) => ipc.tool.amazonPosterLookup(item.nfoPath, item.title),
    [],
  );

  return (
    <AmazonPosterWorkspaceDetail
      dialogOpen={dialogOpen}
      items={items}
      scanning={scanning}
      renderImageOption={renderImageOption}
      renderThumbnail={renderThumbnail}
      onApply={handleApply}
      onBrowseDirectory={browseDirectoryPath}
      onDialogOpenChange={setDialogOpen}
      onLookup={handleLookup}
      onScan={handleScan}
    />
  );
}
