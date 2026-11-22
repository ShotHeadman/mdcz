import type { BriefDrop, BriefWorkflow } from "@mdcz/shared/briefCatalog";
import { toErrorMessage } from "@mdcz/shared/error";
import { type MediaLibraryDto, mediaLibrarySettingsSchema } from "@mdcz/shared/mediaLibrary";
import { isFieldAnchor } from "@mdcz/shared/settingsRegistry";
import { Button, Checkbox, cn, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mdcz/ui";
import { Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { type Messages, useT } from "../i18n";
import { PERSON_SERVER_NAMES } from "../tools/details/PersonMediaLibraryDetail";
import type { BriefPort } from "./BriefPort";
import type { BriefCell, BriefJob, BriefOutcome, BriefValues } from "./briefStore";

/** A request's answer: the outcome line the cell stores, and the result its tool's view draws. */
export interface BriefRequestAnswer {
  outcome: BriefOutcome;
  result?: unknown;
}

export interface BriefCardProps {
  cell: BriefCell;
  libraries: MediaLibraryDto[];
  port: BriefPort;
  /**
   * A value the user set on the card; it is theirs from then on, so its worked-out mark goes. `touched` names the
   * fields of a settings card, whose values all sit in one parameter.
   */
  onChange: (patch: BriefValues, touched?: readonly string[]) => void;
  onConfirmed: (job: BriefJob, outcome?: BriefOutcome) => void;
  /** Runs a request the cell waits on; the answer finishes the cell, and a reload meanwhile says it was not recorded. */
  onRequest: (run: () => Promise<BriefRequestAnswer>) => void;
}

/** Loads what a card shows; an answer for an older key, or for a card that has gone, is ignored. */
export function useLoad<T>(load: () => Promise<T>, key: string | null) {
  const loadRef = useRef(load);
  loadRef.current = load;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; data?: T; error?: string } | null>(null);
  const loadKey = key === null ? null : `${attempt}:${key}`;
  useEffect(() => {
    if (loadKey === null) return;
    let current = true;
    loadRef.current().then(
      (data) => current && setState({ key: loadKey, data }),
      (error) => current && setState({ key: loadKey, error: toErrorMessage(error) }),
    );
    return () => {
      current = false;
    };
  }, [loadKey]);
  const loaded = state?.key === loadKey ? state : null;
  return {
    data: loaded?.data,
    error: loaded?.error ?? null,
    loading: loadKey !== null && !loaded,
    reload: () => setAttempt((count) => count + 1),
  };
}

/** Confirm's progress and error for a card whose Confirm is one call. */
export function useConfirm() {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    setConfirming(true);
    setError(null);
    try {
      await action();
    } catch (confirmError) {
      setError(toErrorMessage(confirmError));
    } finally {
      setConfirming(false);
    }
  };
  return { confirming, error, setError, run };
}

/** The expanded draft's outline: dashed while it holds what the model proposed, until Confirm locks it. */
export const DRAFT_OUTLINE_CLASS =
  "space-y-4 rounded-quiet-lg border border-dashed border-border px-5 py-4 transition-[border-style] duration-200 motion-reduce:transition-none";

