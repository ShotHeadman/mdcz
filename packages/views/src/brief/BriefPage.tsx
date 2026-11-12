import type { BriefPlan, BriefPlanInput, BriefWorkflow } from "@mdcz/shared/briefCatalog";
import {
  BRIEF_SETTINGS_KEYS,
  type BriefSettingsChange,
  maskSecretsInPrompt,
  withoutSecretValues,
} from "@mdcz/shared/briefSettings";
import type { Configuration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import type { MediaLibraryDto } from "@mdcz/shared/mediaLibrary";
import { cn, randomId } from "@mdcz/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type Messages, useT } from "../i18n";
import { BriefCellView, MARGIN_GRID_CLASS, StateMark, TextButton } from "./BriefCellView";
import type { BriefPort } from "./BriefPort";
import { type BriefCell, isWorkflowPlan, planToCell, undoSettingsChanges, useBriefStore } from "./briefStore";
import { openDestination } from "./OpenCard";
import { PromptBox, parsePrompt } from "./PromptBox";

const store = () => useBriefStore.getState();
const findCell = (id: string) => store().cells.find((cell) => cell.id === id);

type Plan = (input: BriefPlanInput) => Promise<BriefPlan>;

// A secret is taken only as typed in the prompt, so once the plan names it the prompt can be masked before it is stored.
const maskedPrompt = (prompt: string, plan: BriefPlan): string =>
  plan.workflow === "settings" ? maskSecretsInPrompt(prompt, plan.params.changes ?? []) : prompt;

/** Asks for a plan for a cell of its own; a cell removed or cancelled meanwhile ignores the answer. */
const planCell = async (plan: Plan, id: string, input: BriefPlanInput) => {
  try {
    const answer = await plan(input);
    const cell = findCell(id);
    if (cell?.state !== "planning") return;
    store().updateCell(id, {
      prompt: maskedPrompt(cell.prompt, answer),
      ...(isWorkflowPlan(answer) ? planToCell(answer) : { state: "unmatched", dropped: answer.dropped }),
    });
  } catch (error) {
    if (findCell(id)?.state === "planning") store().updateCell(id, { state: "error", error: toErrorMessage(error) });
  }
};

/** A prompt typed into the box: a slash command alone opens the empty card without a model call. */
const startCell = (plan: Plan, prompt: string) => {
  const { workflow, rest } = parsePrompt(prompt);
  if (workflow && !rest) {
    store().addCell({ prompt, workflowFixed: workflow, workflow, state: "draft" });
    return;
  }
  const id = store().addCell({ prompt, workflowFixed: workflow });
  void planCell(plan, id, { prompt: rest, workflow });
};

const replan = (plan: Plan, cell: BriefCell, prompt: string, workflow = cell.workflowFixed) => {
  const { workflow: command, rest } = parsePrompt(prompt);
  const fixed = command ?? workflow;
  store().updateCell(cell.id, {
    prompt,
    workflowFixed: fixed,
    state: fixed && !rest ? "draft" : "planning",
    workflow: fixed,
    params: {},
    workedOut: [],
    dropped: [],
    followUps: [],
    error: undefined,
    revision: cell.revision + 1,
  });
  store().expand(cell.id);
  if (!fixed || rest) void planCell(plan, cell.id, { prompt: rest, workflow: fixed });
};

/** A follow-up changes the open draft when the answer keeps its workflow; any other answer becomes a cell of its own. */
const followUp = async (plan: Plan, cell: BriefCell, prompt: string) => {
  const lineId = randomId();
  const before = { params: cell.params, workedOut: cell.workedOut, dropped: cell.dropped };
  store().updateCell(cell.id, (current) => ({
    followUps: [
      ...current.followUps,
      { id: lineId, prompt, sentAt: new Date().toISOString(), planning: true, changed: [], dropped: [], before },
    ],
  }));
  const isPending = () => findCell(cell.id)?.followUps.some((line) => line.id === lineId && line.planning);
  // A secret typed on the card stays in the browser; the model gets the draft without it.
  const params = Array.isArray(cell.params.changes)
    ? { ...cell.params, changes: withoutSecretValues(cell.params.changes as BriefSettingsChange[]) }
    : cell.params;
  try {
    const answer = await plan({ prompt, draft: { workflow: cell.workflow as BriefWorkflow, params } });
    if (!isPending()) return;
    const linePrompt = maskedPrompt(prompt, answer);
    if (isWorkflowPlan(answer) && answer.changed) {
      const changed = answer.changed;
      store().updateCell(cell.id, (current) => ({
        ...planToCell(answer, current),
        followUps: current.followUps.map((line) =>
          line.id === lineId
            ? { ...line, prompt: linePrompt, planning: false, changed, dropped: answer.dropped }
            : line,
        ),
      }));
      return;
    }
    store().updateCell(cell.id, (current) => ({ followUps: current.followUps.filter((line) => line.id !== lineId) }));
    store().addCell(
      isWorkflowPlan(answer)
        ? { prompt: linePrompt, ...planToCell(answer) }
        : { prompt, state: "unmatched", dropped: answer.dropped },
    );
  } catch (error) {
    if (!isPending()) return;
    store().updateCell(cell.id, (current) => ({
      followUps: current.followUps.map((line) =>
        line.id === lineId ? { ...line, planning: false, error: toErrorMessage(error) } : line,
      ),
    }));
  }
};

const runAction = (action: () => Promise<unknown>) =>
  void action().catch((error) => toast.error(toErrorMessage(error), { id: "brief" }));

/** A draft that puts back what a finished change wrote; like every draft, it runs only from its Confirm. */
const undoDraft = (t: Messages, cell: BriefCell): Partial<BriefCell> | null => {
  const outcome = cell.outcome;
  const base = { prompt: t.brief.undoPrompt(cell.prompt), state: "draft" as const, workflow: cell.workflow };
  if (outcome?.kind === "settings")
    return { ...base, workflowFixed: "settings", params: { changes: undoSettingsChanges(outcome.fields) } };
  if (outcome?.kind === "library" && outcome.action === "update")
    return {
      ...base,
      workflowFixed: "library",
      params: {
        action: "update",
        libraryId: outcome.libraryId,
        ...Object.fromEntries((outcome.fields ?? []).map((field) => [field.key, field.before])),
      },
    };
  if (outcome?.kind === "profile" && outcome.action === "switch")
    return { ...base, workflowFixed: "profile", params: { action: "switch", name: outcome.previous } };
  return null;
};

/**
 * Brief: the user describes a job, the model fills in the card the owning page would show, and the job starts only
 * from that card's Confirm. The page is a log of what was asked and what happened; it keeps no conversation.
 */
export function BriefPage({ port }: { port: BriefPort }) {
  const t = useT();
  const cells = useBriefStore((state) => state.cells);
  const expandedId = useBriefStore((state) => state.expandedId);
  const [libraries, setLibraries] = useState<MediaLibraryDto[]>([]);
  const [config, setConfig] = useState<Configuration>();
  const sendKey = config?.llm.briefSendKey ?? "enter";
  const scrollRef = useRef<HTMLDivElement>(null);
  const attachedCell = cells.find((cell) => cell.id === expandedId && cell.state === "draft");
  // Labels and descriptions live in the dictionaries, in the user's language, which is also the prompt's.
  const settingsFields = useMemo(
    () =>
      Object.fromEntries(
        BRIEF_SETTINGS_KEYS.map((key) => {
          const { label, description } = t.settingsFields.fields[key];
          return [key, { label, ...(description ? { description } : {}) }];
        }),
      ),
    [t],
  );
  const plan: Plan = (input) => port.plan({ ...input, settingsFields });

  // A library, a profile or a setting changed from a card changes what the next cards start from.
  const reload = useCallback(() => {
    void port.libraries().then(setLibraries);
    void port.config().then(setConfig);
  }, [port]);
  useEffect(reload, [reload]);

  // The page is open, so what finished meanwhile counts as seen.
  useEffect(() => {
    if (cells) store().markSeen();
  }, [cells]);

  const cellCount = cells.length;
  useEffect(() => {
    if (cellCount) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [cellCount]);

  const submit = (text: string) => {
    if (attachedCell && !parsePrompt(text).workflow) void followUp(plan, attachedCell, text);
    else startCell(plan, text);
  };

  if (cells.length === 0) {
    return (
      <main className="flex h-full items-center justify-center bg-surface-canvas px-4 text-foreground">
        <div className="w-full max-w-2xl">
          <PromptBox large sendKey={sendKey} onSubmit={submit} />
        </div>
      </main>
    );
  }

  const actionsFor = (cell: BriefCell) => {
    const update = (patch: Partial<BriefCell>) => store().updateCell(cell.id, patch);
    const job = cell.job;
    return {
      toggle: () => store().expand(expandedId === cell.id ? null : cell.id),
      remove: () => store().removeCell(cell.id),
      cancelPlan: () => store().removeCell(cell.id),
      retryPlan: () => replan(plan, cell, cell.prompt),
      pickWorkflow: (workflow: BriefWorkflow) => replan(plan, cell, parsePrompt(cell.prompt).rest, workflow),
      editPrompt: (prompt: string) => replan(plan, cell, prompt),
      change: (patch: BriefCell["params"], touched: readonly string[] = Object.keys(patch)) =>
        store().updateCell(cell.id, (current) => ({
          params: { ...current.params, ...patch },
          workedOut: current.workedOut.filter((key) => !touched.includes(key)),
          dropped: current.dropped.filter((drop) => !touched.includes(drop.param)),
        })),
      confirmed: (confirmedJob: NonNullable<BriefCell["job"]>, outcome?: BriefCell["outcome"]) => {
        const instant = confirmedJob.kind === "instant";
        update({
          job: confirmedJob,
          outcome,
          state: !instant ? "running" : outcome?.kind === "opened" ? "opened" : "done",
          finishedAt: instant ? new Date().toISOString() : undefined,
        });
        if (outcome?.kind === "settings" || outcome?.kind === "library" || outcome?.kind === "profile") reload();
      },
      request: (run: () => Promise<{ outcome: NonNullable<BriefCell["outcome"]>; result?: unknown }>) => {
        update({ job: { kind: "request" }, state: "running", outcome: undefined, result: undefined, error: undefined });
        void run().then(
          ({ outcome, result }) =>
            findCell(cell.id) && update({ state: "done", outcome, result, finishedAt: new Date().toISOString() }),
          (error) =>
            findCell(cell.id) &&
            update({ state: "failed", error: toErrorMessage(error), finishedAt: new Date().toISOString() }),
        );
      },
      undo: () => {
        const undone = undoDraft(t, cell);
        if (undone) store().addCell({ prompt: cell.prompt, ...undone });
      },
      openAgain: () => {
        const destination = openDestination(cell.params as Parameters<typeof openDestination>[0]);
        if (destination) port.open(destination);
      },
      undoFollowUp: () =>
        store().updateCell(cell.id, (current) => {
          const line = current.followUps.at(-1);
          return line
            ? { ...line.before, followUps: current.followUps.slice(0, -1), revision: current.revision + 1 }
            : {};
        }),
      newJobInstead: () => {
        const line = cell.followUps.at(-1);
        if (!line) return;
        store().updateCell(cell.id, {
          ...line.before,
          followUps: cell.followUps.slice(0, -1),
          revision: cell.revision + 1,
        });
        startCell(plan, line.prompt);
      },
      duplicate: () =>
        store().addCell({
          prompt: cell.prompt,
          workflowFixed: cell.workflowFixed,
          workflow: cell.workflow,
          params: cell.params,
          state: "draft",
        }),
      pause: () =>
        runAction(async () => {
          if (job?.kind === "scrape") await Promise.all(job.taskIds.map((taskId) => port.pauseScrape(taskId)));
          if (job?.kind === "maintenance") await port.pauseMaintenance(job.sessionId);
        }),
      resume: () =>
        runAction(async () => {
          if (job?.kind === "scrape") await Promise.all(job.taskIds.map((taskId) => port.resumeScrape(taskId)));
          if (job?.kind === "maintenance") await port.resumeMaintenance(job.sessionId);
        }),
      stop: () =>
        runAction(async () => {
          if (job?.kind === "scrape") await Promise.all(job.taskIds.map((taskId) => port.stopScrape(taskId)));
          if (job?.kind === "maintenance") await port.stopMaintenance(job.sessionId);
        }),
      retryJob: () =>
        runAction(async () => {
          if (job?.kind !== "scrape") return;
          const taskIds = await Promise.all(job.taskIds.map((taskId) => port.retryScrape(taskId)));
          update({ job: { kind: "scrape", taskIds }, state: "running", outcome: undefined, finishedAt: undefined });
        }),
    };
  };

  return (
    <main className="flex h-full flex-col bg-surface-canvas text-foreground">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 pt-6 md:px-8">
          <header className={cn(MARGIN_GRID_CLASS, "mb-3")}>
            <div className="col-start-3 flex items-baseline justify-between gap-4">
              <h1 className="text-lg font-bold tracking-tight">{t.shell.nav.brief}</h1>
              <TextButton onClick={() => store().clear()}>{t.brief.actions.clear}</TextButton>
            </div>
          </header>
          {cells.map((cell) => (
            <BriefCellView
              key={cell.id}
              cell={cell}
              expanded={cell.id === expandedId}
              config={config}
              libraries={libraries}
              port={port}
              actions={actionsFor(cell)}
            />
          ))}
        </div>
      </div>
      <div className="mx-auto w-full max-w-4xl shrink-0 px-4 pt-3 pb-4 md:px-8">
        <div className={MARGIN_GRID_CLASS}>
          <span />
          <StateMark state="idle" attached={Boolean(attachedCell)} />
          <PromptBox
            attached={Boolean(attachedCell)}
            sendKey={sendKey}
            onSubmit={submit}
            onDetach={() => store().expand(null)}
          />
        </div>
      </div>
    </main>
  );
}
