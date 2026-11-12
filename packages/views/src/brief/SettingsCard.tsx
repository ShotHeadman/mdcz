import {
  BRIEF_SETTINGS_KEYS,
  type BriefSettingsChange,
  groupSettingsChanges,
  isListField,
  isSecretField,
  resolveSettingsRow,
  SETTINGS_ENTRY_KEYS,
  type SettingsRowResult,
  settingsFieldShape,
  validateSettingsValues,
} from "@mdcz/shared/briefSettings";
import type { Configuration } from "@mdcz/shared/config";
import { appPreviewPosterBadgesInputSchema } from "@mdcz/shared/serverDtos";
import { FIELD_REGISTRY_BY_KEY, type FieldKey, getNestedValue, unflattenConfig } from "@mdcz/shared/settingsRegistry";
import {
  Button,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  cn,
  PasswordInput,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
} from "@mdcz/ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import { type Messages, useT } from "../i18n";
import type { BriefFieldRecord } from "./briefStore";
import {
  type BriefCardProps,
  CardRow,
  CardShell,
  ChangeRow,
  describeDrop,
  OptionSelect,
  TextValue,
  useConfirm,
  useLoad,
} from "./cardParts";

const SECRET_MASK = "••••••";

/** The labels the Settings page gives a choice, or a list's entries; other values read as they are. */
const optionLabels = (t: Messages, key: FieldKey): Record<string, string> | undefined => {
  const labels: Partial<Record<FieldKey, Record<string, string>>> = {
    "translate.engine": t.settings.options.translateEngine,
    "translate.baiduService": t.settings.options.baiduService,
    "translate.fields": t.settings.translateFields,
    "llm.reasoning": t.settings.options.llmReasoning,
    "llm.apiFormat": t.settings.options.llmApiFormat,
    "llm.serviceType": t.settings.options.llmServiceType,
    "llm.outputFormat": t.settings.options.llmOutputFormat,
    "llm.briefSendKey": t.settings.options.briefSendKey,
    "naming.partStyle": t.settings.options.partStyle,
    "personSync.bioLabelLanguage": t.settings.options.bioLabelLanguage,
    "download.tagBadgePosition": t.domain.posterBadgePositions,
    "download.tagBadgeTypes": t.domain.posterBadgeTypes,
    "download.nfoIgnoreFields": t.settings.nfoFields,
    "notifications.channels": t.settings.notificationChannels,
  };
  return labels[key];
};

export const fieldLabel = (t: Messages, key: string): string => t.settingsFields.fields[key as FieldKey]?.label ?? key;

const optionLabel = (t: Messages, key: FieldKey, value: unknown): string =>
  optionLabels(t, key)?.[String(value)] ?? String(value);

const issueText = (t: Messages, issue: string): string => t.settings.configValidation.issues[issue] ?? issue;

const describeEntry = (t: Messages, key: FieldKey, entry: unknown): string => {
  if (!entry || typeof entry !== "object") return optionLabel(t, key, entry);
  const record = entry as Record<string, unknown>;
  if (key === "personSync.actorAliases") return `${record.name} (${(record.aliases as string[]).join(", ")})`;
  if (key === "automation.pathMappings") return `${record.from} → ${record.to}`;
  return JSON.stringify(entry);
};

/** A settings value as the card and the follow-up lines name it; a secret is never shown. */
export const describeSettingValue = (t: Messages, key: FieldKey, value: unknown): string => {
  if (isSecretField(key)) return value ? SECRET_MASK : t.brief.empty;
  if (value === undefined || value === null || value === "") return t.brief.empty;
  if (typeof value === "boolean") return value ? t.brief.on : t.brief.off;
  if (Array.isArray(value))
    return value.length ? value.map((entry) => describeEntry(t, key, entry)).join(", ") : t.brief.empty;
  return optionLabel(t, key, value);
};

