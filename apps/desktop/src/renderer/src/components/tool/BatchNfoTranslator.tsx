import { toErrorMessage } from "@mdcz/shared/error";
import type { BatchTranslateApplyResultItem, BatchTranslateScanItem } from "@mdcz/shared/ipcTypes";
import { FileSearch, FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { ipc } from "@/client/ipc";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { useToast } from "@/contexts/ToastProvider";
import { cn } from "@/lib/utils";
import { ToolPanel } from "./ToolPanel";
import {
  TOOL_ICON_BUTTON_CLASS,
  TOOL_INPUT_CLASS,
  TOOL_NOTE_CLASS,
  TOOL_PRIMARY_BUTTON_CLASS,
  TOOL_SECONDARY_BUTTON_CLASS,
  TOOL_SUBSECTION_CLASS,
  TOOL_TABLE_SHELL_CLASS,
} from "./toolStyles";
import { browseDirectoryPath } from "./toolUtils";

export function BatchNfoTranslator() {
  const { showError, showInfo, showSuccess } = useToast();
  const [batchTranslateDir, setBatchTranslateDir] = useState("");
  const [batchTranslateItems, setBatchTranslateItems] = useState<BatchTranslateScanItem[]>([]);
  const [batchTranslateResults, setBatchTranslateResults] = useState<BatchTranslateApplyResultItem[]>([]);
  const [batchTranslateScanning, setBatchTranslateScanning] = useState(false);
  const [batchTranslateApplying, setBatchTranslateApplying] = useState(false);
  const batchTranslatePreviewRows = batchTranslateItems.slice(0, 300);
  const batchTranslateResultRows = batchTranslateResults.slice(0, 300);
  const batchTranslatePendingFieldCount = useMemo(
    () => batchTranslateItems.reduce((sum, item) => sum + item.pendingFields.length, 0),
    [batchTranslateItems],
  );

  const handleChooseDirectory = async () => {
    try {
      const selectedPath = await browseDirectoryPath();
      if (selectedPath) {
        setBatchTranslateDir(selectedPath);
      }
    } catch (error) {
      showError(`目录选择失败: ${toErrorMessage(error)}`);
    }
  };

  const scanBatchTranslateItems = async (options: { silent?: boolean } = {}) => {
    const directory = batchTranslateDir.trim();
    if (!directory) {
      setBatchTranslateItems([]);
      showError("请输入需要扫描的媒体目录");
      return null;
    }

    setBatchTranslateScanning(true);
    setBatchTranslateItems([]);
    try {
      const result = await ipc.tool.batchTranslateScan(directory);
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

  const handleBatchTranslateScan = async () => {
    setBatchTranslateResults([]);
    await scanBatchTranslateItems();
  };

  const handleBatchTranslateApply = async () => {
    if (batchTranslateItems.length === 0) {
      showInfo("当前没有待翻译条目。");
      return;
    }

    setBatchTranslateApplying(true);
    try {
      const result = await ipc.tool.batchTranslateApply(batchTranslateItems);
      setBatchTranslateResults(result.results);

      const successCount = result.results.filter((item) => item.success).length;
      const partialCount = result.results.filter((item) => !item.success && item.translatedFields.length > 0).length;
      const failedCount = result.results.length - successCount - partialCount;

      if (failedCount === 0) {
        showSuccess(`批量翻译完成：成功 ${successCount}，部分成功 ${partialCount}。`);
      } else {
        showError(`批量翻译完成：成功 ${successCount}，部分成功 ${partialCount}，失败 ${failedCount}。`);
      }

      await scanBatchTranslateItems({ silent: true });
    } catch (error) {
      showError(`批量翻译执行失败: ${toErrorMessage(error)}`);
    } finally {
      setBatchTranslateApplying(false);
    }
  };

  return (
    <ToolPanel toolId="batch-nfo-translator" icon={<FileSearch className="h-5 w-5" />}>
      <div className={TOOL_SUBSECTION_CLASS}>
        <Label
          htmlFor="batch-translate-dir"
          className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
        >
          目标目录
        </Label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            id="batch-translate-dir"
            value={batchTranslateDir}
            onChange={(event) => setBatchTranslateDir(event.target.value)}
            placeholder="输入已刮削完成的媒体目录"
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
        <p className={TOOL_NOTE_CLASS}>该工具使用当前配置中的 LLM 模型、Base URL 与 API Key，独立于主刮削翻译流程。</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          variant="secondary"
          onClick={handleBatchTranslateScan}
          disabled={batchTranslateScanning || batchTranslateApplying}
          className={cn(TOOL_SECONDARY_BUTTON_CLASS, "flex-1")}
        >
          {batchTranslateScanning ? "正在扫描..." : "扫描待翻译条目"}
        </Button>
        <Button
          onClick={handleBatchTranslateApply}
          disabled={batchTranslateApplying || batchTranslateScanning || batchTranslateItems.length === 0}
          className={cn(TOOL_PRIMARY_BUTTON_CLASS, "flex-1")}
        >
          {batchTranslateApplying ? "正在批量翻译..." : "开始批量翻译并回写"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">待处理条目</span>
        <Badge variant="secondary" className="rounded-quiet-capsule px-2.5 py-1">
          {batchTranslateItems.length}
        </Badge>
        <span className="text-muted-foreground">待处理字段</span>
        <Badge variant="secondary" className="rounded-quiet-capsule px-2.5 py-1">
          {batchTranslatePendingFieldCount}
        </Badge>
        {batchTranslateResults.length > 0 ? (
          <>
            <span className="text-muted-foreground">本次执行结果</span>
            <Badge variant="secondary" className="rounded-quiet-capsule px-2.5 py-1">
              {batchTranslateResults.length}
            </Badge>
          </>
        ) : null}
      </div>

      <div className={TOOL_TABLE_SHELL_CLASS}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-low/90 text-muted-foreground">
                <th className="w-28 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">番号</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">标题</th>
                <th className="w-40 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">待处理字段</th>
                <th className="w-72 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">NFO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/5">
              {batchTranslatePreviewRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground italic">
                    暂无待翻译条目
                  </td>
                </tr>
              ) : (
                batchTranslatePreviewRows.map((item) => (
                  <tr key={item.filePath} className="transition-colors hover:bg-surface-low/45">
                    <td className="px-4 py-3 font-mono font-medium">{item.number}</td>
                    <td className="px-4 py-3">{item.title}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {item.pendingFields.map((field) => (
                          <Badge
                            key={`${item.filePath}-${field}`}
                            variant="secondary"
                            className="rounded-quiet-capsule px-2.5 py-1"
                          >
                            {field === "title" ? "标题" : "简介"}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="break-all px-4 py-3 font-mono text-[11px] text-muted-foreground">{item.nfoPath}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {batchTranslateResults.length > 0 ? (
        <div className="space-y-3">
          <Label className="px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            最近一次执行结果
          </Label>
          <div className={TOOL_TABLE_SHELL_CLASS}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-low/90 text-muted-foreground">
                    <th className="w-24 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">状态</th>
                    <th className="w-28 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">番号</th>
                    <th className="w-36 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">已写回字段</th>
                    <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">结果</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/5">
                  {batchTranslateResultRows.map((item) => {
                    const partial = !item.success && item.translatedFields.length > 0;
                    return (
                      <tr
                        key={`${item.filePath}-${item.nfoPath}`}
                        className="transition-colors hover:bg-surface-low/45"
                      >
                        <td className="px-4 py-3">
                          <Badge variant="secondary" className="rounded-quiet-capsule px-2.5 py-1">
                            {item.success ? "成功" : partial ? "部分成功" : "失败"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-mono font-medium">{item.number}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {item.translatedFields.length === 0 ? (
                              <span className="text-muted-foreground">-</span>
                            ) : (
                              item.translatedFields.map((field) => (
                                <Badge
                                  key={`${item.nfoPath}-${field}`}
                                  variant="secondary"
                                  className="rounded-quiet-capsule px-2.5 py-1"
                                >
                                  {field === "title" ? "标题" : "简介"}
                                </Badge>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            {item.savedNfoPath ? (
                              <div className="break-all font-mono text-[11px] text-muted-foreground">
                                {item.savedNfoPath}
                              </div>
                            ) : null}
                            {item.error ? <div className="text-destructive">{item.error}</div> : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </ToolPanel>
  );
}
