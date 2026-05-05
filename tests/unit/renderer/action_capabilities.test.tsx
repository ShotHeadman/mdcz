import { type DetailActionPort, DetailPanelAdapter } from "@mdcz/shared/adapters";
import { DetailPanelView } from "@mdcz/views/detail";
import { createEmptyEditableNfoData } from "@mdcz/views/nfo";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const baseItem = {
  id: "root-1:ABC-001.mp4",
  status: "success" as const,
  number: "ABC-001",
  title: "ABC-001",
  path: "ABC-001.mp4",
  actors: [],
  genres: [],
  sceneImages: [],
};

const nfo = {
  open: false,
  data: createEmptyEditableNfoData(),
  dirty: false,
  errors: {},
  loading: false,
  saving: false,
  onOpenChange: vi.fn(),
  onDataChange: vi.fn(),
  onSave: vi.fn(),
};

describe("action capability rendering", () => {
  it("hides unsupported detail actions instead of rendering inert buttons", () => {
    const html = renderToStaticMarkup(<DetailPanelView item={baseItem} nfo={nfo} onOpenNfo={() => undefined} />);

    expect(html).not.toContain("播放");
    expect(html).not.toContain("打开文件夹");
    expect(html).toContain("编辑 NFO");
  });

  it("passes hidden Web capabilities through the shared detail adapter", () => {
    const port: DetailActionPort = {
      capabilities: {
        play: "hidden",
        openFolder: "hidden",
        openNfo: "enabled",
      },
      play: vi.fn(),
      openFolder: vi.fn(),
      readNfo: vi.fn(async () => ({ path: "ABC-001.nfo", crawlerData: null })),
      writeNfo: vi.fn(),
    };

    const html = renderToStaticMarkup(<DetailPanelAdapter port={port} item={baseItem} />);

    expect(html).not.toContain("播放");
    expect(html).not.toContain("打开文件夹");
    expect(html).toContain("编辑 NFO");
  });
});