/** What a field's operations do, in the follow-up line's words: the new value, or the list entries they touch. */
export const describeSettingChanges = (
  t: Messages,
  configuration: Configuration | undefined,
  key: FieldKey,
  changes: readonly BriefSettingsChange[],
): string => {
  if (!changes.length) return t.brief.empty;
  if (!isListField(key)) {
    const last = changes.at(-1);
    if (last?.op === "reset") return t.brief.card.settings.default;
    return describeSettingValue(t, key, last?.value);
  }
  const row = configuration ? resolveSettingsRow(configuration, key, changes) : null;
  if (row?.ok)
    return describeListDiff(t, key, row.saved, row.value)
      .map((entry) =>
        entry.sign === "↕" ? t.brief.card.settings.moved(entry.entry, entry.to) : `${entry.sign}${entry.entry}`,
      )
      .join(", ");
  return changes.map((change) => `${change.op} ${describeEntry(t, key, change.value)}`).join(", ");
};

type DiffEntry = { entry: string } & ({ sign: "+" | "−" } | { sign: "↕"; from: number; to: number });

const entryKey = (key: FieldKey, entry: unknown): string => {
  const field = SETTINGS_ENTRY_KEYS[key];
  return field && entry && typeof entry === "object"
    ? String((entry as Record<string, unknown>)[field])
    : JSON.stringify(entry);
};

/** The kept entries whose order the change broke: those outside the longest run that kept its order. */
const movedEntries = (beforeKeys: readonly string[], keptAfter: readonly string[]): Set<string> => {
  const order = keptAfter.map((entry) => beforeKeys.indexOf(entry));
  const runs = order.map(() => 1);
  const previous = order.map(() => -1);
  for (let index = 0; index < order.length; index += 1)
    for (let earlier = 0; earlier < index; earlier += 1)
      if ((order[earlier] ?? 0) < (order[index] ?? 0) && (runs[earlier] ?? 0) + 1 > (runs[index] ?? 0)) {
        runs[index] = (runs[earlier] ?? 0) + 1;
        previous[index] = earlier;
      }
  const inOrder = new Set<string>();
  for (let index = runs.indexOf(Math.max(0, ...runs)); index >= 0; index = previous[index] ?? -1)
    inOrder.add(keptAfter[index] ?? "");
  return new Set(keptAfter.filter((entry) => !inOrder.has(entry)));
};

/** Which entries a list change adds, removes and moves. */
const describeListDiff = (t: Messages, key: FieldKey, saved: unknown, value: unknown): DiffEntry[] => {
  const before = Array.isArray(saved) ? saved : [];
  const after = Array.isArray(value) ? value : [];
  const beforeKeys = before.map((entry) => entryKey(key, entry));
  const afterKeys = after.map((entry) => entryKey(key, entry));
  const moved = movedEntries(
    beforeKeys,
    afterKeys.filter((entry) => beforeKeys.includes(entry)),
  );
  return [
    ...after.flatMap<DiffEntry>((entry, index) => {
      const entryKey = afterKeys[index] ?? "";
      const text = describeEntry(t, key, entry);
      if (!beforeKeys.includes(entryKey)) return [{ sign: "+", entry: text }];
      return moved.has(entryKey)
        ? [{ sign: "↕", entry: text, from: beforeKeys.indexOf(entryKey) + 1, to: index + 1 }]
        : [];
    }),
    ...before.flatMap<DiffEntry>((entry, index) =>
      afterKeys.includes(beforeKeys[index] ?? "") ? [] : [{ sign: "−", entry: describeEntry(t, key, entry) }],
    ),
  ];
};

/** How many entries a replace drops; removing one entry by name is what the request asked for. */
const dropsEntries = (row: SettingsRowResult, changes: readonly BriefSettingsChange[]): number => {
  if (!row.ok || !changes.some((change) => change.op === "replace")) return 0;
  if (!Array.isArray(row.saved) || !Array.isArray(row.value)) return 0;
  const after = new Set(row.value.map((entry) => JSON.stringify(entry)));
  return row.saved.filter((entry) => !after.has(JSON.stringify(entry))).length;
};

/**
 * One row per field: its saved value, its new value, and for a list the entries added, removed and moved. Nothing is
 * written over a value the user has not seen: Confirm reads the settings again and asks again when a row's saved value
 * changed meanwhile.
 */
