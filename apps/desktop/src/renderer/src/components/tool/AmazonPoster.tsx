import { toErrorMessage } from "@mdcz/shared/error";
import type { AmazonPosterScanItem } from "@mdcz/shared/ipcTypes";
import { FolderOpen, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { ipc } from "@/client/ipc";
import { AmazonPosterDialog } from "@/components/AmazonPosterDialog";
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
  TOOL_SECONDARY_BUTTON_CLASS,
  TOOL_SUBSECTION_CLASS,
} from "./toolStyles";
import { browseDirectoryPath } from "./toolUtils";

export function AmazonPoster() {
  const { showError, showInfo, showSuccess } = useToast();
  const [amazonDir, setAmazonDir] = useState("");
  const [amazonPosterDialogOpen, setAmazonPosterDialogOpen] = useState(false);
  const [amazonPosterScanItems, setAmazonPosterScanItems] = useState<AmazonPosterScanItem[]>([]);
  const [amazonScanning, setAmazonScanning] = useState(false);

  const handleChooseDirectory = async () => {
    try {
      const selectedPath = await browseDirectoryPath();
      if (selectedPath) {
        setAmazonDir(selectedPath);
      }
    } catch (error) {
      showError(`目录选择失败: ${toErrorMessage(error)}`);
    }
  };

  const handleAmazonPosterScan = async () => {
    const directory = amazonDir.trim();
    if (!directory) {
      showError("请输入需要扫描的媒体目录");
      return;
    }

    setAmazonScanning(true);
    try {
      const result = await ipc.tool.amazonPosterScan(directory);
      setAmazonPosterScanItems(result.items);
      setAmazonPosterDialogOpen(true);

      if (result.items.length === 0) {
        showInfo("扫描完成，但未找到可处理的 NFO 条目。");
      } else {
        showSuccess(`扫描完成，共找到 ${result.items.length} 个条目。`);
      }
    } catch (error) {
      showError(`Amazon 海报扫描失败: ${toErrorMessage(error)}`);
    } finally {
      setAmazonScanning(false);
    }
  };

  return (
    <>
      <ToolPanel toolId="amazon-poster" icon={<ShoppingCart className="h-5 w-5" />}>
        <div className={TOOL_SUBSECTION_CLASS}>
          <Label
            htmlFor="amazon-poster-dir"
            className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
          >
            目标目录
          </Label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              id="amazon-poster-dir"
              value={amazonDir}
              onChange={(event) => setAmazonDir(event.target.value)}
              placeholder="输入已刮削完成的输出目录"
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
          <p className={TOOL_NOTE_CLASS}>扫描完成后会打开批量处理弹窗，便于集中确认需要替换的海报条目。</p>
        </div>

        <Button
          variant="secondary"
          onClick={handleAmazonPosterScan}
          disabled={amazonScanning}
          className={cn(TOOL_SECONDARY_BUTTON_CLASS, "w-full sm:w-auto")}
        >
          {amazonScanning ? "正在扫描..." : "开始扫描"}
        </Button>
      </ToolPanel>

      <AmazonPosterDialog
        open={amazonPosterDialogOpen}
        onOpenChange={setAmazonPosterDialogOpen}
        items={amazonPosterScanItems}
      />
    </>
  );
}
