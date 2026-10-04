import { defaultConfiguration, type SiteUrlConfiguration } from "@mdcz/shared/config";
import { validateManualScrapeUrl } from "@mdcz/shared/manualScrapeUrl";
import type { ScrapeFileRefDto } from "@mdcz/shared/serverDtos";
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
import { Search } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { type MediaBrowserFilter, type MediaBrowserItem, MediaBrowserList } from "../common";
import { useT } from "../i18n";

export interface ResultTreeManualUrlTarget {
  videoPaths: string[];
  targets: Array<{ filePath: string; ref: ScrapeFileRefDto }>;
  number: string;
}

export interface ResultTreeViewProps {
  items: MediaBrowserItem[];
  filter: MediaBrowserFilter;
  stats: Array<{ label: string; value: string; tone?: "default" | "positive" | "negative" }>;
  manualUrlTarget: ResultTreeManualUrlTarget | null;
  siteUrls: SiteUrlConfiguration | undefined;
  scrapeStatus: "idle" | "running" | "stopping" | "paused";
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
  siteUrls,
  scrapeStatus,
  onFilterChange,
  onManualUrlDialogOpenChange,
  onManualUrlSubmit,
  headerTrailing,
}: ResultTreeViewProps) {
  const t = useT();
  return (
    <>
      <MediaBrowserList
        items={items}
        filter={filter}
        onFilterChange={onFilterChange}
        title={t.detail.processingQueue}
        stats={stats}
        emptyContent={
          <div className="flex flex-col items-center justify-center gap-3 py-16 select-none animate-in fade-in duration-500">
            <Search className="h-12 w-12 text-muted-foreground/20" strokeWidth={1} />
            <span className="text-[13px] text-muted-foreground/40 tracking-wider">{t.detail.noResults}</span>
          </div>
        }
        headerTrailing={headerTrailing}
      />
      <ManualUrlRescrapeDialog
        target={manualUrlTarget}
        siteUrls={siteUrls}
        scrapeStatus={scrapeStatus}
        onOpenChange={onManualUrlDialogOpenChange}
        onSubmit={onManualUrlSubmit}
      />
    </>
  );
}

function ManualUrlRescrapeDialog({
  target,
  siteUrls = defaultConfiguration.network,
  scrapeStatus,
  onOpenChange,
  onSubmit,
}: {
  target: ResultTreeManualUrlTarget | null;
  siteUrls: SiteUrlConfiguration | undefined;
  scrapeStatus: "idle" | "running" | "stopping" | "paused";
  onOpenChange: (open: boolean) => void;
  onSubmit: (target: ResultTreeManualUrlTarget, manualUrl: string) => Promise<void>;
}) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const validation = useMemo(() => validateManualScrapeUrl(url, siteUrls), [url, siteUrls]);
  const errorText = touched && !validation.valid ? t.domain.manualScrapeUrlInvalid[validation.reason] : undefined;

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
            <DialogTitle>{t.detail.rescrapeByUrl}</DialogTitle>
            <DialogDescription>{t.detail.currentStatus(target?.number ?? "", scrapeStatus)}</DialogDescription>
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
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t.detail.submitting : t.detail.rescrape}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