export function SettingsCard({ cell, port, onChange, onConfirmed }: BriefCardProps) {
  const t = useT();
  const text = t.brief.card.settings;
  const changes = (cell.params.changes ?? []) as BriefSettingsChange[];
  const config = useLoad(() => port.config(), "config");
  const [ticks, setTicks] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const { confirming, error, setError, run } = useConfirm();
  const configuration = config.data;

  const rows = groupSettingsChanges(changes).map(({ key, changes: fieldChanges }) => {
    const result = configuration ? resolveSettingsRow(configuration, key, fieldChanges) : null;
    // A replace that drops entries starts unticked: retyping a list is how a model loses entries.
    const ticked = ticks.get(key) ?? !(result && dropsEntries(result, fieldChanges) > 0);
    return { key, changes: fieldChanges, result, ticked };
  });
  const ready = rows.filter((row) => row.ticked && row.result?.ok);
  const values = new Map(ready.map((row) => [row.key, row.result?.ok ? row.result.value : undefined]));
  const problems = configuration ? validateSettingsValues(configuration, values) : new Map<FieldKey, string>();
  const blocked = rows.some((row) => row.ticked && row.result && !row.result.ok && row.result.reason === "empty");

  const setValue = (key: FieldKey, value: unknown) => {
    const set: BriefSettingsChange = { key, op: "set", value };
    const groups = groupSettingsChanges(changes);
    const merged = groups.flatMap((group) => (group.key === key ? [set] : group.changes));
    onChange({ changes: groups.some((group) => group.key === key) ? merged : [...merged, set] }, [key]);
    setNotice(null);
  };

  const confirm = () =>
    run(async () => {
      const fresh = await port.config();
      const stale = ready.filter(
        (row) =>
          JSON.stringify(getNestedValue(fresh, row.key)) !==
          JSON.stringify(row.result?.ok ? row.result.saved : undefined),
      );
      if (stale.length) {
        config.reload();
        setNotice(text.changedSince(stale.map((row) => fieldLabel(t, row.key)).join(", ")));
        return;
      }
      const freshProblems = validateSettingsValues(fresh, values);
      if (freshProblems.size) {
        setError([...freshProblems.values()].map((issue) => issueText(t, issue)).join(" · "));
        return;
      }
      await port.updateConfig(unflattenConfig(Object.fromEntries(values)));
      const fields: BriefFieldRecord[] = ready.map((row) =>
        isSecretField(row.key) || !row.result?.ok
          ? { key: row.key, secret: true }
          : { key: row.key, before: row.result.saved, after: row.result.value },
      );
      onConfirmed({ kind: "instant" }, { kind: "settings", fields });
    });

  return (
    <CardShell
      confirmLabel={text.confirm(ready.length)}
      confirmDisabled={!configuration || ready.length === 0 || blocked || problems.size > 0}
      confirming={confirming}
      error={error ?? config.error ?? notice}
      footer={<AddField onAdd={(key) => configuration && setValue(key, getNestedValue(configuration, key))} />}
      onConfirm={() => void confirm()}
    >
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{text.noRows}</p> : null}
      {rows.map((row) => {
        const { key, result } = row;
        const secret = isSecretField(key);
        const list = isListField(key);
        const drop = cell.dropped.find((entry) => entry.param === key);
        const dropped = result && dropsEntries(result, row.changes);
        const notes = [
          ...(drop ? [{ text: describeDrop(t, drop) }] : []),
          ...(result && !result.ok && result.reason !== "empty"
            ? [{ text: text.reasons[result.reason], tone: "error" as const }]
            : []),
          ...(problems.has(key) ? [{ text: issueText(t, problems.get(key) ?? ""), tone: "error" as const }] : []),
          ...(dropped ? [{ text: text.dropsEntries(dropped) }] : []),
          ...(secret
            ? [
                {
                  text:
                    row.changes.some((change) => change.value !== undefined) && cell.prompt.includes(SECRET_MASK)
                      ? text.secretFromPrompt
                      : text.secretOnCard,
                },
                { text: text.secretNoUndo },
              ]
            : []),
        ];
        const anchor = FIELD_REGISTRY_BY_KEY[key].anchor;
        return (
          <ChangeRow
            key={key}
            label={fieldLabel(t, key)}
            ticked={row.ticked}
            workedOut={cell.workedOut.includes(key)}
            saved={result?.ok && !list ? describeSettingValue(t, key, result.saved) : undefined}
            notes={notes}
            link={{
              label: t.settingsFields.sections[anchor].label,
              title: text.openInSettings,
              onClick: () => port.open({ page: "settings", section: anchor }),
            }}
            onTick={(ticked) => setTicks((current) => new Map(current).set(key, ticked))}
          >
            {(id) =>
              list ? (
                <ListDiff t={t} fieldKey={key} result={result} changes={row.changes} />
              ) : (
                <SettingControl
                  id={id}
                  fieldKey={key}
                  value={result?.ok ? result.value : row.changes.at(-1)?.value}
                  reset={row.changes.at(-1)?.op === "reset"}
                  onChange={(value) => setValue(key, value)}
                />
              )
            }
          </ChangeRow>
        );
      })}
      {configuration ? <SettingsPreview port={port} configuration={configuration} values={values} /> : null}
    </CardShell>
  );
}

