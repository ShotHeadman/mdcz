import { BATCH_TRANSLATE_MODES, type BriefParams, OPEN_TARGETS } from "@mdcz/shared/briefCatalog";
import type { MediaLibraryDto } from "@mdcz/shared/mediaLibrary";
import { LIBRARY_HEALTH_ISSUES } from "@mdcz/shared/serverDtos";
import { SECTION_ORDER } from "@mdcz/shared/settingsRegistry";
import { type Messages, useT } from "../i18n";
import { PosterStrip } from "../library/LibraryEditForm";
import type { BriefDestination } from "./BriefPort";
import {
  type BriefCardProps,
  basename,
  CardRow,
  CardShell,
  choiceOptions,
  describeValue,
  findDrop,
  LibrarySelect,
  OptionSelect,
  TextValue,
  useLoad,
} from "./cardParts";

type OpenParams = BriefParams["open"];

const FACETS = ["actor", "studio", "tag"] as const;
const POSTER_PAGE = 8;

/** Where the card's button goes; nothing runs, the page that owns the feature is the next step. */
export const openDestination = (params: OpenParams): BriefDestination | null => {
  if (params.target === "library")
    return {
      page: "library",
      search: {
        libraryId: params.libraryId,
        health: params.health,
        actor: params.actor,
        studio: params.studio,
        tag: params.tag,
      },
    };
  if (params.target === "settings") return { page: "settings", section: params.section };
  if (params.target === "amazonPoster") return { page: "amazonPoster", directory: params.directory };
  if (params.target === "batchTranslate")
    return { page: "batchTranslate", directory: params.directory, mode: params.mode };
  return null;
};

/** The destination as the outcome line names it, in the language it was opened in. */
const describeDestination = (t: Messages, params: OpenParams, libraries: readonly MediaLibraryDto[]): string => {
  const target = describeValue(t, "open", "target", params.target, libraries);
  if (params.target === "settings" && params.section)
    return `${target} · ${describeValue(t, "open", "section", params.section, libraries)}`;
  if (params.target === "library") {
    const filters = [
      params.libraryId ? describeValue(t, "open", "libraryId", params.libraryId, libraries) : "",
      params.actor ?? "",
      params.studio ?? "",
      params.tag ?? "",
      params.health ? describeValue(t, "open", "health", params.health, libraries) : "",
    ].filter(Boolean);
    return [target, ...filters].join(" · ");
  }
  return params.directory ? `${target} · ${basename(params.directory)}` : target;
};

