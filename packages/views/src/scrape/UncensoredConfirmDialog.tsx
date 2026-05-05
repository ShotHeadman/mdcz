import type { AmbiguousUncensoredItemDto } from "@mdcz/shared/serverDtos";
import type { UncensoredChoice } from "@mdcz/shared/types";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, ScrollArea } from "@mdcz/ui";
import { useEffect, useState } from "react";

export type AmbiguousUncensoredItem = AmbiguousUncensoredItemDto;

export interface UncensoredConfirmSelection extends AmbiguousUncensoredItem {
  choice: UncensoredChoice;
}

export interface UncensoredConfirmDialogProps {
  open: boolean;
  items: AmbiguousUncensoredItem[];
  onOpenChange: (open: boolean) => void;
  onConfirm: (items: UncensoredConfirmSelection[]) => Promise<void> | void;
}

const CHOICE_OPTIONS: Array<{ value: UncensoredChoice; label: string }> = [
  { value: "umr", label: "破解" },
  { value: "leak", label: "流出" },
  { value: "uncensored", label: "无码" },
];

const DEFAULT_CHOICE: UncensoredChoice = "uncensored";

export function UncensoredConfirmDialog({ open, items, onOpenChange, onConfirm }: UncensoredConfirmDialogProps) {
  const [choices, setChoices] = useState<Record<string, UncensoredChoice>>({});
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!open) {
      setChoices({});
      setErrorMessage("");
      return;
    }

    setChoices((prev) => {
      const nextChoices: Record<string, UncensoredChoice> = {};
      for (const item of items) {
        nextChoices[item.id] = prev[item.id] ?? DEFAULT_CHOICE;
      }
      return nextChoices;
    });
  }, [items, open]);

  const handleChoiceChange = (id: string, choice: UncensoredChoice) => {
    setChoices((prev) => ({ ...prev, [id]: choice }));
  };

  const handleBatchSet = (choice: UncensoredChoice) => {
    const nextChoices: Record<string, UncensoredChoice> = {};
    for (const item of items) {
      nextChoices[item.id] = choice;
    }
    setChoices(nextChoices);
  };

  const handleSubmit = async () => {
    const selections = items.map((item) => ({
      ...item,
      choice: choices[item.id] ?? DEFAULT_CHOICE,
    }));

    if (selections.length === 0) {
      setErrorMessage("没有可提交的条目");
      return;
    }

    setSubmitting(true);
    setErrorMessage("");
    try {
      await onConfirm(selections);
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>确认无码类型</DialogTitle>
        </DialogHeader>
        <div className="mb-2 text-xs text-muted-foreground">请手动确认以下影片类型</div>
        <div className="mb-2 flex gap-1.5">
          <span className="text-xs leading-7 text-muted-foreground">批量设为：</span>
          {CHOICE_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              type="button"
              onClick={() => handleBatchSet(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <ScrollArea className="max-h-[50vh]">
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{item.number || item.fileName}</div>
                  {item.title ? <div className="truncate text-xs text-muted-foreground">{item.title}</div> : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  {CHOICE_OPTIONS.map((opt) => (
                    <Button
                      key={opt.value}
                      size="sm"
                      variant={(choices[item.id] ?? DEFAULT_CHOICE) === opt.value ? "default" : "outline"}
                      className="h-7 px-2.5 text-xs"
                      type="button"
                      onClick={() => handleChoiceChange(item.id, opt.value)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
        {errorMessage ? <div className="text-sm text-destructive">{errorMessage}</div> : null}
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            跳过
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
