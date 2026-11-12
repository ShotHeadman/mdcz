import type { BriefDrop, BriefParams, BriefPlan, BriefWorkflow, BriefWorkflowPlan } from "@mdcz/shared/briefCatalog";
import { type BriefSettingsChange, isSecretField, withoutSecretValues } from "@mdcz/shared/briefSettings";
import type { FieldKey } from "@mdcz/shared/settingsRegistry";
import { randomId } from "@mdcz/ui";
import { create } from "zustand";

export type BriefValues = Partial<BriefParams[BriefWorkflow]> & Record<string, unknown>;

/** What a confirmed cell follows on the server; a request is followed only while the page waits for its answer. */
export type BriefJob =
  | { kind: "scrape"; taskIds: string[] }
  | { kind: "maintenance"; sessionId: string }
  | { kind: "edit"; jobId: string }
  | { kind: "person-sync"; jobId: string }
  | { kind: "request" }
  | { kind: "instant" };

/** A field a finished change wrote, kept for Undo; a secret keeps no value. */
export interface BriefFieldRecord {
  key: string;
  before?: unknown;
  after?: unknown;
  secret?: true;
}

/** The last known state of a job, stored so a reload still shows it. */
export type BriefOutcome =
  | {
      kind: "scrape";
      paused: boolean;
      success: number;
      failed: number;
      skipped: number;
      completed: number;
      total: number | null;
    }
  | {
      kind: "maintenance";
      paused: boolean;
      phase: "preview" | "apply";
      changes: number;
      completed: number;
      total: number | null;
    }
  | {
      kind: "edit";
      current: number;
      total: number;
      changed: number;
      unchanged: number;
      skipped: number;
      failed: number;
    }
  | { kind: "pending"; action: "confirm" | "ignore"; count: number; choice?: string }
  | { kind: "settings"; fields: BriefFieldRecord[] }
  | {
      kind: "library";
      action: "create" | "update" | "ignoreHealth" | "restoreIgnored";
      name: string;
      libraryId?: string;
      count?: number;
      fields?: BriefFieldRecord[];
    }
  | { kind: "profile"; action: "switch" | "create"; name: string; previous: string }
  | { kind: "person-sync"; current: number; total: number; processed: number; failed: number; skipped: number }
  | { kind: "name-matching" }
  | { kind: "symlink"; total: number; linked: number; copied: number; skipped: number; failed: number }
  | { kind: "check"; target: string; passed: number; total: number; detail?: string }
  | { kind: "opened"; destination: string }
  | { kind: "unrecorded" }
  | { kind: "lost" };

export type BriefCellState =
  | "planning"
  | "unmatched"
  | "error"
  | "draft"
  | "running"
  | "review"
  | "done"
  | "opened"
  | "failed"
  | "stopped";

export interface BriefFollowUp {
  id: string;
  prompt: string;
  sentAt: string;
  planning?: boolean;
  error?: string;
  changed: string[];
  dropped: BriefDrop[];
  /** The card as it was before this line, for Undo. */
  before: { params: BriefValues; workedOut: string[]; dropped: BriefDrop[] };
}

export interface BriefCell {
  id: string;
  prompt: string;
  sentAt: string;
  state: BriefCellState;
  /** Fixed by a slash command or a pick from the workflow list, so a re-plan fills that workflow only. */
  workflowFixed?: BriefWorkflow;
  workflow?: BriefWorkflow;
  params: BriefValues;
  workedOut: string[];
  dropped: BriefDrop[];
  followUps: BriefFollowUp[];
  /** Bumped when the card's values change from outside the card, so its controls start over from them. */
  revision: number;
  error?: string;
  job?: BriefJob;
  outcome?: BriefOutcome;
  /** A request's answer, drawn by the tool's own view; kept in memory only, so a reload shows the outcome line. */
  result?: unknown;
  finishedAt?: string;
}

const STORAGE_KEY = "mdcz-brief-cells";
const SEEN_KEY = "mdcz-brief-seen-at";
const CELL_LIMIT = 50;

const readStored = <T>(key: string, fallback: T): T => {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : fallback;
};

// The server keeps nothing for a request whose answer the page never saw, so the cell says the result was not recorded.
const restoreCells = (): BriefCell[] =>
  readStored<BriefCell[]>(STORAGE_KEY, []).map((cell) =>
    cell.state === "running" && cell.job?.kind === "request"
      ? { ...cell, state: "stopped", outcome: { kind: "unrecorded" }, finishedAt: new Date().toISOString() }
      : cell,
  );

const storedParams = (params: BriefValues): BriefValues =>
  Array.isArray(params.changes) ? { ...params, changes: withoutSecretValues(params.changes) } : params;

/**
 * What reaches browser storage: no secret, no request answer, and nothing still planning. A prompt is masked once its
 * plan shows which part was a secret, so a prompt still on its way to the model is never written.
 */
