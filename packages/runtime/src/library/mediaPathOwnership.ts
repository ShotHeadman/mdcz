import { normalizeRootRelativePath, type RootFileRef } from "@mdcz/shared/mediaRef";

export class MediaPathOwnership {
  readonly #owners = new Map<string, { owner: string | symbol; count: number }>();

  acquire(rootId: string, relativePath: string, owner?: string | symbol): () => void {
    return this.acquireAll([{ rootId, relativePath }], owner);
  }

  acquireAll(refs: readonly RootFileRef[], owner: string | symbol = Symbol("media-path-owner")): () => void {
    const keys = refs
      .map(({ rootId, relativePath }) => {
        if (!rootId.trim()) throw new Error("Media root ID is required");
        return `${rootId}\0${normalizeRootRelativePath(relativePath)}`;
      })
      .sort();
    if (new Set(keys).size !== keys.length) throw new Error("Duplicate media path ownership request");
    const occupied = keys.find((key) => {
      const current = this.#owners.get(key);
      return current && current.owner !== owner;
    });
    if (occupied) {
      const [rootId, relativePath] = occupied.split("\0");
      throw new Error(`Media path is already being modified: ${rootId}:${relativePath}`);
    }
    for (const key of keys) {
      const current = this.#owners.get(key);
      this.#owners.set(key, { owner, count: (current?.count ?? 0) + 1 });
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const key of keys) {
        const current = this.#owners.get(key);
        if (!current || current.owner !== owner) continue;
        if (current.count === 1) this.#owners.delete(key);
        else this.#owners.set(key, { owner, count: current.count - 1 });
      }
    };
  }
}

export const mediaPathOwnership = new MediaPathOwnership();
