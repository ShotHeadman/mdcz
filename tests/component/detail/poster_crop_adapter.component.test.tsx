import { resolvePosterEditorCropRegion } from "@mdcz/shared/posterCrop";
import { Toaster } from "@mdcz/ui";
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
  artworkRevision: "run-1",
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

test("the editor keeps failed saves open and closes when the selected movie stops being editable", async () => {
  const savePosterCrop = vi.fn().mockRejectedValue(new Error("disk full"));
  const port = createPort({ savePosterCrop });
  const screen = await render(<DetailPanelAdapter port={port} item={item} />);
  await screen.getByRole("button", { name: "编辑封面" }).click();
  await screen.getByRole("button", { name: "保存封面" }).click();

  await expect.element(screen.getByRole("dialog", { name: "编辑封面" })).toBeVisible();
  expect(savePosterCrop).toHaveBeenCalledOnce();
  await screen.rerender(<DetailPanelAdapter port={port} item={{ ...item, status: "processing" }} />);
  await expect.element(screen.getByRole("dialog", { name: "编辑封面" })).not.toBeInTheDocument();
  await screen.rerender(<DetailPanelAdapter port={port} item={item} />);
  await expect.element(screen.getByRole("button", { name: "编辑封面" })).toBeEnabled();
  await expect.element(screen.getByRole("dialog", { name: "编辑封面" })).not.toBeInTheDocument();
});

test("the crop editor ignores stale requests and uses the saved poster only for the current result", async () => {
  const other = {
    ...item,
    id: "root-1:ABC-002.mp4",
    number: "ABC-002",
    path: "ABC-002.mp4",
    fileRef: { rootId: "root-1", relativePath: "ABC-002.mp4" },
    thumbUrl: sourceUrl,
  };
  let rejectPending!: (error: Error) => void;
  const pending = new Promise<typeof session>((_, reject) => {
    rejectPending = reject;
  });
  const preparePosterCrop = vi
    .fn()
    .mockReturnValueOnce(pending)
    .mockRejectedValueOnce(new Error("no local image"))
    .mockResolvedValue(session);
  const port = createPort({ preparePosterCrop });
  const panel = (selected: typeof item) => (
    <>
      <DetailPanelAdapter port={port} item={selected} />
      <Toaster />
    </>
  );
  const screen = await render(panel(item));
  await expect.element(screen.getByAltText("ABC-001")).toBeVisible();
  expect(preparePosterCrop).not.toHaveBeenCalled();

  const edit = screen.getByRole("button", { name: "编辑封面" });
  await edit.click();
  await expect.element(edit).toBeDisabled();
  await screen.rerender(panel(other));
  const poster = screen.getByAltText("ABC-002", { exact: true });
  const thumb = screen.getByAltText("ABC-002 缩略图", { exact: true });
  await expect.element(poster).toBeVisible();
  expect(preparePosterCrop.mock.calls).toEqual([[item]]);

  await edit.click();
  await expect.element(edit).toBeEnabled();
  await expect.element(screen.getByRole("dialog", { name: "编辑封面" })).not.toBeInTheDocument();
  const currentError = screen.getByText("无法打开封面编辑器：no local image");
  await expect.element(currentError).toBeVisible();
  rejectPending(new Error("stale crop request"));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await expect.element(currentError).toBeVisible();
  await expect.element(screen.getByText(/stale crop request/u)).not.toBeInTheDocument();

  await edit.click();
  await screen.getByRole("button", { name: "保存封面" }).click();
  await expect.element(screen.getByRole("dialog", { name: "编辑封面" })).not.toBeInTheDocument();
  await expect.element(poster).toHaveAttribute("src", `${sourceUrl}#revision`);
  await expect.element(thumb).toBeVisible();
  poster.element().dispatchEvent(new Event("error"));
  await expect.element(poster).toHaveAttribute("src", sourceUrl);
  await expect.element(thumb).not.toBeInTheDocument();

  await edit.click();
  await screen.getByRole("button", { name: "保存封面" }).click();
  await expect.element(poster).toHaveAttribute("src", `${sourceUrl}#revision`);
  await screen.rerender(panel({ ...other, artworkRevision: "run-2" }));
  await expect.element(poster).toHaveAttribute("src", sourceUrl);
  expect(preparePosterCrop.mock.calls).toEqual([[item], [other], [other], [other]]);
});
