import { Button, cn } from "@mdcz/ui";
import { AlertCircle, FolderOpen, ImageOff, Library, Loader2 } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

const SKELETON_KEYS = ["slot-1", "slot-2", "slot-3", "slot-4", "slot-5", "slot-6", "slot-7", "slot-8"];

export interface RecentAcquisitionViewItem {
  actors: string[];
  id?: string;
  number: string;
  title: string | null;
  thumbnailPath: string | null;
  available?: boolean | null;
}

export interface RecentAcquisitionsGridProps<TItem extends RecentAcquisitionViewItem = RecentAcquisitionViewItem> {
  getImageSrc?: (path: string) => string;
  isError?: boolean;
  isLoading?: boolean;
  items: TItem[];
  linkComponent?: ComponentType<{ children: ReactNode; className?: string; item: TItem }>;
  onItemOpen?: (item: TItem) => void;
  onRetry?: () => void;
}

export function RecentAcquisitionsGrid<TItem extends RecentAcquisitionViewItem = RecentAcquisitionViewItem>({
  getImageSrc = (path) => path,
  isError = false,
  isLoading = false,
  items,
  linkComponent: LinkComponent,
  onItemOpen,
  onRetry,
}: RecentAcquisitionsGridProps<TItem>) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
        {SKELETON_KEYS.map((key) => (
          <div key={key} className="aspect-[2/3] animate-pulse rounded-quiet-lg bg-surface-raised" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center rounded-quiet-xl bg-surface-low p-8 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <h3 className="mt-4 text-base font-semibold">最近入库加载失败</h3>
        <p className="mt-1 text-sm text-muted-foreground">请稍后重试，或检查应用日志。</p>
        {onRetry && (
          <Button type="button" variant="outline" className="mt-5 rounded-quiet-capsule" onClick={onRetry}>
            <Loader2 className="h-4 w-4" />
            重试
          </Button>
        )}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center rounded-quiet-xl bg-surface-low p-8 text-center">
        <Library className="h-9 w-9 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">暂无刮削记录</h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">完成一次刮削后，最近入库的影片会出现在这里。</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
      {items.map((item) => (
        <AcquisitionCard
          getImageSrc={getImageSrc}
          item={item}
          key={item.id ?? item.number}
          linkComponent={LinkComponent}
          onOpen={onItemOpen}
        />
      ))}
    </div>
  );
}

interface AcquisitionCardProps<TItem extends RecentAcquisitionViewItem> {
  getImageSrc: (path: string) => string;
  item: TItem;
  linkComponent?: ComponentType<{ children: ReactNode; className?: string; item: TItem }>;
  onOpen?: (item: TItem) => void;
}

function AcquisitionCard<TItem extends RecentAcquisitionViewItem>({
  getImageSrc,
  item,
  linkComponent: LinkComponent,
  onOpen,
}: AcquisitionCardProps<TItem>) {
  const imageSrc = item.thumbnailPath ? getImageSrc(item.thumbnailPath) : "";
  const title = item.title?.trim() || item.number;
  const actorText =
    item.actors.filter(Boolean).join(" / ") || (item.available === false ? "文件已移动或删除" : "未知演员");
  const className = cn(
    "group relative aspect-[2/3] rounded-quiet-lg bg-surface-raised text-left shadow-none outline-none transition duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring",
  );

  const content = (
    <>
      <div className="absolute inset-0 overflow-hidden rounded-quiet-lg">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={title}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-8 w-8" />
          </div>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex h-1/3 flex-col justify-end rounded-b-quiet-lg bg-linear-to-t from-surface-floating/92 via-surface-floating/68 to-transparent p-5 text-foreground opacity-95 backdrop-blur-sm transition-opacity group-hover:opacity-100">
        <div className="mb-2 inline-flex max-w-full truncate rounded-quiet-sm font-numeric text-xs font-semibold uppercase tracking-[0.08em] text-foreground/70">
          {item.number}
        </div>
        <div className="line-clamp-1 text-base font-bold leading-tight">{title}</div>
        <div className="mt-1 line-clamp-1 text-sm text-muted-foreground">{actorText}</div>
      </div>
      <div className="absolute right-3 top-3 rounded-quiet-capsule bg-surface-floating/76 p-2 text-foreground opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100">
        <FolderOpen className="h-4 w-4" />
      </div>
    </>
  );

  if (LinkComponent) {
    return (
      <LinkComponent className={className} item={item}>
        {content}
      </LinkComponent>
    );
  }

  return (
    <button type="button" className={className} onClick={() => onOpen?.(item)}>
      {content}
    </button>
  );
}
