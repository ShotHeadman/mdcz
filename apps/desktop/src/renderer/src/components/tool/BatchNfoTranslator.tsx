import { toErrorMessage } from "@mdcz/shared/error";
import type { BatchTranslateScanItem } from "@mdcz/shared/ipcTypes";
import { BatchNfoTranslatorWorkspaceDetail } from "@mdcz/views/tools";
import { useState } from "react";
import { ipc } from "@/client/ipc";
import { useToast } from "@/contexts/ToastProvider";
import { browseDirectoryPath } from "./toolUtils";

export function BatchNfoTranslator() {
  const { showError, showInfo, showSuccess } = useToast();
  const [batchTranslateItems, setBatchTranslateItems] = useState<BatchTranslateScanItem[]>([]);
  const [batchTranslateScanning, setBatchTranslateScanning] = useState(false);

  const scanBatchTranslateItems = async (directory: string, options: { silent?: boolean } = {}) => {
    const targetDirectory = directory.trim();
    if (!targetDirectory) {
      setBatchTranslateItems([]);
      showError("请输入需要扫描的媒体目录");
      return null;
    }

    setBatchTranslateScanning(true);
    setBatchTranslateItems([]);
    try {
      const result = await ipc.tool.batchTranslateScan(targetDirectory);
      setBatchTranslateItems(result.items);

      if (!options.silent) {
        if (result.items.length === 0) {
          showInfo("扫描完成，未发现待翻译的 NFO 条目。");
        } else {
          const fieldCount = result.items.reduce((sum, item) => sum + item.pendingFields.length, 0);
          showSuccess(`扫描完成，共找到 ${result.items.length} 个条目，待处理字段 ${fieldCount} 项。`);
        }
      }

      return result.items;
    } catch (error) {
      setBatchTranslateItems([]);
      showError(`批量翻译扫描失败: ${toErrorMessage(error)}`);
      return null;
    } finally {
      setBatchTranslateScanning(false);
    }
  };

  const handleBatchTranslateScan = async (directory: string) => {
    await scanBatchTranslateItems(directory);
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
      showSuccess(`批量翻译完成：${successCount}/${totalCount} 成功，部分成功 ${partialCount}。`);
      return;
    }

    showError(`批量翻译完成：成功 ${successCount}，部分成功 ${partialCount}，失败 ${failedCount}。`);
  };

  return (
    <BatchNfoTranslatorWorkspaceDetail
      items={batchTranslateItems}
      scanning={batchTranslateScanning}
      onApply={async (items, batchSize) => (await ipc.tool.batchTranslateApply({ batchSize, items })).results}
      onApplyComplete={handleBatchTranslateApplyComplete}
      onBrowseDirectory={browseDirectoryPath}
      onScan={handleBatchTranslateScan}
    />
  );
}
