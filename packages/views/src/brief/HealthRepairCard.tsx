import { toErrorMessage } from "@mdcz/shared/error";
import { LIBRARY_HEALTH_ISSUES, type LibraryEntryDto, type LibraryHealthIssue } from "@mdcz/shared/serverDtos";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { HEALTH_FIX_PRESETS } from "../library/healthIssues";
import { type BriefCardProps, CardRow, CardShell, findDrop, LibrarySelect, OptionSelect } from "./cardParts";

/** A repair of the movies one library health issue lists: the refresh the library page's Fix starts. */
export function HealthRepairCard({ cell, libraries, port, onChange, onConfirmed }: BriefCardProps) {
  const t = useT();
  const issue = cell.params.issue as LibraryHealthIssue | undefined;
  const libraryId = typeof cell.params.libraryId === "string" ? cell.params.libraryId : undefined;
  const [entries, setEntries] = useState<LibraryEntryDto[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!issue) {
      setEntries([]);
      return;
    }
    let current = true;
    setEntries(null);
    port.movies({ libraryId, health: issue }).then(
      (movies) => current && setEntries(movies),
      (loadError) => current && setError(toErrorMessage(loadError)),
    );
    return () => {
      current = false;
    };
  }, [port, issue, libraryId]);

  const presetId = issue ? HEALTH_FIX_PRESETS[issue] : undefined;
  const refs = (entries ?? []).flatMap((entry) =>
    entry.fileRefs.map((file) => ({ rootId: file.rootId, relativePath: file.relativePath })),
  );
  // A maintenance session works inside one media root.
  const mixedRoots = new Set(refs.map((ref) => ref.rootId)).size > 1;

  return (
    <CardShell
      confirmLabel={t.brief.card.confirm.repairIssue(entries?.length ?? 0)}
      confirmDisabled={!presetId || refs.length === 0 || mixedRoots}
      confirming={confirming}
      error={error ?? (mixedRoots ? t.library.health.mixedRoots : issue && !presetId ? t.brief.card.noRepair : null)}
      onConfirm={async () => {
        const rootId = refs[0]?.rootId;
        if (!presetId || !rootId) return;
        setConfirming(true);
        setError(null);
        try {
          onConfirmed({
            kind: "maintenance",
            sessionId: await port.startMaintenance({ rootId, presetId, refs, libraryId }),
          });
        } catch (startError) {
          setError(toErrorMessage(startError));
        } finally {
          setConfirming(false);
        }
      }}
    >
      <CardRow label={t.brief.params.issue} dropped={findDrop(cell, "issue")}>
        {(id) => (
          <OptionSelect
            id={id}
            value={issue}
            placeholder={t.brief.card.chooseIssue}
            options={LIBRARY_HEALTH_ISSUES.map((value) => ({ value, label: t.library.health.issues[value] }))}
            onChange={(value) => onChange({ issue: value })}
          />
        )}
      </CardRow>
      <CardRow label={t.brief.params.libraryId} dropped={findDrop(cell, "libraryId")}>
        {(id) => (
          <LibrarySelect
            id={id}
            libraries={libraries}
            value={libraryId}
            placeholder={t.brief.card.chooseLibrary}
            emptyLabel={t.brief.card.allLibraries}
            onChange={(next) => onChange({ libraryId: next })}
          />
        )}
      </CardRow>
      <CardRow label={t.brief.card.moviesLabel}>
        {() => (
          <p className="text-sm leading-5 sm:pt-2.5">
            {entries === null
              ? t.brief.card.loading
              : entries.length === 0
                ? t.brief.card.noMovies
                : entries
                    .slice(0, 6)
                    .map((entry) => entry.number || entry.title || entry.id)
                    .join(" · ") + (entries.length > 6 ? ` · +${entries.length - 6}` : "")}
          </p>
        )}
      </CardRow>
    </CardShell>
  );
}
