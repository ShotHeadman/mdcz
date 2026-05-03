import { toErrorMessage } from "@mdcz/shared/error";
import type { BatchTranslateApplyResultItem, BatchTranslateScanItem } from "@mdcz/shared/ipcTypes";
import { BatchNfoTranslatorWorkspaceDetail } from "@mdcz/views/tools";
import { useState } from "react";
import { ipc } from "@/client/ipc";
import { useToast } from "@/contexts/ToastProvider";
import { browseDirectoryPath } from "./toolUtils";

export function BatchNfoTranslator() {
  const { showError, showInfo, showSuccess } = useToast();
  const [batchTranslateItems, setBatchTranslateItems] = useState<BatchTranslateScanItem[]>([]);
  const [batchTranslateResults, setBatchTranslateResults] = useState<BatchTranslateApplyResultItem[]>([]);
  const [batchTranslateScanning, setBatchTranslateScanning] = useState(false);
  const [batchTranslateApplying, setBatchTranslateApplying] = useState(false);

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
    setBatchTranslateResults([]);
    await scanBatchTranslateItems(directory);
  };

  const handleBatchTranslateApply = async (items: BatchTranslateScanItem[]) => {
    if (items.length === 0) {
      showInfo("当前没有待翻译条目。");
      return;
    }

    setBatchTranslateApplying(true);
    try {
      const result = await ipc.tool.batchTranslateApply(items);
      setBatchTranslateResults(result.results);

      const successCount = result.results.filter((item) => item.success).length;
      const partialCount = result.results.filter((item) => !item.success && item.translatedFields.length > 0).length;
      const failedCount = result.results.length - successCount - partialCount;

      if (failedCount === 0) {
        showSuccess(`批量翻译完成：成功 ${successCount}，部分成功 ${partialCount}。`);
      } else {
        showError(`批量翻译完成：成功 ${successCount}，部分成功 ${partialCount}，失败 ${failedCount}。`);
      }
    } catch (error) {
      showError(`批量翻译执行失败: ${toErrorMessage(error)}`);
    } finally {
      setBatchTranslateApplying(false);
    }
  };

  return (
    <BatchNfoTranslatorWorkspaceDetail
      applying={batchTranslateApplying}
      items={batchTranslateItems}
      results={batchTranslateResults}
      scanning={batchTranslateScanning}
      onApply={handleBatchTranslateApply}
      onBrowseDirectory={browseDirectoryPath}
      onScan={handleBatchTranslateScan}
    />
  );
}
