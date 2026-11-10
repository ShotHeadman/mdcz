import { toUniqueActorNames } from "@mdcz/shared/actorAliases";
import type { NfoField } from "@mdcz/shared/config";
import {
  applyLibraryEdit,
  LIBRARY_EDIT_FIELDS,
  type LibraryEdit,
  type LibraryEditStartInput,
  libraryEditSchema,
} from "@mdcz/shared/libraryEdit";
import type { LibraryEntryDto } from "@mdcz/shared/serverDtos";
import { Button, Checkbox, Input } from "@mdcz/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useId, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";

export interface LibraryEditFormProps {
  entries: LibraryEntryDto[];
  ignoredFields: readonly NfoField[];
  submitting?: boolean;
  blockedReason?: string;
  onCancel?: () => void;
  onSubmit: (input: LibraryEditStartInput) => void;
}

export function LibraryEditForm({
  entries,
  ignoredFields,
  submitting,
  blockedReason,
  onCancel,
  onSubmit,
}: LibraryEditFormProps) {
  const inputId = useId();
  const t = useT();
  const labels = t.library.edit;
  const [field, setField] = useState<LibraryEdit["field"]>(
    () => LIBRARY_EDIT_FIELDS.find((field) => field === "actors" || !ignoredFields.includes(field)) ?? "actors",
  );
  const [operation, setOperation] = useState<LibraryEdit["operation"]>(
    field === "actors" || field === "genres" ? "add" : "set",
  );
  const [value, setValue] = useState("");
  const [from, setFrom] = useState("");
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const listField = field === "genres" || field === "actors";
  const operations = listField ? (["add", "remove", "rename"] as const) : (["set", "clear"] as const);
  const values = useMemo(() => {
    const names = entries.flatMap((entry) => {
      const current = entry.crawlerData?.[field];
      return Array.isArray(current) ? current : current ? [current] : [];
    });
    return (field === "actors" ? toUniqueActorNames(names) : [...new Set(names)]).sort((a, b) => a.localeCompare(b));
  }, [entries, field]);
  const edit = useMemo(() => {
    const parsed = libraryEditSchema.safeParse({
      field,
      operation,
      value: operation === "remove" ? from || values[0] : value,
      from: from || values[0],
      to: value,
    });
    return parsed.success ? parsed.data : null;
  }, [field, operation, value, from, values]);
  const rows = useMemo(
    () =>
      entries.map((entry) => ({
        entry,
        next: edit && entry.crawlerData ? applyLibraryEdit(entry.crawlerData, edit) : null,
      })),
    [entries, edit],
  );
  const changed = rows.filter((row) => row.next !== null).length;
  const ids = rows.filter((row) => row.next !== null && !excluded.has(row.entry.id)).map((row) => row.entry.id);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 76,
    overscan: 6,
  });
  const display = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value.join(", ") || "—" : value || "—";
  const fieldDisabled = field !== "actors" && ignoredFields.includes(field);
  const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

  return (
    <form
      className="flex min-h-0 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (edit && ids.length && !fieldDisabled && !submitting && !blockedReason) onSubmit({ ids, edit });
      }}
    >
      <fieldset className="grid gap-3 sm:grid-cols-2" disabled={submitting}>
        <div className="grid gap-1 text-sm">
          <label htmlFor={`${inputId}-field`}>{labels.field}</label>
          <select
            id={`${inputId}-field`}
            className={selectClass}
            value={field}
            onChange={(event) => {
              const next = event.target.value as LibraryEdit["field"];
              setField(next);
              setOperation(next === "actors" || next === "genres" ? "add" : "set");
              setFrom("");
              setValue("");
              setExcluded(new Set());
            }}
          >
            {LIBRARY_EDIT_FIELDS.map((field) => {
              const disabled = field !== "actors" && ignoredFields.includes(field);
              return (
                <option key={field} value={field} disabled={disabled}>
                  {field === "genres" ? labels.genres : t.nfo.editor.fields[field]}
                  {disabled ? ` — ${labels.excluded}` : ""}
                </option>
              );
            })}
          </select>
        </div>
        <div className="grid gap-1 text-sm">
          <label htmlFor={`${inputId}-operation`}>{labels.operation}</label>
          <select
            id={`${inputId}-operation`}
            className={selectClass}
            value={operation}
            onChange={(event) => setOperation(event.target.value as LibraryEdit["operation"])}
          >
            {operations.map((operation) => (
              <option key={operation} value={operation}>
                {labels.operations[operation]}
              </option>
            ))}
          </select>
        </div>
        {(operation === "remove" || operation === "rename") && (
          <div className="grid gap-1 text-sm">
            <label htmlFor={`${inputId}-from`}>{labels.from}</label>
            <select
              id={`${inputId}-from`}
              className={selectClass}
              value={from || values[0] || ""}
              onChange={(event) => setFrom(event.target.value)}
            >
              <option value="" disabled>
                —
              </option>
              {values.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}
        {operation !== "clear" && operation !== "remove" && (
          <label htmlFor={inputId} className="grid gap-1 text-sm">
            {operation === "rename" ? labels.to : labels.value}
            <Input id={inputId} value={value} onChange={(event) => setValue(event.target.value)} />
          </label>
        )}
      </fieldset>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {labels.estimate(changed, entries.length - changed)}
      </p>
      <div className="h-[min(45vh,420px)] overflow-y-auto rounded-md border" ref={scrollRef}>
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const { entry, next } = rows[item.index];
            const name = entry.number || entry.title || entry.id;
            return (
              <div
                key={entry.id}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-3 border-b p-3 text-sm"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <Checkbox
                  aria-label={t.library.selectEntry(name)}
                  checked={next !== null && !excluded.has(entry.id)}
                  disabled={next === null || submitting}
                  onCheckedChange={(checked) =>
                    setExcluded((current) => {
                      const result = new Set(current);
                      if (checked === true) result.delete(entry.id);
                      else result.add(entry.id);
                      return result;
                    })
                  }
                />
                <div className="min-w-0">
                  <strong className="font-mono">{name}</strong>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3 break-words">
                    <span className="text-muted-foreground">
                      <span className="sr-only">{labels.oldValue}: </span>
                      {display(entry.crawlerData?.[field])}
                    </span>
                    <span aria-hidden="true">→</span>
                    <span>
                      <span className="sr-only">{labels.newValue}: </span>
                      {next ? display(next[field]) : labels.noChange}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {(blockedReason || fieldDisabled) && (
        <p className="text-sm text-destructive">{blockedReason || labels.excluded}</p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t.common.cancel}
          </Button>
        )}
        <Button type="submit" disabled={!ids.length || submitting || !edit || fieldDisabled || Boolean(blockedReason)}>
          {labels.confirm(ids.length)}
        </Button>
      </div>
    </form>
  );
}
