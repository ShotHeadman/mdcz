import type { LibraryEntryDto } from "@mdcz/shared/serverDtos";
import { type LibraryBrowseControls, LibraryDeleteDialog, LibraryIndexView } from "@mdcz/views/library";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

const createEntry = (id: string, available: LibraryEntryDto["available"]): LibraryEntryDto => ({
  actors: [],
  assets: [],
  available,
  crawlerData: null,
  createdAt: "2026-08-17T00:00:00.000Z",
  displayFileId: `file-${id}`,
  fileRefs: [],
  hiddenFromRecentAt: null,
  id,
  lastRefreshedAt: null,
  mediaIdentity: id,
  number: id,
  size: 10,
  thumbnailPath: null,
  title: `${id} title`,
});

const baseProps = {
  entries: [
    createEntry("AVAILABLE", "available"),
    createEntry("UNKNOWN", "unchecked"),
    createEntry("UNAVAILABLE", "unavailable"),
  ],
  onAvailabilityFilterChange: vi.fn(),
  onDeleteEntries: vi.fn(),
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

test("batch removal acts on the selected movies the list still shows", async () => {
  const onDeleteEntries = vi.fn();
  const props = { ...baseProps, onDeleteEntries };
  const screen = await render(<LibraryIndexView {...props} availabilityFilter="all" />);
  const multiSelect = screen.getByRole("button", { name: "多选" });
  const selectAll = screen.getByRole("checkbox", { name: "全选已加载" });
  const selectAvailable = screen.getByRole("checkbox", { name: "选择 AVAILABLE" });
  const removeSelected = screen.getByRole("button", { name: "从媒体库移除", exact: true }).last();

  await expect.element(selectAvailable).not.toBeInTheDocument();
  await expect.element(selectAll).not.toBeInTheDocument();
  await multiSelect.click();
  await expect.element(screen.getByText(/^已选/u)).not.toBeInTheDocument();
  await selectAvailable.click();
  await screen.getByRole("checkbox", { name: "选择 UNKNOWN" }).click();
  await expect.element(selectAll).toHaveAttribute("data-state", "indeterminate");
  await expect.element(screen.getByText("已选 2 部影片")).toBeVisible();

  await screen.rerender(<LibraryIndexView {...props} availabilityFilter="available" />);
  await expect.element(screen.getByText("已选 1 部影片")).toBeVisible();
  await removeSelected.click();
  expect(onDeleteEntries).toHaveBeenLastCalledWith([expect.objectContaining({ id: "AVAILABLE" })]);

  await screen.rerender(<LibraryIndexView {...props} availabilityFilter="all" />);
  await selectAll.click();
  await expect.element(screen.getByText("已选 3 部影片")).toBeVisible();
  await removeSelected.click();
  expect(onDeleteEntries.mock.lastCall?.[0]).toHaveLength(3);

  await multiSelect.click();
  await expect.element(selectAvailable).not.toBeInTheDocument();
  await expect.element(screen.getByText(/^已选/u)).not.toBeInTheDocument();
  await multiSelect.click();
  await expect.element(selectAvailable).not.toBeChecked();
  await expect.element(screen.getByText(/^已选/u)).not.toBeInTheDocument();
});

test("a health filter offers to ignore its movies, and the ignored view only restores them", async () => {
  const browse = {
    libraries: [],
    summary: {
      total: 3,
      issues: { missingPoster: 0, missingBackdrop: 0, missingSynopsis: 3, noNfo: 0, duplicate: 3 },
      ignored: 1,
      facets: { actors: [], studios: [], tags: [] },
    },
    ignored: false,
    view: "list",
    onLibraryChange: vi.fn(),
    onHealthChange: vi.fn(),
    onIgnoredChange: vi.fn(),
    onFacetChange: vi.fn(),
    onClear: vi.fn(),
    onViewChange: vi.fn(),
    onFix: vi.fn(async () => undefined),
    onIgnore: vi.fn(async () => undefined),
    onRestore: vi.fn(async () => undefined),
  } satisfies LibraryBrowseControls;
  const view = (controls: Partial<LibraryBrowseControls>) => (
    <LibraryIndexView {...baseProps} availabilityFilter="all" browse={{ ...browse, ...controls }} />
  );
  const screen = await render(view({ health: "missingSynopsis" }));
  const refresh = screen.getByRole("button", { name: "从站点刷新 3 部" });
  const ignore = screen.getByRole("button", { name: "忽略这 3 部" });
  const restore = screen.getByRole("button", { name: "取消忽略 3 部" });

  await expect.element(refresh).toBeVisible();
  await ignore.click();
  expect(browse.onIgnore).toHaveBeenCalledWith("missingSynopsis");

  await screen.rerender(view({ health: "duplicate" }));
  await expect.element(refresh).not.toBeInTheDocument();
  await expect.element(ignore).toBeVisible();

  await screen.rerender(view({ ignored: true }));
  await expect.element(screen.getByRole("button", { name: /^已忽略\s*1$/u })).toHaveAttribute("aria-pressed", "true");
  await expect.element(ignore).not.toBeInTheDocument();
  await restore.click();
  expect(browse.onRestore).toHaveBeenCalledOnce();
});

test("the removal dialog totals the selection and says files stay on disk", async () => {
  const entry = { ...createEntry("ONE", "available"), fileRefs: [{}, {}], assets: [{}] } as unknown as LibraryEntryDto;
  const screen = await render(<LibraryDeleteDialog entries={[entry, entry]} onCancel={vi.fn()} onConfirm={vi.fn()} />);

  await expect
    .element(screen.getByText("将移除 2 部影片的 4 个视频文件记录和 2 个资源记录，磁盘上的文件不会被删除。"))
    .toBeVisible();
});
