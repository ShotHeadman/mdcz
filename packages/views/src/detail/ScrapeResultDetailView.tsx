import type { ScrapeResultDto } from "@mdcz/shared";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@mdcz/ui";
import { FileText, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

export interface ScrapeResultDetailViewProps {
  browserLink?: ReactNode;
  result: ScrapeResultDto;
  onDelete?: () => void;
  onEditNfo?: () => void;
}

export function ScrapeResultDetailView({ browserLink, result, onDelete, onEditNfo }: ScrapeResultDetailViewProps) {
  const title = result.crawlerData?.title_zh || result.crawlerData?.title || result.fileName;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="truncate">{title}</CardTitle>
            <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
              {result.rootDisplayName} / {result.relativePath}
            </p>
          </div>
          <Badge>{result.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {result.error && <p className="text-sm text-destructive">{result.error}</p>}
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <Detail label="番号" value={result.crawlerData?.number ?? "—"} />
          <Detail label="站点" value={result.crawlerData?.website ?? "—"} />
          <Detail label="NFO" value={result.nfoRelativePath ?? "—"} />
          <Detail label="输出路径" value={result.outputRelativePath ?? "—"} />
          <div className="md:col-span-2">
            <Detail label="演员" value={result.crawlerData?.actors.join(" / ") || "—"} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!result.nfoRelativePath} onClick={onEditNfo} type="button" variant="secondary">
            <FileText className="h-4 w-4" />
            NFO
          </Button>
          {browserLink}
          {onDelete && (
            <Button onClick={onDelete} type="button" variant="secondary">
              <Trash2 className="h-4 w-4" />
              删除文件
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-quiet bg-surface-low px-4 py-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 break-all text-foreground">{value}</div>
    </div>
  );
}
