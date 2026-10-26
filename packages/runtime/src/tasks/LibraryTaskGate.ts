export type LibraryTaskKind = "scrape" | "maintenance";

const CONFLICT_MESSAGES: Record<LibraryTaskKind, string> = {
  maintenance: "A maintenance task is running; stop it before starting a scrape",
  scrape: "A scrape task is running; stop it before starting maintenance",
};

export class LibraryTaskConflictError extends Error {
  constructor(readonly running: LibraryTaskKind) {
    super(CONFLICT_MESSAGES[running]);
    this.name = "LibraryTaskConflictError";
  }
}

/**
 * Scrapes and maintenance both move source files and rewrite library records, and the output directory mutex only
 * serializes writes into the same folder, so one kind of task never starts while the other is live.
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