export function CardShell({
  children,
  confirmLabel,
  confirmDisabled,
  confirming,
  error,
  footer,
  onConfirm,
}: {
  children: ReactNode;
  confirmLabel: string;
  confirmDisabled: boolean;
  confirming: boolean;
  error?: string | null;
  footer?: ReactNode;
  onConfirm: () => void;
}) {
  return (
    <div className={DRAFT_OUTLINE_CLASS}>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="mr-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">{footer}</div>
        <Button type="button" disabled={confirmDisabled || confirming} onClick={onConfirm}>
          {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Every row of a card shares one grid, so captions, ticks and controls line up whichever kind of row they are in. The
 * caption sits on the control's middle line.
 */
const ROW_GRID_CLASS =
  "grid grid-cols-[1.1rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 sm:grid-cols-[1.1rem_9rem_minmax(0,1fr)]";
const CAPTION_CLASS = "text-sm leading-5 text-muted-foreground sm:pt-2.5";
const VALUE_COLUMN_CLASS = "col-span-2 min-w-0 space-y-1.5 sm:col-span-1";

function Caption({
  id,
  label,
  workedOut,
  children,
}: {
  id?: string;
  label: string;
  workedOut: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <>
      <label htmlFor={id} className={cn("block", workedOut && "underline decoration-dotted underline-offset-4")}>
        {label}
      </label>
      {workedOut ? <span className="block text-xs">{t.brief.workedOut}</span> : null}
      {children}
    </>
  );
}

/** One value on the card: its caption, its control, and why code dropped what the model returned for it. */
export function CardRow({
  label,
  workedOut = false,
  dropped,
  children,
}: {
  label: string;
  workedOut?: boolean;
  dropped?: BriefDrop;
  children: (id: string) => ReactNode;
}) {
  const t = useT();
  const id = useId();
  return (
    <div className={ROW_GRID_CLASS}>
      <div className={cn(CAPTION_CLASS, "col-span-2")}>
        <Caption id={id} label={label} workedOut={workedOut} />
      </div>
      <div className={VALUE_COLUMN_CLASS}>
        {children(id)}
        {dropped ? <p className="text-xs text-muted-foreground">{describeDrop(t, dropped)}</p> : null}
      </div>
    </div>
  );
}

export function LibrarySelect({
  id,
  libraries,
  value,
  placeholder,
  emptyLabel,
  disabled,
  onChange,
}: {
  id: string;
  libraries: MediaLibraryDto[];
  value: string | undefined;
  placeholder: string;
  /** Offered as a choice of its own, such as every library, when the value may stay empty. */
  emptyLabel?: string;
  disabled?: boolean;
  onChange: (libraryId: string | undefined) => void;
}) {
  const none = "__none__";
  return (
    <Select
      value={value ?? (emptyLabel ? none : "")}
      disabled={disabled}
      onValueChange={(next) => onChange(next === none ? undefined : next)}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {emptyLabel ? <SelectItem value={none}>{emptyLabel}</SelectItem> : null}
        {libraries.map((library) => (
          <SelectItem key={library.id} value={library.id}>
            {library.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function OptionSelect<T extends string>({
  id,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  id: string;
  value: T | undefined;
  options: ReadonlyArray<{ value: T; label: string }>;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <Select value={value ?? ""} disabled={disabled} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const describeDrop = (t: Messages, drop: BriefDrop): string => t.brief.dropped[drop.reason](drop.value);

export const findDrop = (cell: BriefCell, param: string): BriefDrop | undefined =>
  cell.dropped.find((drop) => drop.param === param);

export const basename = (path: string): string =>
  path
    .replace(/[\\/]+$/u, "")
    .split(/[\\/]/u)
    .at(-1) || path;

type Labels = Record<string, string | { label: string }>;
const pick = (labels: Labels, value: unknown): string => {
  const entry = labels[String(value)];
  return typeof entry === "string" ? entry : (entry?.label ?? String(value));
};

/** The choices of a parameter, by the label people read; the workflow decides what an `action` or a `mode` is. */
export const choiceLabels = (t: Messages, workflow: BriefWorkflow, key: string): Labels | undefined => {
  const values = t.brief.values;
  if (key === "presetId") return t.domain.maintenancePresets;
  if (key === "issue" || key === "health") return t.library.health.issues;
  if (key === "choice") return t.pending.confirmTypes;
  if (key === "operation") return t.library.edit.operations;
  if (key === "server") return PERSON_SERVER_NAMES;
  if (key === "kind") return values.syncKind;
  if (key === "target") return workflow === "check" ? values.checkTarget : values.openTarget;
  if (key === "mode") return workflow === "open" ? values.translateMode : values.syncMode;
  if (key === "placement") return t.libraries.placements;
  if (key === "assetNaming") return t.libraries.assetNamings;
  if (key === "nfoNaming") return t.libraries.nfoNamings;
  if (key === "automation") return t.libraries.automationLevels;
  if (key === "discovery") return t.libraries.discoveryModes;
  if (key === "section") return t.settingsFields.sections;
  if (key !== "action") return undefined;
  if (workflow === "pending") return t.brief.pendingActions;
  if (workflow === "person-sync") return values.syncAction;
  if (workflow === "library") return values.libraryAction;
  if (workflow === "profile") return values.profileAction;
  return undefined;
};

/** A value as the card and the follow-up lines name it: libraries by name, choices by their label. */
export const describeValue = (
  t: Messages,
  workflow: BriefWorkflow,
  key: string,
  value: unknown,
  libraries: readonly MediaLibraryDto[],
): string => {
  if (value === undefined || value === null || value === "") return t.brief.empty;
  if (key === "libraryId" || key === "targetLibraryId")
    return libraries.find((library) => library.id === value)?.name ?? String(value);
  if (typeof value === "boolean") return value ? t.brief.yes : t.brief.no;
  if (key === "kinds" && Array.isArray(value))
    return value.map((kind) => t.pending.kinds[kind as keyof Messages["pending"]["kinds"]]).join(", ");
  if (workflow === "edit" && key === "field")
    return value === "genres" ? t.library.edit.genres : t.nfo.editor.fields[value as "studio"];
  if (key === "section" && !isFieldAnchor(value)) return String(value);
  const labels = choiceLabels(t, workflow, key);
  return labels ? pick(labels, value) : String(value);
};

const LIBRARY_SETTING_KEYS: ReadonlySet<string> = new Set(Object.keys(mediaLibrarySettingsSchema.shape));

export const paramLabel = (t: Messages, key: string, workflow?: BriefWorkflow): string =>
  (workflow === "library" && LIBRARY_SETTING_KEYS.has(key)
    ? t.libraries.fields[key as keyof Messages["libraries"]["fields"]]
    : t.brief.params[key as keyof Messages["brief"]["params"]]) ?? key;

/** The options of a choice parameter, labelled. */
export const choiceOptions = <T extends string>(
  t: Messages,
  workflow: BriefWorkflow,
  key: string,
  values: readonly T[],
): Array<{ value: T; label: string }> => {
  const labels = choiceLabels(t, workflow, key) ?? {};
  return values.map((value) => ({ value, label: pick(labels, value) }));
};

/**
 * One changed field: its tick, its caption, the new value's control, and the saved value under it. Diffs stay
 * monochrome: the saved value is muted, the new one is in the foreground.
 */
export function ChangeRow({
  label,
  ticked,
  workedOut = false,
  saved,
  notes = [],
  link,
  onTick,
  children,
}: {
  label: string;
  ticked: boolean;
  workedOut?: boolean;
  /** The saved value as text; absent where the new value's control already shows the change. */
  saved?: string;
  notes?: ReadonlyArray<{ text: string; tone?: "error" }>;
  /** Where the field lives in the app, under its caption. */
  link?: { label: string; title: string; onClick: () => void };
  onTick: (ticked: boolean) => void;
  children: (id: string) => ReactNode;
}) {
  const t = useT();
  const id = useId();
  return (
    <div className={ROW_GRID_CLASS}>
      <Checkbox
        aria-label={label}
        className="mt-px sm:mt-[0.7rem]"
        checked={ticked}
        onCheckedChange={(checked) => onTick(checked === true)}
      />
      <div className={CAPTION_CLASS}>
        <Caption id={id} label={label} workedOut={workedOut}>
          {link ? (
            <button
              type="button"
              title={link.title}
              className="block text-xs underline-offset-4 hover:text-foreground hover:underline"
              onClick={link.onClick}
            >
              {link.label}
            </button>
          ) : null}
        </Caption>
      </div>
      <div className={cn(VALUE_COLUMN_CLASS, !ticked && "opacity-50")}>
        {children(id)}
        {saved !== undefined ? (
          <p className="line-clamp-2 text-xs break-words text-muted-foreground" title={saved}>
            {t.brief.card.settings.saved(saved)}
          </p>
        ) : null}
        {notes.map((note) => (
          <p
            key={note.text}
            className={cn("text-xs", note.tone === "error" ? "text-destructive" : "text-muted-foreground")}
          >
            {note.text}
          </p>
        ))}
      </div>
    </div>
  );
}

/** A text value that reaches the card when the user leaves the field or presses Enter. */
export function TextValue({
  id,
  value,
  mono = false,
  type,
  placeholder,
  onCommit,
}: {
  id: string;
  value: string;
  mono?: boolean;
  type?: "number";
  placeholder?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <Input
      id={id}
      type={type}
      value={draft}
      placeholder={placeholder}
      className={mono ? "font-mono" : undefined}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) commit();
      }}
    />
  );
}
