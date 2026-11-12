import { BRIEF_CATALOG, BRIEF_WORKFLOWS, type BriefWorkflow, briefCommand } from "@mdcz/shared/briefCatalog";
import { type BriefSettingsChange, groupSettingsChanges } from "@mdcz/shared/briefSettings";
import type { Configuration } from "@mdcz/shared/config";
import type { MediaLibraryDto } from "@mdcz/shared/mediaLibrary";
import { cn } from "@mdcz/ui";
import { X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { formatDateTime, type Messages, useT } from "../i18n";
import type { BriefPort } from "./BriefPort";
import type { BriefCell, BriefCellState, BriefFollowUp, BriefJob, BriefOutcome } from "./briefStore";
import { CheckCard, type CheckResult, CheckResultView } from "./CheckCard";
import { type BriefRequestAnswer, describeDrop, describeValue, paramLabel } from "./cardParts";
import { DirectoryCard } from "./DirectoryCard";
import { EditCard } from "./EditCard";
import { HealthRepairCard } from "./HealthRepairCard";
import { LibraryCard } from "./LibraryCard";
import { OpenCard } from "./OpenCard";
import { PendingCard } from "./PendingCard";
import { ScrapeFileCard } from "./ScrapeFileCard";
import { describeSettingChanges, describeSettingValue, fieldLabel, SettingsCard } from "./SettingsCard";
import { PersonSyncCard, ProfileCard, SymlinkCard } from "./ToolCards";

export const MARGIN_GRID_CLASS = "grid grid-cols-[3rem_1rem_minmax(0,1fr)] gap-x-3";

/** Dots, with colour only on the two states that went wrong, in the activity list's colours. */
export function StateMark({ state, attached = false }: { state: BriefCellState | "idle"; attached?: boolean }) {
  const ring = "h-2.5 w-2.5 rounded-full border";
  const mark =
    state === "idle" ? (
      <span className={cn(ring, attached ? "border-dashed border-foreground/60" : "border-muted-foreground/60")} />
    ) : state === "planning" || state === "draft" || state === "unmatched" ? (
      <span className={cn(ring, "border-dashed border-foreground/60")} />
    ) : state === "running" ? (
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-foreground motion-reduce:animate-none" />
    ) : state === "review" ? (
      <span className={cn(ring, "border-foreground")} />
    ) : state === "done" || state === "opened" ? (
      <span className="h-1.5 w-1.5 rounded-full bg-foreground/70" />
    ) : state === "stopped" ? (
      <span className="h-2 w-2 bg-amber-500" />
    ) : (
      <X className="h-3 w-3 text-destructive" strokeWidth={3} />
    );
  return <span className="flex h-6 items-center justify-center">{mark}</span>;
}

const formatSentAt = (sentAt: string): string => {
  const sent = new Date(sentAt);
  const today = new Date();
  return sent.toDateString() === today.toDateString()
    ? formatDateTime(sent, { hour: "2-digit", minute: "2-digit" })
    : formatDateTime(sent, { month: "numeric", day: "numeric" });
};

const textButtonClass = "text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";

export function TextButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className={textButtonClass} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * The right end of a row: what happened, always shown and flush right, and what can be done with it, shown to its left
 * while the row is pointed at or holds the focus.
 */
function RowEnd({ status, actions = [] }: { status?: ReactNode; actions?: ReactNode[] }) {
  return (
    <span className="flex h-6 shrink-0 items-center justify-end gap-3 text-xs text-muted-foreground">
      {actions.length ? (
        <span className="flex items-center gap-3 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100">
          {actions}
        </span>
      ) : null}
      {status}
    </span>
  );
}

// A long outcome, such as a tool's directory, gives way to the prompt rather than pushing it off the row.
const OutcomeText = ({ text }: { text: string }) => (
  <span className="max-w-[24rem] truncate font-numeric" title={text}>
    {text}
  </span>
);

// A run fails whenever any file did; one that still added movies reads as partly done, as on the activity list.
const isPartlyDone = (cell: BriefCell): boolean =>
  cell.state === "failed" && cell.outcome?.kind === "scrape" && cell.outcome.success > 0;

/** Whether a finished cell has a draft that puts the old values back. */
export const canUndo = (cell: BriefCell): boolean => {
  const outcome = cell.outcome;
  if (cell.state !== "done" || !outcome) return false;
  if (outcome.kind === "settings") return outcome.fields.some((field) => !field.secret);
  if (outcome.kind === "library") return outcome.action === "update" && Boolean(outcome.fields?.length);
  return outcome.kind === "profile" && outcome.action === "switch";
};

const describeFinished = (t: Messages, outcome: BriefOutcome): string | null => {
  const text = t.brief.outcome;
  switch (outcome.kind) {
    case "lost":
      return text.lost;
    case "unrecorded":
      return text.unrecorded;
    case "pending":
      return outcome.action === "ignore"
        ? text.ignored(outcome.count)
        : text.confirmed(
            outcome.count,
            t.pending.confirmTypes[outcome.choice as keyof Messages["pending"]["confirmTypes"]],
          );
    case "settings":
      return text.settings(outcome.fields.length);
    case "library":
      return outcome.action === "create"
        ? text.libraryCreated(outcome.name)
        : outcome.action === "update"
          ? text.libraryUpdated(outcome.fields?.length ?? 0, outcome.name)
          : outcome.action === "ignoreHealth"
            ? text.healthIgnored(outcome.count ?? 0)
            : text.ignoredRestored(outcome.count ?? 0);
    case "profile":
      return outcome.action === "switch" ? text.profileSwitched(outcome.name) : text.profileCreated(outcome.name);
    case "name-matching":
      return text.nameMatchingStopped;
    case "symlink":
      return text.symlink(outcome.linked, outcome.copied, outcome.skipped, outcome.failed);
    case "check":
      return text.check[outcome.target as keyof Messages["brief"]["outcome"]["check"]](
        outcome.passed,
        outcome.total,
        outcome.detail ?? "",
      );
    case "opened":
      return text.opened(outcome.destination);
    default:
      return null;
  }
};

export const describeOutcome = (t: Messages, cell: BriefCell): string => {
  const outcome: BriefOutcome | undefined = cell.outcome;
  const text = t.brief.outcome;
  const running = cell.state === "running";
  const state = running
    ? text.running
    : isPartlyDone(cell)
      ? t.overview.activity.partlyDone
      : cell.state === "failed"
        ? text.failed
        : cell.state === "stopped"
          ? text.stopped
          : text.done;
  if (!outcome) return state;
  const finished = describeFinished(t, outcome);
  if (finished) return finished;
  if (outcome.kind === "scrape")
    return [
      state,
      running
        ? text.progress(outcome.completed, outcome.total)
        : text.scrape(outcome.success, outcome.failed, outcome.skipped),
    ].join(" · ");
  if (outcome.kind === "maintenance")
    return [
      state,
      running
        ? text.progress(outcome.completed, outcome.total)
        : outcome.phase === "apply"
          ? text.applied
          : text.maintenance(outcome.changes),
    ].join(" · ");
  if (outcome.kind === "person-sync")
    return [
      state,
      running
        ? text.progress(outcome.current, outcome.total)
        : text.personSync(outcome.processed, outcome.failed, outcome.skipped),
    ].join(" · ");
  if (outcome.kind === "edit")
    return [
      state,
      running
        ? text.progress(outcome.current, outcome.total)
        : text.edit(outcome.changed, outcome.unchanged, outcome.skipped, outcome.failed),
    ].join(" · ");
  return state;
};

const settingsChanges = (params: BriefCell["params"]): BriefSettingsChange[] =>
  (params.changes ?? []) as BriefSettingsChange[];

/** "Library: Main → Archive" for what a follow-up line changed, or why it changed nothing. */
const describeFollowUp = (
  t: Messages,
  cell: BriefCell,
  line: BriefFollowUp,
  after: BriefCell["params"],
  libraries: readonly MediaLibraryDto[],
  config: Configuration | undefined,
): string => {
  if (line.planning) return t.brief.followUp.planning;
  if (line.error) return t.brief.errors.planFailed(line.error);
  const workflow = cell.workflow as BriefWorkflow;
  if (line.changed.length === 0)
    return [t.brief.followUp.noChange, ...line.dropped.map((drop) => describeDrop(t, drop))].join(" · ");
  if (workflow === "settings") {
    const forKey = (params: BriefCell["params"], key: string) =>
      settingsChanges(params).filter((change) => change.key === key);
    return line.changed
      .map((key) => {
        const field = key as BriefSettingsChange["key"];
        return `${fieldLabel(t, key)}: ${describeSettingChanges(t, config, field, forKey(line.before.params, key))} → ${describeSettingChanges(t, config, field, forKey(after, key))}`;
      })
      .join(" · ");
  }
  return line.changed
    .map(
      (key) =>
        `${paramLabel(t, key, workflow)}: ${describeValue(t, workflow, key, line.before.params[key], libraries)} → ${describeValue(t, workflow, key, after[key], libraries)}`,
    )
    .join(" · ");
};

function PlanningRow({ onCancel }: { onCancel: () => void }) {
  const t = useT();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="flex items-center gap-3 py-1">
      <span
        aria-hidden="true"
        className="h-px flex-1 animate-dash-travel bg-[length:12px_1px] bg-repeat-x text-muted-foreground motion-reduce:animate-none"
        style={{ backgroundImage: "linear-gradient(90deg, currentColor 0 6px, transparent 6px 12px)" }}
      />
      <span role="status" className="font-numeric text-xs text-muted-foreground">
        {t.brief.planning(seconds)}
      </span>
      <TextButton onClick={onCancel}>{t.brief.actions.cancel}</TextButton>
    </div>
  );
}

