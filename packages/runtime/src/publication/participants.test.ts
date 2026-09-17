import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { describe, expect, it } from "vitest";
import { resolvePublicationParticipants } from "./participants";

const root = { id: "root", hostPath: tmpdir() };
const resolveRoot = async () => root;
const ref = (relativePath: string): RootFileRef => ({ rootId: root.id, relativePath });

describe("resolvePublicationParticipants", () => {
  it("retains preferred IDs while a new member remains unowned", async () => {
    const source = ref(`${randomUUID()}/ABC-123.mp4`);
    const participants = await resolvePublicationParticipants({
      members: [{ source, fileId: "file-new" }],
      movieId: "movie-new",
      snapshot: { files: [], assets: [] },
      resolveRoot,
    });

    expect(participants).toMatchObject({
      movieId: "movie-new",
      members: [{ source, fileId: "file-new" }],
    });
  });

  it("recognizes a matching movie from generated-output ownership", async () => {
    const directory = randomUUID();
    const source = ref(`${directory}/incoming/ABC-123.mp4`);
    const output = ref(`${directory}/library/ABC-123/poster.jpg`);
    const participants = await resolvePublicationParticipants({
      members: [{ source }],
      outputs: [output],
      identity: "ABC-123",
      snapshot: {
        files: [
          {
            ...ref(`${directory}/library/ABC-123/ABC-123.mp4`),
            itemId: "movie-existing",
            fileId: "file-existing",
            mediaIdentity: "ABC-123",
          },
        ],
        assets: [
          {
            ...output,
            itemId: "movie-existing",
            fileId: null,
            kind: "poster",
            published: true,
            historical: false,
          },
        ],
      },
      resolveRoot,
    });

    expect(participants.movieId).toBe("movie-existing");
  });

  it("rejects generated output owned by a different media identity", async () => {
    const directory = randomUUID();
    const source = ref(`${directory}/incoming/ABC-123.mp4`);
    const output = ref(`${directory}/library/ABC-123/poster.jpg`);

    await expect(
      resolvePublicationParticipants({
        members: [{ source }],
        outputs: [output],
        identity: "ABC-123",
        snapshot: {
          files: [
            {
              ...ref(`${directory}/library/XYZ-999/XYZ-999.mp4`),
              itemId: "movie-other",
              fileId: "file-other",
              mediaIdentity: "XYZ-999",
            },
          ],
          assets: [
            {
              ...output,
              itemId: "movie-other",
              fileId: null,
              kind: "poster",
              published: true,
              historical: false,
            },
          ],
        },
        resolveRoot,
      }),
    ).rejects.toThrow("生成输出已属于媒体标识不同的影片");
  });

  it("rejects generated video output occupied by another movie", async () => {
    const directory = randomUUID();
    const source = ref(`${directory}/incoming/ABC-123.mp4`);
    const output = ref(`${directory}/library/XYZ-999/XYZ-999.mp4`);

    await expect(
      resolvePublicationParticipants({
        members: [{ source }],
        outputs: [output],
        identity: "ABC-123",
        snapshot: {
          files: [
            {
              ...output,
              itemId: "movie-other",
              fileId: "file-other",
              mediaIdentity: "XYZ-999",
            },
          ],
          assets: [],
        },
        resolveRoot,
      }),
    ).rejects.toThrow("生成输出已属于媒体标识不同的影片");
  });
});