/** A filtered library view, a settings section, or a browser-driven tool with its form filled in. */
export function OpenCard({ cell, libraries, port, onChange, onConfirmed }: BriefCardProps) {
  const t = useT();
  const params = cell.params as OpenParams;
  const target = params.target;
  const scope =
    target === "library"
      ? {
          libraryId: params.libraryId,
          health: params.health,
          actor: params.actor,
          studio: params.studio,
          tag: params.tag,
        }
      : null;
  const page = useLoad(
    async () => (scope ? await port.moviePage(scope, POSTER_PAGE) : null),
    scope ? JSON.stringify(scope) : null,
  );
  const destination = openDestination(params);
  const confirm = t.brief.card.confirm;
  const label =
    target === "library"
      ? confirm.openLibrary(page.data?.total ?? 0)
      : target === "settings"
        ? confirm.openSettings(params.section ? t.settingsFields.sections[params.section].label : "")
        : target === "amazonPoster"
          ? confirm.openAmazonPoster
          : target === "batchTranslate"
            ? confirm.openBatchTranslate
            : confirm.fallback;

  return (
    <CardShell
      confirmLabel={label}
      confirmDisabled={!destination || (target === "library" && !page.data?.total)}
      confirming={false}
      error={page.error}
      onConfirm={() => {
        if (!destination) return;
        port.open(destination);
        onConfirmed({ kind: "instant" }, { kind: "opened", destination: describeDestination(t, params, libraries) });
      }}
    >
      <CardRow label={t.brief.params.target} dropped={findDrop(cell, "target")}>
        {(id) => (
          <OptionSelect
            id={id}
            value={target}
            placeholder={t.brief.card.chooseDestination}
            options={choiceOptions(t, "open", "target", OPEN_TARGETS)}
            onChange={(value) => onChange({ target: value })}
          />
        )}
      </CardRow>
      {target === "library" ? (
        <>
          <CardRow label={t.brief.params.libraryId} dropped={findDrop(cell, "libraryId")}>
            {(id) => (
              <LibrarySelect
                id={id}
                libraries={libraries}
                value={params.libraryId}
                placeholder={t.brief.card.allLibraries}
                emptyLabel={t.brief.card.allLibraries}
                onChange={(libraryId) => onChange({ libraryId })}
              />
            )}
          </CardRow>
          <CardRow label={t.brief.card.filtersLabel} dropped={FACETS.map((key) => findDrop(cell, key)).find(Boolean)}>
            {(id) => (
              <div className="grid gap-2 sm:grid-cols-3">
                {FACETS.map((key, index) => (
                  <TextValue
                    key={key}
                    id={index === 0 ? id : `${id}-${key}`}
                    value={params[key] ?? ""}
                    placeholder={t.brief.params[key]}
                    onCommit={(value) => onChange({ [key]: value || undefined })}
                  />
                ))}
              </div>
            )}
          </CardRow>
          <CardRow label={t.brief.params.health} dropped={findDrop(cell, "health")}>
            {(id) => (
              <OptionSelect
                id={id}
                value={params.health ?? "any"}
                placeholder={t.brief.card.anyHealth}
                options={[
                  { value: "any", label: t.brief.card.anyHealth },
                  ...choiceOptions(t, "open", "health", LIBRARY_HEALTH_ISSUES),
                ]}
                onChange={(value) => onChange({ health: value === "any" ? undefined : value })}
              />
            )}
          </CardRow>
          <CardRow label={t.brief.card.moviesLabel}>
            {() => (
              <div className="space-y-2 sm:pt-2.5">
                {page.data?.entries.length ? (
                  <PosterStrip entries={page.data.entries} total={page.data.total} getPosterSrc={port.posterSrc} />
                ) : null}
                <p className="font-numeric text-sm">
                  {page.loading ? t.brief.card.loading : t.brief.card.movieCount(page.data?.total ?? 0)}
                </p>
              </div>
            )}
          </CardRow>
        </>
      ) : null}
      {target === "settings" ? (
        <CardRow label={t.brief.params.section} dropped={findDrop(cell, "section")}>
          {(id) => (
            <OptionSelect
              id={id}
              value={params.section}
              placeholder={t.brief.card.chooseSection}
              options={choiceOptions(t, "open", "section", SECTION_ORDER)}
              onChange={(section) => onChange({ section })}
            />
          )}
        </CardRow>
      ) : null}
      {target === "amazonPoster" || target === "batchTranslate" ? (
        <CardRow
          label={t.brief.params.directory}
          workedOut={cell.workedOut.includes("directory")}
          dropped={findDrop(cell, "directory")}
        >
          {(id) => (
            <TextValue
              id={id}
              value={params.directory ?? ""}
              mono
              onCommit={(directory) => onChange({ directory: directory || undefined })}
            />
          )}
        </CardRow>
      ) : null}
      {target === "batchTranslate" ? (
        <CardRow label={t.brief.params.mode} dropped={findDrop(cell, "mode")}>
          {(id) => (
            <OptionSelect
              id={id}
              value={params.mode ?? "untranslated"}
              placeholder={t.brief.card.chooseAction}
              options={choiceOptions(t, "open", "mode", BATCH_TRANSLATE_MODES)}
              onChange={(mode) => onChange({ mode })}
            />
          )}
        </CardRow>
      ) : null}
    </CardShell>
  );
}
