import { toErrorMessage } from "@mdcz/shared/error";
import type { UncensoredChoice } from "@mdcz/shared/types";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";
import { getScrapeResultTitle } from "@/components/detail/detailViewAdapters";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { ScrollArea } from "@/components/ui/ScrollArea";
import {
  buildUncensoredConfirmItemsForScrapeGroups,
  type ScrapeResultGroup,
  summarizeUncensoredConfirmResultForScrapeGroups,
} from "@/lib/scrapeResultGrouping";
import { useScrapeStore } from "@/store/scrapeStore";

interface UncensoredConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ScrapeResultGroup[];
}

const CHOICE_OPTIONS: Array<{ value: UncensoredChoice; label: string }> = [
  { value: "umr", label: "破解" },
  { value: "leak", label: "流出" },
  { value: "uncensored", label: "无码" },
];

const DEFAULT_CHOICE: UncensoredChoice = "uncensored";

export function UncensoredConfirmDialog({ open, onOpenChange, items }: UncensoredConfirmDialogProps) {
  const [choices, setChoices] = useState<Record<string, UncensoredChoice>>({});
  const [submitting, setSubmitting] = useState(false);
  const resolveUncensoredResults = useScrapeStore((state) => state.resolveUncensoredResults);

  useEffect(() => {
    if (!open) {
      setChoices({});
      return;
    }

    setChoices((prev) => {
      const nextChoices: Record<string, UncensoredChoice> = {};
      for (const group of items) {
        nextChoices[group.id] = prev[group.id] ?? DEFAULT_CHOICE;
      }
      return nextChoices;
    });
  }, [items, open]);

  const handleChoiceChange = (id: string, choice: UncensoredChoice) => {
    setChoices((prev) => ({ ...prev, [id]: choice }));
  };

  const handleSubmit = async () => {
    const confirmItems = buildUncensoredConfirmItemsForScrapeGroups(items, choices);

    if (confirmItems.length === 0) {
      toast.info("没有可提交的条目");
      return;
    }

    setSubmitting(true);
    try {
      const result = await ipc.scraper.confirmUncensored(confirmItems);
      const { successCount, failedCount } = summarizeUncensoredConfirmResultForScrapeGroups(items, result.items);

      if (result.updatedCount > 0) {
        resolveUncensoredResults(result.items);
      }

      if (failedCount === 0) {
        toast.success(`已更新 ${successCount} 个条目的无码类型`);
        onOpenChange(false);
        return;
      }

      if (successCount > 0) {
        toast.warning(`成功 ${successCount} 条，失败 ${failedCount} 条`);
        return;
      }

      toast.error(`成功 0 条，失败 ${failedCount} 条`);
    } catch (error) {
      toast.error(`更新失败: ${toErrorMessage(error, "未知错误")}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBatchSet = (choice: UncensoredChoice) => {
    const newChoices: Record<string, UncensoredChoice> = {};
    for (const item of items) {
      newChoices[item.id] = choice;
    }
    setChoices(newChoices);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>确认无码类型</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground mb-2">请手动确认以下影片类型</div>
        <div className="mb-2 flex gap-1.5">
          <span className="text-xs text-muted-foreground leading-7">批量设为：</span>
          {CHOICE_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => handleBatchSet(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <ScrollArea className="max-h-[50vh]">
          <div className="space-y-2">
            {items.map((group) => (
              <div key={group.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{group.display.fileInfo.number}</div>
                  {getScrapeResultTitle(group.display) && (
                    <div className="text-xs text-muted-foreground truncate">{getScrapeResultTitle(group.display)}</div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  {CHOICE_OPTIONS.map((opt) => (
                    <Button
                      key={opt.value}
                      size="sm"
                      variant={(choices[group.id] ?? DEFAULT_CHOICE) === opt.value ? "default" : "outline"}
                      className="h-7 px-2.5 text-xs"
                      onClick={() => handleChoiceChange(group.id, opt.value)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            跳过
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
