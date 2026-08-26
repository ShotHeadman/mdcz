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
  posterUrl: sourceUrl,
  status: "success" as const,
};

const createPort = (overrides: Partial<DetailActionPort> = {}): DetailActionPort => ({
  capabilities: { editPoster: "enabled", openFolder: "hidden", openNfo: "hidden", play: "hidden" },
  showFilePath: false,
  resolveImageCandidates: async (candidates) => candidates,
  play: () => undefined,
  openFolder: () => undefined,
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

test("detail poster editor hides remote-only failures and refreshes a successful save", async () => {
  const unavailable = await render(
    <DetailPanelAdapter
      port={createPort({ preparePosterCrop: async () => await Promise.reject(new Error("no local image")) })}
      item={item}
    />,
  );
  await expect.element(unavailable.getByRole("button", { name: "编辑封面" })).not.toBeInTheDocument();
  unavailable.unmount();

  const screen = await render(<DetailPanelAdapter port={createPort()} item={item} />);
  await screen.getByRole("button", { name: "编辑封面" }).click();
  await screen.getByRole("button", { name: "保存封面" }).click();
  await expect.element(screen.getByRole("dialog", { name: "编辑封面" })).not.toBeInTheDocument();
  await expect.element(screen.getByAltText("ABC-001")).toHaveAttribute("src", `${sourceUrl}#revision`);
});
