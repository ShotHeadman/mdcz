export class MediaPathBusyError extends Error {
  constructor(readonly path: string) {
    super(`Media path is already being modified: ${path}`);
    this.name = "MediaPathBusyError";
  }
}

export class MediaPathOwnership {
  readonly #owners = new Map<string, { owner: string | symbol; count: number }>();

  acquire(path: string, owner?: string | symbol): () => void {
    return this.acquireAll([path], owner);
  }

  acquireAll(paths: readonly string[], owner: string | symbol = Symbol("media-path-owner")): () => void {
    const keys = [...new Set(paths)].sort();
    if (keys.some((key) => !key.trim())) throw new Error("Media path key is required");
    const occupied = keys.find((key) => {
      const current = this.#owners.get(key);
      return current && current.owner !== owner;
    });
    if (occupied) {
      throw new MediaPathBusyError(occupied);
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
