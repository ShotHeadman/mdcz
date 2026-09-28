import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assignVersionLabels, type VersionCandidate, versionKey } from "./versionLabels";

const source = join("/downloads");
const target = join("/library", "ABC-123");
const candidate = (name: string, overrides: Partial<VersionCandidate> = {}): VersionCandidate => ({
  sourcePath: join(source, name),
  targetVideoPath: join(target, "ABC-123.mp4"),
  multipart: false,
  size: 1,
  ...overrides,
});

describe("assignVersionLabels", () => {
  it.each([
    {
      name: "keeps the highest probed resolution unlabeled",
      candidates: [candidate("a.mp4", { height: 1080 }), candidate("b.mp4", { height: 2160 })],
      expected: ["1080p", undefined],
    },
    {
      name: "prefers probed height over the filename token",
      candidates: [
        candidate("ABC-123-4K.mp4", { height: 1080, filenameResolution: "4K" }),
        candidate("b.mp4", { height: 2160 }),
      ],
      expected: ["1080p", undefined],
    },
    {
      name: "never renames the version already in place",
      candidates: [
        candidate("in-place", { sourcePath: join(target, "ABC-123.mp4"), height: 1080 }),
        candidate("b.mp4", { height: 2160 }),
      ],
      expected: [undefined, "2160p"],
    },
    {
      name: "leaves the only unknown resolution unlabeled",
      candidates: [candidate("ABC-123.mp4"), candidate("ABC-123-4K.mp4", { filenameResolution: "4K" })],
      expected: [undefined, "2160p"],
    },
    {
      name: "labels every new file next to an existing library version",
      candidates: [candidate("ABC-123 - 800p.mp4", { filenameResolution: "800P" })],
      occupied: true,
      expected: ["800p"],
    },
    {
      name: "leaves indistinguishable versions for the pre-run refusal",
      candidates: [candidate("a.mp4"), candidate("b.mkv", { targetVideoPath: join(target, "ABC-123.mkv") })],
      expected: [undefined, undefined],
    },
    {
      name: "does not label multipart files",
      candidates: [
        candidate("a-cd1.mp4", { multipart: true, height: 1080 }),
        candidate("b-cd1.mp4", { multipart: true, height: 2160 }),
      ],
      expected: [undefined, undefined],
    },
  ])("$name", ({ candidates, occupied, expected }) => {
    const occupiedKeys = new Set(occupied ? [versionKey(join(target, "ABC-123.mp4"))] : []);
    expect(assignVersionLabels(candidates, occupiedKeys)).toEqual(expected);
  });
});
