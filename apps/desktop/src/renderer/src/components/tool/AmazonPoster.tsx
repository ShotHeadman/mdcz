import { toErrorMessage } from "@mdcz/shared/error";
import { useT } from "@mdcz/views/i18n";
import type { AmazonPosterApplyItem } from "@mdcz/views/tools";
import { AmazonPosterWorkspaceDetail } from "@mdcz/views/tools";
import { useCallback, useState } from "react";
import { resolveDesktopImageCandidates } from "@/adapters/ports";
import { ipc } from "@/client/ipc";
import { useToast } from "@/contexts/ToastProvider";
import { browseDirectoryPath } from "./toolUtils";

export function AmazonPoster() {
  const t = useT();
  const { showError, showInfo, showSuccess } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [items, setItems] = useState<Awaited<ReturnType<typeof ipc.tool.amazonPosterScan>>["items"]>([]);
  const [scanning, setScanning] = useState(false);

  const handleScan = async (directory: string) => {
    const targetDirectory = directory.trim();
    if (!targetDirectory) {
      showError(t.desktop.enterScanDirectory);
      return;
    }

    setScanning(true);
    try {
      const result = await ipc.tool.amazonPosterScan(targetDirectory);
      setItems(result.items);
      setDialogOpen(true);

      if (result.items.length === 0) {
        showInfo(t.desktop.amazonScanNoItems);
      } else {
        showSuccess(t.desktop.amazonScanCompleted(result.items.length));
      }
    } catch (error) {
      showError(t.desktop.amazonScanFailed(toErrorMessage(error)));
    } finally {
      setScanning(false);
    }
  };

  const handleApply = async (selectedItems: AmazonPosterApplyItem[]) => {
    if (selectedItems.length === 0) {
      showInfo(t.desktop.noAmazonPosterSelected);
      return;
    }

    try {
      const result = await ipc.tool.amazonPosterApply(selectedItems);
      const successCount = result.results.filter((item) => item.success).length;
      const failedCount = result.results.length - successCount;

      if (failedCount === 0) {
        showSuccess(t.desktop.postersReplacedCount(successCount));
      } else {
        showError(t.desktop.replaceCompletedSuccess(successCount, failedCount));
      }

      setDialogOpen(false);
    } catch (error) {
      showError(t.desktop.replaceFailed(toErrorMessage(error)));
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
