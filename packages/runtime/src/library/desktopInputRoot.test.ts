import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { deterministicMediaRootId, filesystemPathKey, findEnclosingMediaRoot } from "@mdcz/media-store";
import { defaultConfiguration } from "@mdcz/shared/config";
import { describe, expect, it } from "vitest";
import { createTempDirectory } from "../../../../tests/harness/tempDirectory";
import { MediaRootRepository } from "../../../persistence/src/mediaRootRepository";
import { createTestPersistenceDatabase } from "../../../persistence/src/testDatabase";
import { DirectoryInventory } from "../scrape/DirectoryInventory";
import { discoverDirectoryFiles } from "../scrape/directoryDiscovery";
import { resolveDesktopInputRootPath } from "./desktopInputRoot";
import { ConfiguredMediaRootService } from "./mediaRootService";

describe("desktop input root", () => {
  it("uses a containing preferred root or falls back to the common parent", () => {
    const base = path.resolve("media-root-test");
    const files = [path.join(base, "a", "one.mp4"), path.join(base, "b", "two.mp4")];
    expect(resolveDesktopInputRootPath(files, base)).toBe(base);
    expect(resolveDesktopInputRootPath(files, path.join(base, "a"))).toBe(base);
    expect(() => resolveDesktopInputRootPath([], base)).toThrow("Cannot create a scrape root without files");
  });

  it.each([
    "canonical",
    "alias",
  ])("admits %s selections with stable historical roots and entry identities", async (selection) => {
    const directory = await createTempDirectory("root-admission");
    const database = createTestPersistenceDatabase();
    const repository = new MediaRootRepository(database);
    const service = new ConfiguredMediaRootService({
      ensurePath: (hostPath, displayName) => repository.ensurePath(hostPath, displayName),
      list: () => repository.list(),
      get: (id) => repository.get(id),
    });
    try {
      const child = path.join(directory.path, "child");
      const alias = path.join(directory.path, "alias");
      const outside = path.join(directory.path, "outside");
      await mkdir(child);
      await mkdir(outside);
      await writeFile(path.join(child, "ABC-123.mp4"), "media");
      await writeFile(path.join(outside, "XYZ-456.mp4"), "external");
      const directoryLinkType = process.platform === "win32" ? "junction" : "dir";
      await symlink(child, alias, directoryLinkType);
      const admitted = await service.ensurePathRecord({ hostPath: selection === "alias" ? alias : child });
      await expect(service.ensurePathRecord({ hostPath: selection === "alias" ? child : alias })).resolves.toEqual(
        admitted,
      );
      const response = await service.ensurePath({ hostPath: alias });
      expect(response).toMatchObject({ id: admitted.id, relativeDirectory: "" });
      const parent = await service.ensurePathRecord({ hostPath: directory.path });
      expect(parent.id).not.toBe(admitted.id);
      expect(admitted.id).toBe(deterministicMediaRootId(path.join(admitted.hostPath, ".")));
      expect(findEnclosingMediaRoot(path.join(admitted.hostPath, "ABC-123.mp4"), [parent, admitted])).toEqual(admitted);
      expect(findEnclosingMediaRoot(path.join(parent.hostPath, "other.mp4"), [parent, admitted])).toEqual(parent);
      expect(
        findEnclosingMediaRoot(path.join(directory.path, "..", "unregistered.mp4"), [parent, admitted]),
      ).toBeUndefined();
      const refs = [
        { rootId: parent.id, relativePath: "child/ABC-123.mp4" },
        { rootId: admitted.id, relativePath: "ABC-123.mp4" },
      ];
      await expect(service.canonicalizeFileRefs(refs)).resolves.toEqual(refs);
      const inventory = new DirectoryInventory();
      const participants = await inventory.admitRefs(refs, (id) => service.get(id));
      expect(participants).toHaveLength(1);
      expect(
        inventory.submittedRefs.get(filesystemPathKey(path.join(await realpath(admitted.hostPath), "ABC-123.mp4"))),
      ).toEqual(refs);
      await symlink(outside, path.join(child, "external"), directoryLinkType);
      const discovery = await discoverDirectoryFiles({
        scope: { kind: "directory", scanDir: child, recursive: true, targetDir: child, excludeDirPaths: [] },
        configuration: defaultConfiguration,
        mediaRoots: service,
        generatedStrms: new Set(),
        signal: new AbortController().signal,
        platform: "desktop",
        onProgress: () => undefined,
      });
      expect(discovery.refs).toHaveLength(2);
      const entries = await inventory.admitRefs(discovery.refs, (id) => service.get(id));
      expect(entries).toHaveLength(2);
      if (process.platform !== "win32") {
        await symlink(path.join(outside, "XYZ-456.mp4"), path.join(child, "external-file.mp4"));
        const [link] = await inventory.admitRefs([{ rootId: admitted.id, relativePath: "external-file.mp4" }], (id) =>
          service.get(id),
        );
        expect(link.relativePath).toBe("external-file.mp4");
      }
      if (selection === "alias") {
        await rm(alias);
        await symlink(outside, alias, directoryLinkType);
        await expect(service.assertRootIntegrity([admitted.id])).rejects.toThrow("canonical path changed");
      }
    } finally {
      database.close();
      await directory.cleanup();
    }
  });
});
