import type { LibraryEntryDto } from "@mdcz/shared/serverDtos";
import { LibraryIndexView } from "@mdcz/views/library";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

const createEntry = (id: string, available: boolean | null): LibraryEntryDto => ({
  actors: [],
  assets: [],
  available,
  crawlerData: null,
  createdAt: "2026-08-17T00:00:00.000Z",
  directory: "movies",
  fileName: `${id}.mp4`,
  fileRefs: [],
  hiddenFromRecentAt: null,
  id,
  lastKnownPath: null,
  lastRefreshedAt: null,
  mediaIdentity: id,
  modifiedAt: null,
  number: id,
  relativePath: `movies/${id}.mp4`,
  rootDisplayName: "Media",
  rootId: "root-1",
  scrapeOutputId: null,
  size: 10,
  taskId: null,
  thumbnailPath: null,
  title: `${id} title`,
});

const baseProps = {
  entries: [createEntry("AVAILABLE", true), createEntry("UNKNOWN", null), createEntry("UNAVAILABLE", false)],
  onAvailabilityFilterChange: vi.fn(),
  onQueryChange: vi.fn(),
  onRefresh: vi.fn(),
  query: "",
  total: 3,
};

test("available filtering excludes entries whose availability has not loaded", async () => {
  const screen = await render(<LibraryIndexView {...baseProps} availabilityFilter="available" />);

  await expect.element(screen.getByText("AVAILABLE title")).toBeVisible();
  await expect.element(screen.getByText("UNKNOWN title")).not.toBeInTheDocument();
  await expect.element(screen.getByText("UNAVAILABLE title")).not.toBeInTheDocument();
});

test("load more remains an explicit bounded action", async () => {
  const onLoadMore = vi.fn();
  const screen = await render(
    <LibraryIndexView {...baseProps} availabilityFilter="all" hasMore onLoadMore={onLoadMore} />,
  );

  await screen.getByRole("button", { name: "加载更多" }).click();
  expect(onLoadMore).toHaveBeenCalledOnce();
});
