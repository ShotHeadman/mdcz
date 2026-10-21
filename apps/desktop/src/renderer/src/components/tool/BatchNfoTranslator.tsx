import { toErrorMessage } from "@mdcz/shared/error";
import type { BatchTranslateMode, BatchTranslateScanItem } from "@mdcz/shared/ipcTypes";
import { useT } from "@mdcz/views/i18n";
import { BatchNfoTranslatorWorkspaceDetail } from "@mdcz/views/tools";
import { useState } from "react";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";
import { browseDirectoryPath } from "./toolUtils";

export function BatchNfoTranslator() {
  const t = useT();
  const [batchTranslateItems, setBatchTranslateItems] = useState<BatchTranslateScanItem[]>([]);
  const [batchTranslateScanning, setBatchTranslateScanning] = useState(false);

  const scanBatchTranslateItems = async (
    directory: string,
    mode: BatchTranslateMode,
    options: { silent?: boolean } = {},
  ) => {
    const targetDirectory = directory.trim();
    if (!targetDirectory) {
      setBatchTranslateItems([]);
      toast.error(t.desktop.enterScanDirectory);
      return null;
    }

    setBatchTranslateScanning(true);
    setBatchTranslateItems([]);
    try {
      const result = await ipc.tool.batchTranslateScan(targetDirectory, mode);
      setBatchTranslateItems(result.items);

      if (!options.silent) {
        if (result.items.length === 0) {
          toast.info(t.desktop.scanCompletedNoItems);
        } else {
          const fieldCount = result.items.reduce((sum, item) => sum + item.pendingFields.length, 0);
          toast.success(t.desktop.scanCompletedSummary(result.items.length, fieldCount));
        }
      }

      return result.items;
    } catch (error) {
      setBatchTranslateItems([]);
      toast.error(t.desktop.scanFailed(toErrorMessage(error)));
      return null;
    } finally {
      setBatchTranslateScanning(false);
    }
  };

  const handleBatchTranslateScan = async (directory: string, mode: BatchTranslateMode) => {
    await scanBatchTranslateItems(directory, mode);
  };

  const handleBatchTranslateApplyComplete = ({
    successCount,
    partialCount,
    failedCount,
    totalCount,
  }: {
    successCount: number;
    partialCount: number;
    failedCount: number;
    totalCount: number;
  }) => {
    if (failedCount === 0) {
      toast.success(t.desktop.batchTranslateCompleted(successCount, totalCount, partialCount));
      return;
    }

    toast.error(t.desktop.batchTranslateCompletedWithErrors(successCount, partialCount, failedCount));
  };

  return (
    <BatchNfoTranslatorWorkspaceDetail
      items={batchTranslateItems}
      scanning={batchTranslateScanning}
      onApply={async (items, batchSize, mode) =>
        (await ipc.tool.batchTranslateApply({ mode, batchSize, items })).results
      }
      onApplyComplete={handleBatchTranslateApplyComplete}
      onBrowseDirectory={browseDirectoryPath}
      onScan={handleBatchTranslateScan}
    />
  );
}
