import { isAbsoluteHostPath } from "@mdcz/shared/mediaCandidate";
import { useT } from "../i18n";
import {
  type BriefCardProps,
  basename,
  CardRow,
  CardShell,
  findDrop,
  LibrarySelect,
  TextValue,
  useConfirm,
} from "./cardParts";

/** One file, today's single-file tool: optionally from a given detail page or with a corrected number. */
export function ScrapeFileCard({ cell, libraries, port, onChange, onConfirmed }: BriefCardProps) {
  const t = useT();
  const params = cell.params;
  const file = typeof params.file === "string" ? params.file : "";
  const library = libraries.find((candidate) => candidate.id === params.libraryId);
  const { confirming, error, run } = useConfirm();
  const text = (key: "file" | "url" | "number") => (typeof params[key] === "string" ? (params[key] as string) : "");

  return (
    <CardShell
      confirmLabel={t.brief.card.confirm.scrapeFile(basename(file) || "…", library?.name ?? "…")}
      confirmDisabled={!library || !isAbsoluteHostPath(file)}
      confirming={confirming}
      error={error}
      onConfirm={() => {
        if (!library) return;
        void run(async () => {
          const taskId = await port.startScrape({
            executionMode: "single",
            libraryId: library.id,
            refs: [await port.fileRef(file)],
            manualUrl: text("url") || undefined,
            number: text("number") || undefined,
          });
          onConfirmed({ kind: "scrape", taskIds: [taskId] });
        });
      }}
    >
      {(["file", "url", "number"] as const).map((key) => (
        <CardRow
          key={key}
          label={t.brief.params[key]}
          workedOut={cell.workedOut.includes(key)}
          dropped={findDrop(cell, key)}
        >
          {(id) => (
            <TextValue
              id={id}
              value={text(key)}
              mono={key !== "url"}
              onCommit={(value) => onChange({ [key]: value || undefined })}
            />
          )}
        </CardRow>
      ))}
      <CardRow label={t.brief.params.libraryId} dropped={findDrop(cell, "libraryId")}>
        {(id) => (
          <LibrarySelect
            id={id}
            libraries={libraries}
            value={library?.id}
            placeholder={t.brief.card.chooseLibrary}
            onChange={(next) => onChange({ libraryId: next })}
          />
        )}
      </CardRow>
    </CardShell>
  );
}