/** One line per entry the change adds, removes or moves, in a frame the width of the other rows' controls. */
function ListDiff({
  t,
  fieldKey,
  result,
  changes,
}: {
  t: Messages;
  fieldKey: FieldKey;
  result: SettingsRowResult | null;
  changes: readonly BriefSettingsChange[];
}) {
  const text = t.brief.card.settings;
  const lines = result?.ok
    ? describeListDiff(t, fieldKey, result.saved, result.value).map((entry) => ({
        sign: entry.sign,
        entry: entry.entry,
        note:
          entry.sign === "↕"
            ? text.listMoved(entry.from, entry.to)
            : entry.sign === "+"
              ? text.listAdded
              : text.listRemoved,
      }))
    : changes.map((change) => ({ sign: "·", entry: describeEntry(t, fieldKey, change.value), note: change.op }));
  if (!lines.length) return <p className="text-sm leading-5 text-muted-foreground sm:pt-2.5">{t.brief.empty}</p>;
  return (
    <ul className="divide-y divide-border/50 rounded-quiet border border-border/70 text-sm">
      {lines.map((line) => (
        <li key={`${line.sign}${line.entry}`} className="flex items-baseline gap-3 px-3.5 py-2">
          <span aria-hidden="true" className="w-3 shrink-0 text-center font-mono text-muted-foreground">
            {line.sign}
          </span>
          <span className={cn("min-w-0 break-words", line.sign === "−" && "text-muted-foreground")}>{line.entry}</span>
          <span className="ml-auto shrink-0 font-numeric text-xs text-muted-foreground">{line.note}</span>
        </li>
      ))}
    </ul>
  );
}

/** The field's own kind of control: a switch, a choice, a number, text, or a masked input for a secret. */
function SettingControl({
  id,
  fieldKey,
  value,
  reset,
  onChange,
}: {
  id: string;
  fieldKey: FieldKey;
  value: unknown;
  reset: boolean;
  onChange: (value: unknown) => void;
}) {
  const t = useT();
  const shape = settingsFieldShape(fieldKey);
  const variants = shape.anyOf ?? [shape];
  const choices = variants.find((variant) => variant.enum)?.enum as string[] | undefined;
  const numeric = variants.some((variant) => variant.type === "integer" || variant.type === "number");
  const caption = reset ? <p className="text-xs text-muted-foreground">{t.brief.card.settings.default}</p> : null;
  if (isSecretField(fieldKey))
    return (
      <SecretValue
        id={id}
        value={typeof value === "string" ? value : ""}
        onCommit={(next) => onChange(next || undefined)}
      />
    );
  if (shape.type === "boolean")
    return (
      <div className="flex items-center gap-3 pt-1.5">
        <Switch id={id} checked={value === true} onCheckedChange={(checked) => onChange(checked)} />
        {caption}
      </div>
    );
  if (choices)
    return (
      <>
        <OptionSelect
          id={id}
          value={typeof value === "string" ? value : undefined}
          placeholder={t.brief.card.settings.choose}
          options={choices.map((choice) => ({ value: choice, label: optionLabel(t, fieldKey, choice) }))}
          onChange={onChange}
        />
        {caption}
      </>
    );
  return (
    <>
      <TextValue
        id={id}
        type={numeric ? "number" : undefined}
        value={value === undefined || value === null ? "" : String(value)}
        mono={/Template|Rule|Style|Url|url|proxy|Folder/u.test(fieldKey)}
        onCommit={(next) => onChange(numeric ? (next === "" ? null : Number(next)) : next)}
      />
      {caption}
    </>
  );
}

