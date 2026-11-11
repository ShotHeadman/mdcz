export type LibraryTaskKind = "scrape" | "maintenance" | "edit";

const CONFLICT_MESSAGES: Record<LibraryTaskKind, string> = {
  edit: "A library edit is running; wait for it to finish before starting another library task",
  maintenance: "A maintenance task is running; finish or stop it before starting another library task",
  scrape: "A scrape task is running; finish or stop it before starting another library task",
};

export class LibraryTaskConflictError extends Error {
  constructor(readonly running: LibraryTaskKind) {
    super(CONFLICT_MESSAGES[running]);
    this.name = "LibraryTaskConflictError";
  }
}

/**
 * Library writers share records across folders, so directory locks alone cannot serialize different task kinds.
 */
export class LibraryTaskGate {
  readonly #busy = new Map<LibraryTaskKind, () => boolean>();

  track(kind: LibraryTaskKind, busy: () => boolean): void {
    this.#busy.set(kind, busy);
  }

  /** Call in the same synchronous step that registers the task, so a concurrent start of the other kind cannot slip in. */
  assertAvailable(kind: LibraryTaskKind): void {
    for (const [holder, busy] of this.#busy) if (holder !== kind && busy()) throw new LibraryTaskConflictError(holder);
  }
}
