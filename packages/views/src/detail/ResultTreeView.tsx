import { validateManualScrapeUrl } from "@mdcz/shared/manualScrapeUrl";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@mdcz/ui";
import { Search, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { type MediaBrowserFilter, type MediaBrowserItem, MediaBrowserList } from "../common";

export interface ResultTreeManualUrlTarget {
  videoPaths: string[];
  number: string;
  canRequeueCurrentRun: boolean;
}

export interface ResultTreeViewProps {
  items: MediaBrowserItem[];
  filter: MediaBrowserFilter;
  stats: Array<{ label: string; value: string; tone?: "default" | "positive" | "negative" }>;
  manualUrlTarget: ResultTreeManualUrlTarget | null;
  scrapeStatus: "idle" | "running" | "stopping" | "paused";
  onClearResults: () => void;
  onFilterChange: (filter: MediaBrowserFilter) => void;
  onManualUrlDialogOpenChange: (open: boolean) => void;
  onManualUrlSubmit: (target: ResultTreeManualUrlTarget, manualUrl: string) => Promise<void>;
  headerTrailing?: ReactNode;
}

export function ResultTreeView({
  items,
  filter,
  stats,
  manualUrlTarget,
  scrapeStatus,
  onClearResults,
  onFilterChange,
  onManualUrlDialogOpenChange,
  onManualUrlSubmit,
  headerTrailing,
}: ResultTreeViewProps) {
  return (
    <>
      <MediaBrowserList
        items={items}
        filter={filter}
        onFilterChange={onFilterChange}
        title="处理队列"
        stats={stats}
        emptyContent={
          <div className="flex flex-col items-center justify-center gap-3 py-16 select-none animate-in fade-in duration-500">
            <Search className="h-12 w-12 text-muted-foreground/20" strokeWidth={1} />
            <span className="text-[13px] text-muted-foreground/40 tracking-wider">暂无结果</span>
          </div>
        }
        headerTrailing={
          headerTrailing ??
          (items.length > 0 ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:text-destructive"
              onClick={onClearResults}
              title="清空结果"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : undefined)
        }
      />
      <ManualUrlRescrapeDialog
        target={manualUrlTarget}
        scrapeStatus={scrapeStatus}
        onOpenChange={onManualUrlDialogOpenChange}
        onSubmit={onManualUrlSubmit}
      />
    </>
  );
}

function ManualUrlRescrapeDialog({
  target,
  scrapeStatus,
  onOpenChange,
  onSubmit,
}: {
  target: ResultTreeManualUrlTarget | null;
  scrapeStatus: "idle" | "running" | "stopping" | "paused";
  onOpenChange: (open: boolean) => void;
  onSubmit: (target: ResultTreeManualUrlTarget, manualUrl: string) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const validation = useMemo(() => validateManualScrapeUrl(url), [url]);
  const errorText = touched && !validation.valid ? validation.message : undefined;

  useEffect(() => {
    if (target) {
      setUrl("");
      setTouched(false);
      setSubmitting(false);
    }
  }, [target]);

  const handleOpenChange = (open: boolean) => {
    if (!open && !submitting) {
      onOpenChange(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (!target || !validation.valid) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(target, validation.route.url);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>按 URL 重新刮削</DialogTitle>
            <DialogDescription>
              当前番号：{target?.number ?? ""} · 状态：{scrapeStatus}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Input
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                if (touched) {
                  setTouched(false);
                }
              }}
              onBlur={() => setTouched(true)}
              placeholder="https://www.dmm.co.jp/"
              aria-invalid={Boolean(errorText)}
              disabled={submitting}
              autoFocus
            />
            {errorText ? <p className="text-sm text-destructive">{errorText}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "提交中..." : "重新刮削"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
