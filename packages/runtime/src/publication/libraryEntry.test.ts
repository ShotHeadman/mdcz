import { describe, expect, it } from "vitest";
import { libraryEntryFromPublicationPlan } from "./libraryEntry";
import type { PublicationPlan } from "./types";

const plan = (assets: PublicationPlan["assets"]): PublicationPlan => ({
  operationId: "run:attempt",
  operationType: "scrape",
  video: {
    source: { rootId: "input", relativePath: "ABC-001.mp4" },
    target: { rootId: "output", relativePath: "ABC-001/ABC-001.mp4" },
    size: 12,
  },
  artifacts: [],
  assets,
  obsolete: [],
});

describe("libraryEntryFromPublicationPlan", () => {
  it("maps local poster/thumb paths and remote asset urls the way both hosts did", () => {
    expect(
      libraryEntryFromPublicationPlan(
        plan([
          { type: "local", kind: "poster", file: { rootId: "output", relativePath: "ABC-001/poster.jpg" } },
          { type: "local", kind: "thumb", file: { rootId: "output", relativePath: "ABC-001/thumb.jpg" } },
          { type: "remote", kind: "trailer", url: "https://cdn.example/trailer.mp4" },
        ]),
        { title: "Movie", number: "ABC-001", actors: ["Actor A"] },
        { rootId: "output", relativePath: "ABC-001/ABC-001.mp4" },
      ),
    ).toEqual({
      mediaIdentity: "ABC-001",
      rootId: "output",
      rootRelativePath: "ABC-001/ABC-001.mp4",
      title: "Movie",
      number: "ABC-001",
      actors: ["Actor A"],
      thumbnailPath: "ABC-001/poster.jpg",
      lastKnownPath: "ABC-001/ABC-001.mp4",
      assets: [
        { kind: "poster", uri: "ABC-001/poster.jpg", rootId: "output", relativePath: "ABC-001/poster.jpg" },
        { kind: "thumb", uri: "ABC-001/thumb.jpg", rootId: "output", relativePath: "ABC-001/thumb.jpg" },
        { kind: "trailer", uri: "https://cdn.example/trailer.mp4" },
      ],
    });
  });

  it("uses a remote thumbnail when no local poster or thumb exists", () => {
    expect(
      libraryEntryFromPublicationPlan(
        plan([{ type: "remote", kind: "poster", url: "https://cdn.example/poster.jpg" }]),
        { title: "Movie", number: "ABC-001", actors: [] },
        { rootId: "output", relativePath: "ABC-001.mp4" },
      ).thumbnailPath,
    ).toBe("https://cdn.example/poster.jpg");
  });
});
