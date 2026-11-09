import type { LibraryEntryDto } from "@mdcz/shared/serverDtos";
import { Checkbox, cn } from "@mdcz/ui";
import { type ComponentType, type ReactNode, useState } from "react";
import { useT } from "../i18n";

export interface LibraryPosterWallProps {
  entries: LibraryEntryDto[];
  getImageSrc: (path: string, entry: LibraryEntryDto) => string;
  linkComponent?: ComponentType<{ children: ReactNode; className?: string; entry: LibraryEntryDto }>;
  selectable?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelected?: (id: string) => void;
}

export function LibraryPosterWall({
  entries,
  getImageSrc,
  linkComponent: LinkComponent,
  selectable = false,
  selectedIds,
  onToggleSelected,
}: LibraryPosterWallProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-4">
      {entries.map((entry) => (
        <PosterTile
          entry={entry}
          getImageSrc={getImageSrc}
          key={entry.id}
          linkComponent={LinkComponent}
          onToggleSelected={onToggleSelected}
          selectable={selectable}
          selected={selectedIds?.has(entry.id) ?? false}
        />
      ))}
    </div>
  );
}

function PosterTile({
  entry,
  getImageSrc,
  linkComponent: LinkComponent,
  selectable,
  selected,
  onToggleSelected,
}: Pick<LibraryPosterWallProps, "getImageSrc" | "linkComponent" | "selectable" | "onToggleSelected"> & {
  entry: LibraryEntryDto;
  selected: boolean;
}) {
  const t = useT();
  const [imageFailed, setImageFailed] = useState(false);
  const fileName = entry.fileRefs.find((file) => file.id === entry.displayFileId)?.fileName;
  const id = entry.number || entry.crawlerData?.number || entry.mediaIdentity || fileName || entry.id;
  const title = entry.crawlerData?.title_zh || entry.title || entry.crawlerData?.title || id;
  const src = !imageFailed && entry.thumbnailPath ? getImageSrc(entry.thumbnailPath, entry) : "";
  const checkboxId = `poster-select-${entry.id}`;
  const tile = (
    <>
      <div
        className={cn(
          "relative aspect-[2/3] overflow-hidden rounded-[var(--radius-quiet-sm)] bg-surface-low shadow-sm",
          selectable && selected && "ring-2 ring-primary",
        )}
      >
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
        {selectable ? (
          <div className="absolute top-2 left-2 rounded bg-surface/90 p-1 shadow-sm">
            <Checkbox
              aria-label={t.library.selectEntry(id)}
              checked={selected}
              id={checkboxId}
              onCheckedChange={() => onToggleSelected?.(entry.id)}
            />
          </div>
        ) : null}
      </div>
      <div className="mt-2 min-w-0">
        <div className="truncate font-mono text-[11px] font-bold text-foreground/70">{id}</div>
        <div className="truncate text-xs text-muted-foreground" title={title}>
          {title}
        </div>
      </div>
    </>
  );
  if (selectable) {
    return (
      <label className="block min-w-0 cursor-pointer transition-opacity hover:opacity-80" htmlFor={checkboxId}>
        {tile}
      </label>
    );
  }
  return LinkComponent ? (
    <LinkComponent className="block min-w-0 transition-opacity hover:opacity-80" entry={entry}>
      {tile}
    </LinkComponent>
  ) : (
    <div className="min-w-0">{tile}</div>
  );
}
