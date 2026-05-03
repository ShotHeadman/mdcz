import { toErrorMessage } from "@mdcz/shared/error";
import { LibraryIndexView } from "@mdcz/views/library";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";
import { api } from "../client";
import { AppLink } from "../routeCommon";

export function LibraryPage() {
  const [query, setQuery] = useState("");
  const [rootId, setRootId] = useState("");
  const rootsQ = useQuery({ queryKey: ["mediaRoots"], queryFn: () => api.mediaRoots.list(), retry: false });
  const libraryQ = useQuery({
    queryKey: ["library", "search", query, rootId],
    queryFn: () => api.library.search({ query, rootId: rootId || undefined, limit: 300 }),
    retry: false,
  });

  return (
    <LibraryIndexView
      entries={libraryQ.data?.entries ?? []}
      errorMessage={libraryQ.error ? toErrorMessage(libraryQ.error) : null}
      isLoading={libraryQ.isLoading || rootsQ.isLoading}
      linkComponent={LibraryEntryLink}
      onQueryChange={setQuery}
      onRefresh={() => void libraryQ.refetch()}
      onRootChange={setRootId}
      query={query}
      rootId={rootId}
      roots={rootsQ.data?.roots ?? []}
      total={libraryQ.data?.total ?? 0}
    />
  );
}

export const Route = createFileRoute("/library")({
  component: LibraryPage,
});

function LibraryEntryLink({
  children,
  className,
  entry,
}: {
  children: ReactNode;
  className?: string;
  entry: { scrapeOutputId: string | null };
}) {
  if (!entry.scrapeOutputId) {
    return null;
  }

  return (
    <AppLink className={className} to={`/scrape/${encodeURIComponent(entry.scrapeOutputId)}`}>
      {children}
    </AppLink>
  );
}
