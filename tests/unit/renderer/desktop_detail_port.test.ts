import type { DetailViewItem } from "@mdcz/views/detail";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { exists, showItemInFolder } = vi.hoisted(() => ({
  exists: vi.fn(async () => ({ exists: true, url: "local-file://resolved/image.jpg" })),
  showItemInFolder: vi.fn(async () => ({ success: true as const })),
}));

vi.mock("@/client/ipc", () => ({
  ipc: {
    app: { showItemInFolder },
    file: { exists },
  },
}));

import { createDesktopDetailPort, resolveDesktopImageCandidates } from "@/adapters/ports";

const item: DetailViewItem = {
  id: "source:ABC-123.mp4",
  status: "success",
  number: "ABC-123",
  path: "organized/ABC-123/ABC-123.mp4",
  fileRef: { rootId: "output", relativePath: "organized/ABC-123/ABC-123.mp4" },
  assets: [{ type: "local", kind: "poster", file: { rootId: "metadata", relativePath: "art/poster.jpg" } }],
};

describe("desktop detail image resolution", () => {
  beforeEach(() => {
    exists.mockClear();
    showItemInFolder.mockClear();
  });

  it("uses the asset's own root for an explicit local asset", async () => {
    await expect(resolveDesktopImageCandidates(["art/poster.jpg"], "organized/ABC-123", item)).resolves.toEqual([
      "local-file://resolved/image.jpg",
    ]);
    expect(exists).toHaveBeenCalledWith({ rootId: "metadata", relativePath: "art/poster.jpg" });
  });

  it("uses the output file root for generated sibling candidates", async () => {
    await resolveDesktopImageCandidates(["poster.jpg"], "organized/ABC-123", item);
    expect(exists).toHaveBeenCalledWith({ rootId: "output", relativePath: "organized/ABC-123/poster.jpg" });
  });

  it("opens the folder through the root-scoped video reference", async () => {
    const { openFolder } = createDesktopDetailPort();
    expect(openFolder).toEqual(expect.any(Function));
    await openFolder?.(item);
    expect(showItemInFolder).toHaveBeenCalledWith(item.fileRef);
  });
});
