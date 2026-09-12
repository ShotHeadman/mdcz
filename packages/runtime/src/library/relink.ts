import { stat } from "node:fs/promises";
import { resolveRootRelativePath } from "@mdcz/media-store";
import { mediaPathOwnership } from "./mediaPathOwnership";

export const relinkLibraryFile = async <T>(input: {
  fileId: string;
  rootId: string;
  relativePath: string;
  root: { hostPath: string };
  files: readonly { rootId: string; rootRelativePath: string }[];
  relink(file: {
    fileId: string;
    rootId: string;
    rootRelativePath: string;
    size: number;
    modifiedAt: Date;
  }): Promise<T>;
}): Promise<T> => {
  const refs = [
    ...input.files.map((file) => ({ rootId: file.rootId, relativePath: file.rootRelativePath })),
    { rootId: input.rootId, relativePath: input.relativePath },
  ];
  const release = mediaPathOwnership.acquireAll([
    ...new Map(refs.map((ref) => [`${ref.rootId}:${ref.relativePath}`, ref])).values(),
  ]);
  try {
    const file = await stat(resolveRootRelativePath(input.root, input.relativePath));
    if (!file.isFile()) throw new Error("重定位目标不是文件");
    return await input.relink({
      fileId: input.fileId,
      rootId: input.rootId,
      rootRelativePath: input.relativePath,
      size: file.size,
      modifiedAt: file.mtime,
    });
  } finally {
    release();
  }
};
