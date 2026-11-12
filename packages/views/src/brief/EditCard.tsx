import type { BriefParams } from "@mdcz/shared/briefCatalog";
import type { Configuration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import type { LibraryEntryDto } from "@mdcz/shared/serverDtos";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { type LibraryEditDraft, LibraryEditForm } from "../library/LibraryEditForm";
import {
  type BriefCardProps,
  CardRow,
  DRAFT_OUTLINE_CLASS,
  describeDrop,
  findDrop,
  LibrarySelect,
  paramLabel,
  TextValue,
} from "./cardParts";

const FILTER_KEYS = ["actor", "studio", "tag", "query"] as const;

/**
 * Movies are never named by the model: its filter pages the library, and the Library's own edit form shows every
 * matching movie with its old and new value. Confirm is that form's submit.
 */
export function EditCard({
  cell,
  config,
  libraries,
  port,
  onChange,
  onConfirmed,
}: BriefCardProps & { config?: Configuration }) {
  const t = useT();
  const params = cell.params as BriefParams["edit"];
  const filter = Object.fromEntries(
    (["libraryId", ...FILTER_KEYS] as const).flatMap((key) => (params[key] ? [[key, params[key]]] : [])),
  );
  const filterKey = JSON.stringify(filter);
  const [entries, setEntries] = useState<LibraryEntryDto[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setEntries(null);
    port.movies(JSON.parse(filterKey)).then(
      (movies) => current && setEntries(movies),
      (loadError) => current && setError(toErrorMessage(loadError)),
    );
    return () => {
      current = false;
    };
  }, [port, filterKey]);

  const reportDraft = (draft: LibraryEditDraft) => {
    const patch = Object.fromEntries(
      (["field", "operation", "value", "from"] as const).flatMap((key) => {
        const value = draft[key] || undefined;
        return value === params[key] ? [] : [[key, value]];
      }),
    );
    if (Object.keys(patch).length) onChange(patch);
  };
  const editNotes = (["field", "operation", "value", "from"] as const).flatMap((key) => {
    const drop = findDrop(cell, key);
    if (drop) return [`${paramLabel(t, key)}: ${describeDrop(t, drop)}`];
    return cell.workedOut.includes(key) ? [`${paramLabel(t, key)}: ${t.brief.workedOut}`] : [];
  });

  return (
    <div className={DRAFT_OUTLINE_CLASS}>
      <CardRow label={t.brief.params.libraryId} dropped={findDrop(cell, "libraryId")}>
        {(id) => (
          <LibrarySelect
            id={id}
            libraries={libraries}
            value={params.libraryId}
            placeholder={t.brief.card.allLibraries}
            emptyLabel={t.brief.card.allLibraries}
            onChange={(next) => onChange({ libraryId: next })}
          />
        )}
      </CardRow>
      {FILTER_KEYS.map((key) => (
        <CardRow
          key={key}
          label={paramLabel(t, key)}
          workedOut={cell.workedOut.includes(key)}
          dropped={findDrop(cell, key)}
        >
          {(id) => (
            <TextValue
              id={id}
              value={params[key] ?? ""}
              onCommit={(value) => onChange({ [key]: value || undefined })}
            />
          )}
        </CardRow>
      ))}
      {editNotes.length ? (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {editNotes.map((note) => (
            <li key={note} className="underline decoration-dotted underline-offset-4">
              {note}
            </li>
          ))}
        </ul>
      ) : null}
      {entries === null ? (
        <p className="text-sm text-muted-foreground">{t.brief.card.loading}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.brief.card.noMovies}</p>
      ) : (
        <LibraryEditForm
          key={`${cell.revision}:${filterKey}`}
          entries={entries}
          ignoredFields={config?.download.nfoIgnoreFields ?? []}
          initial={{ field: params.field, operation: params.operation, value: params.value, from: params.from }}
          onDraftChange={reportDraft}
          getPosterSrc={port.posterSrc}
          submitting={submitting}
          onSubmit={async (input) => {
            setSubmitting(true);
            setError(null);
            try {
              onConfirmed({ kind: "edit", jobId: await port.startEdit(input) });
            } catch (startError) {
              setError(toErrorMessage(startError));
            } finally {
              setSubmitting(false);
            }
          }}
        />
      )}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