/** The values a confirmed job ran with, drawn solid: they are what the user confirmed. */
function LockedSummary({ cell, libraries }: { cell: BriefCell; libraries: readonly MediaLibraryDto[] }) {
  const t = useT();
  const workflow = cell.workflow as BriefWorkflow;
  const rows =
    workflow === "settings"
      ? groupSettingsChanges(settingsChanges(cell.params)).map(({ key, changes }) => ({
          key,
          label: fieldLabel(t, key),
          value:
            changes.at(-1)?.op === "set" && changes.length === 1
              ? describeSettingValue(t, key, changes[0]?.value)
              : describeSettingChanges(t, undefined, key, changes),
        }))
      : Object.keys(BRIEF_CATALOG[workflow].params.shape)
          .filter((key) => cell.params[key] !== undefined && cell.params[key] !== "")
          .map((key) => ({
            key,
            label: paramLabel(t, key, workflow),
            value: describeValue(t, workflow, key, cell.params[key], libraries),
          }));
  return (
    <dl className="grid gap-x-3 gap-y-1.5 rounded-quiet-lg border border-border px-5 py-4 text-sm leading-5 sm:grid-cols-[calc(9rem+1.1rem+0.75rem)_minmax(0,1fr)]">
      {rows.map((row) => (
        <div key={row.key} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A request's answer, drawn by the view its tool draws it with. */
function RequestResult({ cell }: { cell: BriefCell }) {
  const t = useT();
  if (cell.workflow === "check") return <CheckResultView result={cell.result as CheckResult} />;
  const result = cell.result as { total: number; linked: number; copied: number; skipped: number; failed: number };
  return (
    <p className="rounded-quiet-lg border border-border px-4 py-3 text-sm text-muted-foreground">
      {t.tools.symlinkSummary(result.total, result.linked, result.copied, result.skipped, result.failed)}
    </p>
  );
}

export interface BriefCellActions {
  toggle: () => void;
  remove: () => void;
  cancelPlan: () => void;
  retryPlan: () => void;
  pickWorkflow: (workflow: BriefWorkflow) => void;
  editPrompt: (prompt: string) => void;
  change: (patch: BriefCell["params"], touched?: readonly string[]) => void;
  confirmed: (job: BriefJob, outcome?: BriefOutcome) => void;
  request: (run: () => Promise<BriefRequestAnswer>) => void;
  undoFollowUp: () => void;
  newJobInstead: () => void;
  duplicate: () => void;
  undo: () => void;
  openAgain: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  retryJob: () => void;
}

export function BriefCellView({
  cell,
  expanded,
  config,
  libraries,
  port,
  actions,
}: {
  cell: BriefCell;
  expanded: boolean;
  config?: Configuration;
  libraries: MediaLibraryDto[];
  port: BriefPort;
  actions: BriefCellActions;
}) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const draft = cell.state === "draft";
  const hasResult = cell.result !== undefined && cell.state === "done";
  const expandable = draft || cell.state === "running" || hasResult;
  const open = expanded && expandable;
  const trail = draft && expanded;
  const workflow = cell.workflow;
  const latestLine = cell.followUps.at(-1);
  const scrapeJob = cell.job?.kind === "scrape";
  const maintenanceJob = cell.job?.kind === "maintenance";
  const paused = (cell.outcome?.kind === "scrape" || cell.outcome?.kind === "maintenance") && cell.outcome.paused;

  const right =
    cell.state === "planning" ? null : draft ? (
      <RowEnd
        actions={[
          <TextButton key="edit" onClick={() => setEditing(cell.prompt)}>
            {t.brief.actions.edit}
          </TextButton>,
          <TextButton key="remove" onClick={actions.remove}>
            {t.brief.actions.remove}
          </TextButton>,
        ]}
      />
    ) : cell.state === "running" ? (
      <RowEnd
        status={
          <>
            <OutcomeText text={describeOutcome(t, cell)} />
            {scrapeJob || maintenanceJob ? (
              <>
                <TextButton onClick={paused ? actions.resume : actions.pause}>
                  {paused ? t.brief.actions.resume : t.brief.actions.pause}
                </TextButton>
                <TextButton onClick={actions.stop}>{t.brief.actions.stop}</TextButton>
              </>
            ) : null}
          </>
        }
      />
    ) : cell.state === "review" ? (
      <RowEnd
        status={
          <button
            type="button"
            className="font-numeric text-xs text-foreground underline-offset-4 hover:underline"
            onClick={port.openMaintenanceReview}
          >
            {t.brief.outcome.review(cell.outcome?.kind === "maintenance" ? cell.outcome.changes : 0)} ▸
          </button>
        }
      />
    ) : cell.state === "opened" ? (
      <RowEnd
        status={<OutcomeText text={describeOutcome(t, cell)} />}
        actions={[
          <TextButton key="again" onClick={actions.openAgain}>
            {t.brief.actions.openAgain}
          </TextButton>,
        ]}
      />
    ) : cell.state === "done" || cell.state === "failed" || cell.state === "stopped" ? (
      <RowEnd
        status={
          <>
            <OutcomeText text={describeOutcome(t, cell)} />
            {cell.state !== "done" && scrapeJob ? (
              <TextButton onClick={actions.retryJob}>{t.brief.actions.retry}</TextButton>
            ) : null}
          </>
        }
        actions={[
          ...(canUndo(cell)
            ? [
                <TextButton key="undo" onClick={actions.undo}>
                  {t.brief.actions.undo}
                </TextButton>,
              ]
            : []),
          <TextButton key="duplicate" onClick={actions.duplicate}>
            {t.brief.actions.duplicate}
          </TextButton>,
        ]}
      />
    ) : (
      <RowEnd
        actions={[
          <TextButton key="remove" onClick={actions.remove}>
            {t.brief.actions.remove}
          </TextButton>,
        ]}
      />
    );

  const trailClass = trail ? "border-l border-dashed border-foreground/40" : "";
  const marginTrail = <span className={cn("mx-auto h-full w-px", trailClass)} aria-hidden="true" />;

  return (
    <section className={cn("border-b border-border/50 py-2", open && "pb-4")} aria-label={cell.prompt}>
      <div className={cn(MARGIN_GRID_CLASS, "group/row items-start")}>
        <time className="text-right font-numeric text-[11px] leading-6 text-muted-foreground" dateTime={cell.sentAt}>
          {formatSentAt(cell.sentAt)}
        </time>
        <StateMark state={isPartlyDone(cell) ? "stopped" : cell.state} />
        <div className="flex min-w-0 items-start justify-between gap-4">
          {editing !== null ? (
            <input
              aria-label={t.brief.actions.edit}
              className="min-w-0 flex-1 border-b border-dashed border-border bg-transparent text-sm leading-6 outline-none"
              value={editing}
              // biome-ignore lint/a11y/noAutofocus: the input replaces the prompt line the user just chose to edit.
              autoFocus
              onChange={(event) => setEditing(event.target.value)}
              onBlur={() => setEditing(null)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Escape") setEditing(null);
                if (event.key === "Enter" && editing.trim()) {
                  actions.editPrompt(editing.trim());
                  setEditing(null);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className={cn(
                "min-w-0 truncate text-left text-sm leading-6",
                expandable ? "cursor-pointer hover:underline" : "cursor-default",
              )}
              title={cell.prompt}
              onClick={expandable ? actions.toggle : undefined}
            >
              {cell.prompt}
            </button>
          )}
          {right}
        </div>
      </div>

      {cell.followUps.map((line, index) => (
        <div key={line.id} className={cn(MARGIN_GRID_CLASS, "group/row items-start")}>
          <span />
          {marginTrail}
          <div className="flex min-w-0 items-start justify-between gap-4 text-sm leading-6">
            <span className="min-w-0 truncate text-muted-foreground" title={line.prompt}>
              ↳ {line.prompt}
            </span>
            <RowEnd
              status={
                <span className={cn("max-w-[28rem] truncate font-numeric", line.error && "text-destructive")}>
                  {describeFollowUp(
                    t,
                    cell,
                    line,
                    cell.followUps[index + 1]?.before.params ?? cell.params,
                    libraries,
                    config,
                  )}
                </span>
              }
              actions={
                line === latestLine && !line.planning && draft
                  ? [
                      <TextButton key="undo" onClick={actions.undoFollowUp}>
                        {t.brief.actions.undo}
                      </TextButton>,
                      <TextButton key="new" onClick={actions.newJobInstead}>
                        {t.brief.actions.newJobInstead}
                      </TextButton>,
                    ]
                  : []
              }
            />
          </div>
        </div>
      ))}

      {cell.state === "planning" ? (
        <div className={MARGIN_GRID_CLASS}>
          <span />
          {marginTrail}
          <PlanningRow onCancel={actions.cancelPlan} />
        </div>
      ) : null}

      {cell.state === "error" || ((cell.state === "failed" || cell.state === "stopped") && cell.error) ? (
        <div className={MARGIN_GRID_CLASS}>
          <span />
          <span />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className={cn(cell.state === "error" ? "text-destructive" : "text-muted-foreground")}>
              {cell.state === "error" ? t.brief.errors.planFailed(cell.error ?? "") : cell.error}
            </span>
            {cell.state === "error" ? (
              <>
                <TextButton onClick={actions.retryPlan}>{t.brief.actions.retry}</TextButton>
                <TextButton onClick={() => port.open({ page: "settings", section: "llm" })}>
                  {t.brief.actions.settings}
                </TextButton>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {cell.state === "unmatched" ? (
        <div className={MARGIN_GRID_CLASS}>
          <span />
          <span />
          <div className="space-y-2 py-1">
            <p className="text-sm text-muted-foreground">{t.brief.unmatched}</p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {BRIEF_WORKFLOWS.map((option) => (
                <li key={option}>
                  <button
                    type="button"
                    className="w-full rounded-quiet px-2 py-1.5 text-left hover:bg-surface-low"
                    onClick={() => actions.pickWorkflow(option)}
                  >
                    <span className="font-mono text-xs text-muted-foreground">/{briefCommand(option)}</span>{" "}
                    <span className="text-sm">{t.brief.workflows[option].title}</span>
                    <span className="block text-xs text-muted-foreground">{t.brief.workflows[option].description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {open && workflow ? (
        <div className={cn(MARGIN_GRID_CLASS, "mt-2")}>
          <span />
          {marginTrail}
          {draft ? (
            <DraftCard cell={cell} config={config} libraries={libraries} port={port} actions={actions} />
          ) : hasResult ? (
            <RequestResult cell={cell} />
          ) : (
            <LockedSummary cell={cell} libraries={libraries} />
          )}
        </div>
      ) : null}
    </section>
  );
}

function DraftCard({
  cell,
  config,
  libraries,
  port,
  actions,
}: {
  cell: BriefCell;
  config?: Configuration;
  libraries: MediaLibraryDto[];
  port: BriefPort;
  actions: BriefCellActions;
}) {
  const props = {
    cell,
    libraries,
    port,
    onChange: actions.change,
    onConfirmed: actions.confirmed,
    onRequest: actions.request,
  };
  switch (cell.workflow) {
    case "scrape":
      return cell.params.file ? (
        <ScrapeFileCard {...props} />
      ) : (
        <DirectoryCard mode="scrape" config={config} {...props} />
      );
    case "maintenance":
      return cell.params.issue ? (
        <HealthRepairCard {...props} />
      ) : (
        <DirectoryCard mode="maintenance" config={config} {...props} />
      );
    case "pending":
      return <PendingCard {...props} />;
    case "edit":
      return <EditCard config={config} {...props} />;
    case "person-sync":
      return <PersonSyncCard {...props} />;
    case "settings":
      return <SettingsCard {...props} />;
    case "library":
      return <LibraryCard {...props} />;
    case "symlink":
      return <SymlinkCard {...props} />;
    case "check":
      return <CheckCard {...props} />;
    case "profile":
      return <ProfileCard {...props} />;
    case "open":
      return <OpenCard {...props} />;
    default:
      return null;
  }
}
