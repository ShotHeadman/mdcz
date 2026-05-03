import type { LibraryEntryDto } from "@mdcz/shared";
import { toErrorMessage } from "@mdcz/shared/error";
import type { OverviewRecentAcquisitionItem } from "@mdcz/shared/ipc-contracts/overviewContract";
import { LibraryIndexView } from "@mdcz/views/library";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useRecentAcquisitions } from "@/hooks/useOverview";

export function LibraryPage() {
  const [query, setQuery] = useState("");
  const recentQ = useRecentAcquisitions();
  const entries = useMemo(
    () => toLibraryEntries(recentQ.data?.items ?? []).filter((entry) => matchesQuery(entry, query)),
    [query, recentQ.data?.items],
  );

  return (
    <LibraryIndexView
      entries={entries}
      errorMessage={recentQ.error ? toErrorMessage(recentQ.error) : null}
      isLoading={recentQ.isLoading}
      onQueryChange={setQuery}
      onRefresh={() => void recentQ.refetch()}
      onRootChange={() => undefined}
      query={query}
      rootId=""
      roots={[]}
      total={entries.length}
    />
  );
}

export const Route = createFileRoute("/library")({
  component: LibraryPage,
});

function toLibraryEntries(items: OverviewRecentAcquisitionItem[]): LibraryEntryDto[] {
  return items.map((item) => {
    const fileName = getFileName(item.lastKnownPath);
    return {
      id: item.number,
      mediaIdentity: item.number,
      rootId: "desktop-output",
      rootDisplayName: "输出目录",
      relativePath: item.lastKnownPath ?? "",
      fileName,
      directory: getDirectory(item.lastKnownPath),
      size: 0,
      modifiedAt: null,
      taskId: null,
      scrapeOutputId: null,
      title: item.title,
      number: item.number,
      actors: item.actors,
      crawlerData: null,
      thumbnailPath: item.thumbnailPath,
      lastKnownPath: item.lastKnownPath,
      indexedAt: new Date(item.completedAt).toISOString(),
      lastRefreshedAt: null,
      available: item.lastKnownPath ? null : false,
      fileRefs: [],
      assets: [],
    };
  });
}

function matchesQuery(entry: LibraryEntryDto, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return [entry.title, entry.number, entry.fileName, entry.directory, ...entry.actors]
    .filter(Boolean)
    .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
}

function getFileName(path: string | null): string {
  if (!path) return "";
  return path.split(/[\\/]/u).pop() ?? path;
}

function getDirectory(path: string | null): string {
  if (!path) return "";
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : "";
}
