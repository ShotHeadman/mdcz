import { Button, cn, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@mdcz/ui";
import { AlertCircle, FolderOpen, ImageOff, Library, Loader2, Trash2 } from "lucide-react";
import { type ComponentType, type ReactNode, useState } from "react";

const SKELETON_KEYS = ["slot-1", "slot-2", "slot-3", "slot-4", "slot-5", "slot-6", "slot-7", "slot-8"];

export interface RecentAcquisitionViewItem {
  actors: string[];
  id?: string;
  number: string;
  rootId?: string;
  thumbnailRootId?: string | null;
  title: string | null;
  thumbnailPath: string | null;
}

export interface RecentAcquisitionsGridProps<TItem extends RecentAcquisitionViewItem = RecentAcquisitionViewItem> {
  getImageSrc?: (path: string, item: TItem) => string;
  isError?: boolean;
  isLoading?: boolean;
  items: TItem[];
  linkComponent?: ComponentType<{ children: ReactNode; className?: string; item: TItem }>;
  onItemOpen?: (item: TItem) => void;
  onItemRemove?: (item: TItem) => void;
  onRetry?: () => void;
}

export interface RecentAcquisitionRemoveDialogProps {
  open: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export function RecentAcquisitionRemoveDialog({ open, onConfirm, onOpenChange }: RecentAcquisitionRemoveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>从最近入库移除</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RecentAcquisitionsGrid<TItem extends RecentAcquisitionViewItem = RecentAcquisitionViewItem>({
  getImageSrc = (path) => path,
  isError = false,
  isLoading = false,
  items,
  linkComponent: LinkComponent,
  onItemOpen,
  onItemRemove,
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
          onRemove={onItemRemove}
        />
      ))}
    </div>
  );
}

interface AcquisitionCardProps<TItem extends RecentAcquisitionViewItem> {
  getImageSrc: (path: string, item: TItem) => string;
  item: TItem;
  linkComponent?: ComponentType<{ children: ReactNode; className?: string; item: TItem }>;
  onOpen?: (item: TItem) => void;
  onRemove?: (item: TItem) => void;
}

function AcquisitionCard<TItem extends RecentAcquisitionViewItem>({
  getImageSrc,
  item,
  linkComponent: LinkComponent,
  onOpen,
  onRemove,
}: AcquisitionCardProps<TItem>) {
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const imageSrc = !imageLoadFailed && item.thumbnailPath ? getImageSrc(item.thumbnailPath, item) : "";
  const title = item.title?.trim() || item.number;
  const actorText = item.actors.filter(Boolean).join(" / ") || "未知演员";
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
            onError={() => setImageLoadFailed(true)}
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
    </>
  );

  const actions =
    onRemove || onOpen ? (
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {onRemove ? (
          <Button
            aria-label={`从最近入库移除 ${title}`}
            className="h-8 w-8 rounded-quiet-capsule bg-surface-floating/76 p-0 text-foreground backdrop-blur-md hover:bg-surface-floating"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemove(item);
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
        {onOpen ? (
          <Button
            aria-label={`打开 ${title} 所在目录`}
            className="h-8 w-8 rounded-quiet-capsule bg-surface-floating/76 p-0 text-foreground backdrop-blur-md hover:bg-surface-floating"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpen(item);
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    ) : null;

  if (LinkComponent) {
    return (
      <div className={className}>
        <LinkComponent
          className="absolute inset-0 rounded-quiet-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          item={item}
        >
          {content}
        </LinkComponent>
        {actions}
      </div>
    );
  }

  if (onOpen) {
    return (
      <div className={className}>
        <Button
          type="button"
          className="absolute inset-0 h-full w-full items-stretch justify-start rounded-quiet-lg p-0 text-left whitespace-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onOpen(item)}
          variant="ghost"
        >
          {content}
        </Button>
        {actions}
      </div>
    );
  }

  return (
    <div className={className}>
      {content}
      {actions}
    </div>
  );
}
