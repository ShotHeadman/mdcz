import { resolvePosterEditorCropRegion } from "@mdcz/shared/posterCrop";
import { type DetailActionPort, DetailPanelAdapter } from "@mdcz/views/adapters";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

const sourceUrl =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500"><rect width="100%" height="100%" fill="#c84630"/></svg>',
  );
const session = { sourceUrl, width: 900, height: 500, initialCrop: resolvePosterEditorCropRegion(900, 500) };
const item = {
  id: "root-1:ABC-001.mp4",
  resultId: "result-1",
  number: "ABC-001",
  path: "ABC-001.mp4",
  fileRef: { rootId: "root-1", relativePath: "ABC-001.mp4" },
  posterUrl: sourceUrl,
  status: "success" as const,
};

const createPort = (overrides: Partial<DetailActionPort> = {}): DetailActionPort => ({
  showFilePath: false,
  resolveImageCandidates: async (candidates) => candidates,
  readNfo: async () => ({ path: "", crawlerData: null }),
  writeNfo: async () => undefined,
  preparePosterCrop: async () => session,
  savePosterCrop: async () => ({ posterUrl: `${sourceUrl}#revision` }),
  ...overrides,
});

test("detail poster editor keeps the dialog open after a failed save", async () => {
  const savePosterCrop = vi.fn().mockRejectedValue(new Error("disk full"));
  const screen = await render(<DetailPanelAdapter port={createPort({ savePosterCrop })} item={item} />);
  await screen.getByRole("button", { name: "编辑封面" }).click();
  await screen.getByRole("button", { name: "保存封面" }).click();

  await expect.element(screen.getByRole("dialog", { name: "编辑封面" })).toBeVisible();
  expect(savePosterCrop).toHaveBeenCalledOnce();
  await screen.getByRole("button", { name: "取消" }).click();
  await expect.element(screen.getByRole("dialog", { name: "编辑封面" })).not.toBeInTheDocument();
});

test("browsing results defers crop preparation until editing and a failed load can be retried", async () => {
  const other = {
    ...item,
    id: "root-1:ABC-002.mp4",
    number: "ABC-002",
    path: "ABC-002.mp4",
    fileRef: { rootId: "root-1", relativePath: "ABC-002.mp4" },
  };
  const preparePosterCrop = vi.fn().mockRejectedValueOnce(new Error("no local image")).mockResolvedValue(session);
  const port = createPort({ preparePosterCrop });
  const screen = await render(<DetailPanelAdapter port={port} item={item} />);
  await expect.element(screen.getByAltText("ABC-001")).toBeVisible();
  await screen.rerender(<DetailPanelAdapter port={port} item={other} />);
  await expect.element(screen.getByAltText("ABC-002")).toBeVisible();
  expect(preparePosterCrop).not.toHaveBeenCalled();

  const edit = screen.getByRole("button", { name: "编辑封面" });
  await edit.click();
  await expect.element(edit).toBeEnabled();
  await expect.element(screen.getByRole("dialog", { name: "编辑封面" })).not.toBeInTheDocument();

  await edit.click();
  await screen.getByRole("button", { name: "保存封面" }).click();
  await expect.element(screen.getByRole("dialog", { name: "编辑封面" })).not.toBeInTheDocument();
  await expect.element(screen.getByAltText("ABC-002")).toHaveAttribute("src", `${sourceUrl}#revision`);
  expect(preparePosterCrop.mock.calls).toEqual([[other], [other]]);
});
