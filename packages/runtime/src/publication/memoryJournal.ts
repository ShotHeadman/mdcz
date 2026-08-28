import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { PublicationJournalPort, PublicationJournalRecord } from "./types";

const refsInManifest = (manifest: unknown): RootFileRef[] => {
  const refs: RootFileRef[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.rootId === "string" && typeof record.relativePath === "string") {
      refs.push({ rootId: record.rootId, relativePath: record.relativePath });
    }
    for (const item of Object.values(record)) visit(item);
  };
  visit(manifest);
  return refs;
};

export const createMemoryPublicationJournal = (): PublicationJournalPort => {
  const entries = new Map<string, PublicationJournalRecord>();
  return {
    begin(entry) {
      if (entries.has(entry.operationId)) throw new Error(`Publication journal already exists: ${entry.operationId}`);
      entries.set(entry.operationId, { ...entry, state: "pending" });
    },
    commit(operationId, write) {
      const entry = entries.get(operationId);
      if (entry?.state !== "pending") throw new Error(`Publication journal operation is not pending: ${operationId}`);
      const result = write();
      entry.state = "committed";
      return result;
    },
    finish(operationId) {
      entries.delete(operationId);
    },
    listUnfinished() {
      return [...entries.values()];
    },
    conflicts(refs) {
      const requested = new Set(refs.map((ref) => `${ref.rootId}\0${ref.relativePath}`));
      return (
        [...entries.values()].find((entry) =>
          refsInManifest(entry.manifest).some((ref) => requested.has(`${ref.rootId}\0${ref.relativePath}`)),
        ) ?? null
      );
    },
  };
};
