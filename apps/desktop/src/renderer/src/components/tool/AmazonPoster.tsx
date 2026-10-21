import { toErrorMessage } from "@mdcz/shared/error";
import { useT } from "@mdcz/views/i18n";
import type { AmazonPosterApplyItem } from "@mdcz/views/tools";
import { AmazonPosterWorkspaceDetail } from "@mdcz/views/tools";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { resolveDesktopImageCandidates } from "@/adapters/ports";
import { ipc } from "@/client/ipc";
import { browseDirectoryPath } from "./toolUtils";

export function AmazonPoster() {
  const t = useT();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [items, setItems] = useState<Awaited<ReturnType<typeof ipc.tool.amazonPosterScan>>["items"]>([]);
  const [scanning, setScanning] = useState(false);

  const handleScan = async (directory: string) => {
    const targetDirectory = directory.trim();
    if (!targetDirectory) {
      toast.error(t.desktop.enterScanDirectory);
      return;
    }

    setScanning(true);
    try {
      const result = await ipc.tool.amazonPosterScan(targetDirectory);
      setItems(result.items);
      setDialogOpen(true);

      if (result.items.length === 0) {
        toast.info(t.desktop.amazonScanNoItems);
      } else {
        toast.success(t.desktop.amazonScanCompleted(result.items.length));
      }
    } catch (error) {
      toast.error(t.desktop.amazonScanFailed(toErrorMessage(error)));
    } finally {
      setScanning(false);
    }
  };

  const handleApply = async (selectedItems: AmazonPosterApplyItem[]) => {
    if (selectedItems.length === 0) {
      toast.info(t.desktop.noAmazonPosterSelected);
      return;
    }

    try {
      const result = await ipc.tool.amazonPosterApply(selectedItems);
      const successCount = result.results.filter((item) => item.success).length;
      const failedCount = result.results.length - successCount;

      if (failedCount === 0) {
        toast.success(t.desktop.postersReplacedCount(successCount));
      } else {
        toast.error(t.desktop.replaceCompletedSuccess(successCount, failedCount));
      }

      setDialogOpen(false);
    } catch (error) {
      toast.error(t.desktop.replaceFailed(toErrorMessage(error)));
    }
  };

  const handleLookup = useCallback(
    (item: (typeof items)[number]) => ipc.tool.amazonPosterLookup(item.nfoPath, item.title),
    [],
  );

  return (
    <AmazonPosterWorkspaceDetail
      dialogOpen={dialogOpen}
      items={items}
      scanning={scanning}
      resolveImageCandidates={resolveDesktopImageCandidates}
      onApply={handleApply}
      onBrowseDirectory={browseDirectoryPath}
      onDialogOpenChange={setDialogOpen}
      onLookup={handleLookup}
      onScan={handleScan}
    />
  );
}
