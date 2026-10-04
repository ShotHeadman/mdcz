import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type MockDirentKind = "directory" | "file" | "symlink";

const createDirent = (name: string, kind: MockDirentKind) => ({
  name,
  isDirectory: () => kind === "directory",
  isFile: () => kind === "file",
  isSymbolicLink: () => kind === "symlink",
});

const createNodeError = (code: string): NodeJS.ErrnoException => {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
};

describe("recursive file walking", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("resolves unsupported native paths, skips missing children and rejects other I/O failures", async () => {
    vi.resetModules();
    const root = join("library");
    const missingAssetDir = join(root, "extrafanart");
    const videoPath = join(root, "ABC-123.mp4");
    let code = "ENOENT";
    let failRoot = false;
    let nativeError: NodeJS.ErrnoException | undefined = createNodeError("UNKNOWN");
    let callbackError: NodeJS.ErrnoException | null = null;
    const realpathCallback = vi.fn(
      (dirPath: string, callback: (error: NodeJS.ErrnoException | null, path: string) => void) => {
        callback(callbackError, resolve(dirPath));
      },
    );
    vi.doMock("node:fs", async () => ({
      ...(await vi.importActual<typeof import("node:fs")>("node:fs")),
      realpath: realpathCallback,
    }));
    vi.doMock("node:fs/promises", async () => ({
      ...(await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")),
      realpath: async (dirPath: string) => {
        if (dirPath === root && nativeError) throw nativeError;
        return resolve(dirPath);
      },
      readdir: async (dirPath: string) => {
        if (failRoot || dirPath === missingAssetDir) throw createNodeError(code);
        if (dirPath === root) return [createDirent("ABC-123.mp4", "file"), createDirent("extrafanart", "directory")];
        return [];
      },
    }));
    const fileUtils = await import("@mdcz/runtime/scrape/utils/filesystem");

    const warnings = { count: 0, paths: [] as string[] };
    await expect(fileUtils.listVideoFiles(root, true, undefined, undefined, [], { warnings })).resolves.toEqual([
      videoPath,
    ]);
    expect(warnings).toEqual({ count: 1, paths: [missingAssetDir] });
    expect(realpathCallback).toHaveBeenCalledExactlyOnceWith(root, expect.any(Function));
    nativeError = createNodeError("EIO");
    await expect(fileUtils.listVideoFiles(root, true)).rejects.toBe(nativeError);
    expect(realpathCallback).toHaveBeenCalledTimes(1);
    nativeError = createNodeError("UNKNOWN");
    callbackError = createNodeError("EACCES");
    await expect(fileUtils.listVideoFiles(root, true)).rejects.toBe(callbackError);
    nativeError = undefined;
    code = "EIO";
    await expect(fileUtils.listVideoFiles(root, true)).rejects.toMatchObject({ code });
    code = "ENOENT";
    failRoot = true;
    await expect(fileUtils.listVideoFiles(root, true)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    "runtime",
    "media-store",
  ])("bounds shared I/O and prunes depth, exclusions and non-video metadata in %s", async (backend) => {
    vi.resetModules();
    const rootPath = resolve("scan-fixture");
    const excluded = join(rootPath, "excluded");
    const missingOutput = join(rootPath, "JAV_output");
    const alias = join(rootPath, "alias");
    let active = 0;
    let maximum = 0;
    const calls: Array<[string, string]> = [];
    let blockReads = false;
    let releaseRead!: () => void;
    let readStarted!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const enteredRead = new Promise<void>((resolve) => {
      readStarted = resolve;
    });
    const io = async <T>(operation: string, path: string, value: T): Promise<T> => {
      calls.push([operation, path]);
      maximum = Math.max(maximum, ++active);
      if (blockReads && operation === "readdir") {
        readStarted();
        await readGate;
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return value;
    };
    vi.doMock("node:fs/promises", async () => ({
      ...(await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")),
      realpath: async (path: string) => {
        const key = await io("realpath", path, path === alias ? join(rootPath, "dir0") : path);
        if (path === excluded) throw createNodeError("EACCES");
        if (path === missingOutput) throw createNodeError("ENOENT");
        return key;
      },
      readdir: (path: string) =>
        io(
          "readdir",
          path,
          path === rootPath
            ? [
                createDirent("root.mp4", "file"),
                createDirent("notes.txt", "file"),
                createDirent("excluded", "directory"),
                createDirent("alias", "symlink"),
                ...Array.from({ length: 8 }, (_, i) => createDirent(`dir${i}`, "directory")),
              ]
            : [createDirent("movie.mp4", "file"), createDirent("poster.jpg", "file")],
        ),
      stat: (path: string) =>
        io("stat", path, {
          isFile: () => path !== alias,
          isDirectory: () => path === alias,
          size: 1,
          mtime: new Date(0),
        }),
    }));
    const runtime = await import("@mdcz/runtime/scrape/utils/filesystem");
    const storage = await import("@mdcz/media-store");
    const root = storage.createMediaRoot({ hostPath: rootPath, displayName: "scan" });
    const scan = async (recursive: boolean, signal?: AbortSignal) => {
      const warnings = { count: 0, paths: [] as string[] };
      if (backend === "media-store") {
        const files = await storage.listRootFiles(root, "", recursive, signal, {
          excludeDirectoryPaths: [excluded, missingOutput],
          filterFile: (path) => path.endsWith(".mp4"),
          warnings,
        });
        expect(warnings.count).toBe(recursive ? 1 : 0);
        return files;
      }
      const files: string[] = [];
      const onDiagnostic = vi.fn();
      const paths = await runtime.listVideoFiles(rootPath, recursive, undefined, signal, [excluded, missingOutput], {
        onFile: (path) => files.push(path),
        onDiagnostic,
        warnings,
      });
      expect(warnings.count).toBe(recursive ? 1 : 0);
      expect(paths).toEqual([]);
      expect(onDiagnostic).toHaveBeenCalledWith(expect.stringContaining(`"candidates":${files.length}`));
      return files;
    };
    expect(await scan(true)).toHaveLength(backend === "runtime" ? 9 : 10);
    expect(
      calls.filter(([op, path]) => op === "readdir" && [alias, join(rootPath, "dir0")].includes(path)),
    ).toHaveLength(backend === "runtime" ? 1 : 2);
    expect(maximum).toBe(4);
    expect(active).toBe(0);
    expect(calls.filter(([op]) => op === "stat")).toHaveLength(backend === "runtime" ? 10 : 11);
    expect(calls.filter(([op, path]) => op === "realpath" && path === rootPath)).toHaveLength(1);
    expect(calls.some(([op, path]) => op === "readdir" && path === excluded)).toBe(false);
    calls.length = 0;
    expect(await scan(false)).toHaveLength(1);
    expect(calls.filter(([op]) => op === "readdir")).toEqual([["readdir", rootPath]]);
    expect(calls.filter(([op]) => op === "realpath")).toEqual([["realpath", rootPath]]);
    const controller = new AbortController();
    const reason = new Error("stop scan");
    controller.abort(reason);
    if (backend === "runtime")
      await expect(scan(true, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    else await expect(scan(true, controller.signal)).rejects.toBe(reason);
    calls.length = 0;
    const cancelling = new AbortController();
    blockReads = true;
    const progress = vi.fn();
    const pending = storage.walkFiles(rootPath, true, cancelling.signal, {
      filterFile: (path) => path.endsWith(".mp4"),
      onProgress: progress,
    });
    await enteredRead;
    cancelling.abort(reason);
    expect(active).toBe(1);
    releaseRead();
    await expect(pending).rejects.toBe(reason);
    expect(active).toBe(0);
    expect(calls.filter(([operation]) => operation === "readdir")).toEqual([["readdir", rootPath]]);
    expect(progress).toHaveBeenCalled();
  });
});
