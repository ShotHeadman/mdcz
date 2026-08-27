import { normalizeRootRelativePath, type RootFileRef } from "@mdcz/shared/mediaRef";

export class MediaPathOwnership {
  readonly #owners = new Set<string>();

  acquire(rootId: string, relativePath: string): () => void {
    return this.acquireAll([{ rootId, relativePath }]);
  }

  acquireAll(refs: readonly RootFileRef[]): () => void {
    const keys = refs
      .map(({ rootId, relativePath }) => {
        if (!rootId.trim()) throw new Error("Media root ID is required");
        return `${rootId}\0${normalizeRootRelativePath(relativePath)}`;
      })
      .sort();
    if (new Set(keys).size !== keys.length) throw new Error("Duplicate media path ownership request");
    const occupied = keys.find((key) => this.#owners.has(key));
    if (occupied) {
      const [rootId, relativePath] = occupied.split("\0");
      throw new Error(`Media path is already being modified: ${rootId}:${relativePath}`);
    }
    for (const key of keys) this.#owners.add(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const key of keys) this.#owners.delete(key);
    };
  }
}

export const mediaPathOwnership = new MediaPathOwnership();
