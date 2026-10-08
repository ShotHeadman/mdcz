import type { LibraryEntryDto } from "@mdcz/shared/serverDtos";
import { type ComponentType, type ReactNode, useState } from "react";

export interface LibraryPosterWallProps {
  entries: LibraryEntryDto[];
  getImageSrc: (path: string, entry: LibraryEntryDto) => string;
  linkComponent?: ComponentType<{ children: ReactNode; className?: string; entry: LibraryEntryDto }>;
}

export function LibraryPosterWall({ entries, getImageSrc, linkComponent: LinkComponent }: LibraryPosterWallProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-4">
      {entries.map((entry) => (
        <PosterTile entry={entry} getImageSrc={getImageSrc} key={entry.id} linkComponent={LinkComponent} />
      ))}
    </div>
  );
}

function PosterTile({
  entry,
  getImageSrc,
  linkComponent: LinkComponent,
}: Pick<LibraryPosterWallProps, "getImageSrc" | "linkComponent"> & { entry: LibraryEntryDto }) {
  const [imageFailed, setImageFailed] = useState(false);
  const id = entry.number || entry.crawlerData?.number || entry.id;
  const title = entry.crawlerData?.title_zh || entry.title || entry.crawlerData?.title || id;
  const src = !imageFailed && entry.thumbnailPath ? getImageSrc(entry.thumbnailPath, entry) : "";
  const tile = (
    <>
      <div className="relative aspect-[2/3] overflow-hidden rounded-[var(--radius-quiet-sm)] bg-surface-low shadow-sm">
        {src ? (
          <img
            alt={title}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImageFailed(true)}
            src={src}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-numeric text-lg font-bold text-muted-foreground">
            {id.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
      <div className="mt-2 min-w-0">
        <div className="truncate font-mono text-[11px] font-bold text-foreground/70">{id}</div>
        <div className="truncate text-xs text-muted-foreground" title={title}>
          {title}
        </div>
      </div>
    </>
  );
  return LinkComponent ? (
    <LinkComponent className="block min-w-0 transition-opacity hover:opacity-80" entry={entry}>
      {tile}
    </LinkComponent>
  ) : (
    <div className="min-w-0">{tile}</div>
  );
}
