import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { toLocalFileUrl } from "@mdcz/shared/mediaRef";
import { afterEach, describe, expect, it } from "vitest";
import { LocalFileProtocolError, localFileUrlForHostPath, resolveLocalFileRequest } from "./localFileProtocol";

const directories: string[] = [];

const createTempDir = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "mdcz-local-file-"));
  directories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })),
  );
});

describe("resolveLocalFileRequest", () => {
  it("resolves a valid in-root file", async () => {
    const root = await createTempDir();
    const filePath = join(root, "poster.jpg");
    await writeFile(filePath, "image");
    const url = toLocalFileUrl({ rootId: "root-1", relativePath: "poster.jpg" });

    await expect(resolveLocalFileRequest(url, async () => ({ id: "root-1", hostPath: root }))).resolves.toBe(filePath);
  });

  it("rejects a path outside every registered root", async () => {
    const url = toLocalFileUrl({ rootId: "missing", relativePath: "poster.jpg" });
    await expect(resolveLocalFileRequest(url, async () => null)).rejects.toThrow(LocalFileProtocolError);
  });

  it("rejects a .. traversal inside a relative path", async () => {
    await expect(
      resolveLocalFileRequest("local-file://root-1/foo/%2e%2e/%2e%2e/secret.txt", async () => ({
        id: "root-1",
        hostPath: "/tmp",
      })),
    ).rejects.toThrow("Invalid media relative path");
  });

  it("rejects a directory request", async () => {
    const root = await createTempDir();
    await mkdir(join(root, "folder"));
    const url = toLocalFileUrl({ rootId: "root-1", relativePath: "folder" });
    await expect(resolveLocalFileRequest(url, async () => ({ id: "root-1", hostPath: root }))).rejects.toThrow(
      LocalFileProtocolError,
    );
  });

  it("rejects a symlink pointing outside its root after resolution", async () => {
    const parent = await createTempDir();
    const root = join(parent, "root");
    const outside = join(parent, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, "secret.jpg"), "secret");
    await symlink(outside, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
    const url = toLocalFileUrl({ rootId: "root-1", relativePath: "link/secret.jpg" });
    await expect(resolveLocalFileRequest(url, async () => ({ id: "root-1", hostPath: root }))).rejects.toThrow(
      LocalFileProtocolError,
    );
  });

  it("builds a root-scoped URL for an in-root host path", async () => {
    const root = await createTempDir();
    const filePath = join(root, "thumb.jpg");
    await writeFile(filePath, "image");
    expect(localFileUrlForHostPath(filePath, [{ id: "root-1", hostPath: root }])).toBe(
      toLocalFileUrl({ rootId: "root-1", relativePath: "thumb.jpg" }),
    );
    expect(
      localFileUrlForHostPath(join(dirname(root), "other.jpg"), [{ id: "root-1", hostPath: root }]),
    ).toBeUndefined();
  });
});