const toStored = (cells: readonly BriefCell[]): BriefCell[] =>
  cells
    .filter((cell) => cell.state !== "planning")
    .map(({ result: _result, ...cell }) => ({
      ...cell,
      params: storedParams(cell.params),
      followUps: cell.followUps
        .filter((line) => !line.planning)
        .map((line) => ({ ...line, before: { ...line.before, params: storedParams(line.before.params) } })),
    }));

interface BriefState {
  cells: BriefCell[];
  /** The draft the prompt box talks to; null detaches the box, so the next prompt starts a cell of its own. */
  expandedId: string | null;
  seenAt: string;
  addCell(cell: Pick<BriefCell, "prompt"> & Partial<BriefCell>): string;
  updateCell(id: string, update: Partial<BriefCell> | ((cell: BriefCell) => Partial<BriefCell>)): void;
  removeCell(id: string): void;
  expand(id: string | null): void;
  markSeen(): void;
  clear(): void;
}

export const useBriefStore = create<BriefState>((set) => ({
  cells: restoreCells(),
  expandedId: null,
  seenAt: readStored(SEEN_KEY, new Date(0).toISOString()),
  addCell: (cell) => {
    const id = randomId();
    set((state) => ({
      cells: [
        ...state.cells,
        {
          id,
          sentAt: new Date().toISOString(),
          state: "planning" as const,
          params: {},
          workedOut: [],
          dropped: [],
          followUps: [],
          revision: 0,
          ...cell,
        },
      ].slice(-CELL_LIMIT),
      expandedId: id,
    }));
    return id;
  },
  updateCell: (id, update) =>
    set((state) => ({
      cells: state.cells.map((cell) =>
        cell.id === id ? { ...cell, ...(typeof update === "function" ? update(cell) : update) } : cell,
      ),
    })),
  removeCell: (id) =>
    set((state) => ({
      cells: state.cells.filter((cell) => cell.id !== id),
      expandedId: state.expandedId === id ? null : state.expandedId,
    })),
  expand: (expandedId) => set({ expandedId }),
  markSeen: () => {
    const seenAt = new Date().toISOString();
    localStorage.setItem(SEEN_KEY, JSON.stringify(seenAt));
    set({ seenAt });
  },
  clear: () => set({ cells: [], expandedId: null }),
}));

useBriefStore.subscribe((state, previous) => {
  if (state.cells !== previous.cells) localStorage.setItem(STORAGE_KEY, JSON.stringify(toStored(state.cells)));
});

/** Cells whose job finished or needs review since the page was last open. */
export const selectUnseenCount = (state: BriefState): number =>
  state.cells.filter(
    (cell) =>
      cell.finishedAt &&
      cell.finishedAt > state.seenAt &&
      (cell.state === "done" || cell.state === "review" || cell.state === "failed" || cell.state === "stopped"),
  ).length;

/** A follow-up's draft comes back without secrets; the ones it did not change keep what the user typed. */
const keepTypedSecrets = (
  changes: readonly BriefSettingsChange[],
  previous: BriefValues,
  changed: readonly string[],
): BriefSettingsChange[] => {
  const typed = new Map(
    ((previous.changes ?? []) as BriefSettingsChange[])
      .filter((change) => isSecretField(change.key) && change.value !== undefined)
      .map((change) => [change.key, change.value]),
  );
  return changes.map((change) =>
    typed.has(change.key) && !changed.includes(change.key) ? { ...change, value: typed.get(change.key) } : change,
  );
};

/** The fields a plan sets on a cell; a follow-up keeps the marks of the values it left alone. */
export const planToCell = (plan: BriefWorkflowPlan, previous?: BriefCell): Partial<BriefCell> => {
  const changed = plan.changed;
  const keptMarks = previous && changed ? previous.workedOut.filter((key) => !changed.includes(key)) : [];
  const params =
    plan.workflow === "settings" && previous && changed
      ? { changes: keepTypedSecrets(plan.params.changes ?? [], previous.params, changed) }
      : plan.params;
  return {
    state: "draft",
    workflow: plan.workflow,
    params: params as BriefValues,
    workedOut: [...new Set([...keptMarks, ...plan.workedOut])],
    dropped: changed && previous ? previous.dropped.filter((drop) => !changed.includes(drop.param)) : plan.dropped,
    revision: (previous?.revision ?? 0) + 1,
    error: undefined,
  };
};

export const isWorkflowPlan = (plan: BriefPlan): plan is BriefWorkflowPlan => plan.workflow !== null;

/** A settings draft from a finished change's record that puts the old values back; secrets cannot come back. */
export const undoSettingsChanges = (fields: readonly BriefFieldRecord[]): BriefSettingsChange[] =>
  fields.flatMap((field) =>
    field.secret
      ? []
      : [{ key: field.key as FieldKey, op: Array.isArray(field.before) ? "replace" : "set", value: field.before }],
  );