function SecretValue({ id, value, onCommit }: { id: string; value: string; onCommit: (value: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(value);
  return (
    <PasswordInput
      id={id}
      autoComplete="off"
      visibilityLabels={{ show: t.common.showPassword, hide: t.common.hidePassword }}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft.trim())}
    />
  );
}

/** Any field the card can edit itself; lists change by prompt or on the Settings page. */
function AddField({ onAdd }: { onAdd: (key: FieldKey) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const keys = BRIEF_SETTINGS_KEYS.filter((key) => !isListField(key));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="-ml-2 h-7 px-2 text-xs text-muted-foreground">
          <Plus className="h-3.5 w-3.5" />
          {t.brief.card.settings.addField}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder={t.brief.card.settings.findField} />
          <CommandList>
            <CommandEmpty>{t.brief.card.settings.noField}</CommandEmpty>
            {keys.map((key) => {
              const label = t.settingsFields.fields[key]?.label ?? key;
              const section = t.settingsFields.sections[FIELD_REGISTRY_BY_KEY[key].anchor].label;
              return (
                <CommandItem
                  key={key}
                  value={`${label} ${section} ${key}`}
                  onSelect={() => {
                    onAdd(key);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{label}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{section}</span>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The field's own preview, for the values a change gives it: the poster badges as they would be drawn, and a trial
 * translation with an edited prompt. A value worked out from a description is judged here, next to the saved one.
 */
function SettingsPreview({
  port,
  configuration,
  values,
}: {
  port: BriefCardProps["port"];
  configuration: Configuration;
  values: ReadonlyMap<FieldKey, unknown>;
}) {
  const t = useT();
  const badgeKeys = [...values.keys()].filter((key) => key.startsWith("download.tagBadge"));
  const badgeInput = appPreviewPosterBadgesInputSchema.safeParse(
    Object.fromEntries(
      Object.keys(appPreviewPosterBadgesInputSchema.shape).map((field) => {
        const key = `download.${field}` as FieldKey;
        return [field, values.has(key) ? values.get(key) : getNestedValue(configuration, key)];
      }),
    ),
  );
  const badges = useLoad(
    async () => (badgeInput.success ? await port.previewPosterBadges(badgeInput.data) : null),
    badgeKeys.length && badgeInput.success ? JSON.stringify(badgeInput.data) : null,
  );
  const prompt = values.get("translate.llmPrompt");
  const [trial, setTrial] = useState<{ prompt: unknown; text: string } | null>(null);
  const [trying, setTrying] = useState(false);

  return (
    <>
      {badges.data ? (
        <CardRow label={t.settings.badgePreview.title}>
          {() => (
            <img src={badges.data ?? ""} alt={t.settings.badgePreview.title} className="h-40 w-auto rounded-quiet" />
          )}
        </CardRow>
      ) : null}
      {typeof prompt === "string" ? (
        <CardRow label={t.brief.card.settings.tryPrompt}>
          {(id) => (
            <div className="space-y-1.5 text-sm leading-5 sm:pt-2.5">
              <button
                id={id}
                type="button"
                disabled={trying}
                className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-60"
                onClick={async () => {
                  setTrying(true);
                  const result = await port.testTranslation({ llmPrompt: prompt }).catch((error: unknown) => ({
                    status: "failed" as const,
                    error: String(error),
                    sample: undefined,
                  }));
                  setTrial({
                    prompt,
                    text:
                      result.status === "ok"
                        ? t.settings.translationTest.ok(result.sample ?? "")
                        : result.status === "failed"
                          ? `${t.settings.translationTest.failed}: ${result.error ?? ""}`
                          : t.settings.translationTest[result.status],
                  });
                  setTrying(false);
                }}
              >
                {trying ? t.brief.card.loading : t.brief.card.settings.runTrial}
              </button>
              {trial && trial.prompt === prompt ? <p>{trial.text}</p> : null}
            </div>
          )}
        </CardRow>
      ) : null}
    </>
  );
}
