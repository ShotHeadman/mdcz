import { ASSET_NAMING_MODES, NFO_NAMING_MODES } from "@mdcz/shared/assetNaming";
import type { BriefParams } from "@mdcz/shared/briefCatalog";
import {
  AUTOMATION_LEVELS,
  DISCOVERY_MODES,
  type MediaLibraryDto,
  type MediaLibrarySettings,
  type MediaLibrarySettingsInput,
  mediaLibrarySettingsSchema,
  PLACEMENT_MODES,
} from "@mdcz/shared/mediaLibrary";
import { LIBRARY_HEALTH_ISSUES, type LibraryHealthIssue } from "@mdcz/shared/serverDtos";
import { useState } from "react";
import { useT } from "../i18n";
import { emptyLibrarySettings, Field, LibraryEditorFields, NamingPreview } from "../libraries/LibraryEditorDialog";
import type { BriefFieldRecord } from "./briefStore";
import {
  type BriefCardProps,
  CardRow,
  CardShell,
  ChangeRow,
  choiceOptions,
  describeValue,
  findDrop,
  LibrarySelect,
  OptionSelect,
  paramLabel,
  TextValue,
  useConfirm,
  useLoad,
} from "./cardParts";

type LibraryParams = BriefParams["library"];
type SettingKey = keyof MediaLibrarySettings;

const LIBRARY_ACTIONS = ["create", "update", "ignoreHealth", "restoreIgnored"] as const;
const SETTING_KEYS = Object.keys(mediaLibrarySettingsSchema.shape) as SettingKey[];
const CHOICES: Partial<Record<SettingKey, readonly string[]>> = {
  placement: PLACEMENT_MODES,
  assetNaming: ASSET_NAMING_MODES,
  nfoNaming: NFO_NAMING_MODES,
  automation: AUTOMATION_LEVELS,
  discovery: DISCOVERY_MODES,
};
// A template or the naming it feeds changes the names the library writes, so the card shows them.
const NAMING_KEYS: ReadonlySet<SettingKey> = new Set([
  "folderTemplate",
  "fileTemplate",
  "placement",
  "assetNaming",
  "nfoNaming",
]);

const savedSettings = (library: MediaLibraryDto): MediaLibrarySettings => {
  const { id: _id, createdAt: _created, updatedAt: _updated, ...settings } = library;
  return settings;
};

const settingsIn = (params: LibraryParams): Partial<MediaLibrarySettings> =>
  Object.fromEntries(SETTING_KEYS.flatMap((key) => (params[key] === undefined ? [] : [[key, params[key]]])));

/** Creating a library, changing one library's settings, or ignoring or restoring a health issue on its movies. */
export function LibraryCard(props: BriefCardProps) {
  const action = (props.cell.params as LibraryParams).action;
  return action === "create" ? (
    <CreateLibrary {...props} />
  ) : action === "update" ? (
    <UpdateLibrary {...props} />
  ) : (
    <LibraryMovies {...props} />
  );
}

function ActionRow({ cell, onChange }: Pick<BriefCardProps, "cell" | "onChange">) {
  const t = useT();
  return (
    <CardRow label={t.brief.params.action} dropped={findDrop(cell, "action")}>
      {(id) => (
        <OptionSelect
          id={id}
          value={(cell.params as LibraryParams).action}
          placeholder={t.brief.card.chooseAction}
          options={choiceOptions(t, "library", "action", LIBRARY_ACTIONS)}
          onChange={(action) => onChange({ action })}
        />
      )}
    </CardRow>
  );
}

function CreateLibrary({ cell, port, onChange, onConfirmed }: BriefCardProps) {
  const t = useT();
  const params = cell.params as LibraryParams;
  const settings: MediaLibrarySettingsInput = { ...emptyLibrarySettings(), ...settingsIn(params) };
  const parsed = mediaLibrarySettingsSchema.safeParse(settings);
  const { confirming, error, run } = useConfirm();
  const workedOut = cell.workedOut.map((key) => paramLabel(t, key, "library"));
  const dropped = cell.dropped.map(
    (drop) => `${paramLabel(t, drop.param, "library")}: ${t.brief.dropped[drop.reason](drop.value)}`,
  );
  return (
    <CardShell
      confirmLabel={t.brief.card.confirm.createLibrary(settings.name || "…")}
      confirmDisabled={!parsed.success}
      confirming={confirming}
      error={error}
      onConfirm={() =>
        void run(async () => {
          if (!parsed.success) return;
          const library = await port.createLibrary(parsed.data);
          onConfirmed(
            { kind: "instant" },
            { kind: "library", action: "create", name: library.name, libraryId: library.id },
          );
        })
      }
    >
      <div className="space-y-5">
        {/* The rest of the card is the library editor's form, so the action takes the editor's field layout too. */}
        <Field label={t.brief.params.action}>
          {(id) => (
            <OptionSelect
              id={id}
              value={params.action}
              placeholder={t.brief.card.chooseAction}
              options={choiceOptions(t, "library", "action", LIBRARY_ACTIONS)}
              onChange={(action) => onChange({ action })}
            />
          )}
        </Field>
        {workedOut.length || dropped.length ? (
          <div className="space-y-0.5 text-xs text-muted-foreground">
            {workedOut.length ? (
              <p className="underline decoration-dotted underline-offset-4">{t.brief.workedOutFields(workedOut)}</p>
            ) : null}
            {dropped.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        ) : null}
        <LibraryEditorFields
          settings={settings}
          showErrors={Boolean(settings.name && settings.sourcePath)}
          showAutomation={port.showLibraryAutomation}
          onChange={(patch) => onChange(patch, Object.keys(patch))}
          onPreviewNaming={port.previewNaming}
          loadDirectorySuggestions={port.suggestDirectory}
          browseDirectory={port.setup.browseDirectory}
        />
      </div>
    </CardShell>
  );
}

function UpdateLibrary({ cell, libraries, port, onChange, onConfirmed }: BriefCardProps) {
  const t = useT();
  const params = cell.params as LibraryParams;
  // The card reads the libraries itself, so a fresh read at Confirm can redraw the saved values it compares.
  const loaded = useLoad(() => port.libraries(), "libraries");
  const library = (loaded.data ?? libraries).find((candidate) => candidate.id === params.libraryId);
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const { confirming, error, run } = useConfirm();
  const changed = SETTING_KEYS.filter((key) => params[key] !== undefined);
  const saved = library ? savedSettings(library) : undefined;
  const ticked = changed.filter((key) => !unticked.has(key) && saved && saved[key] !== params[key]);
  const merged = saved ? { ...saved, ...Object.fromEntries(ticked.map((key) => [key, params[key]])) } : undefined;
  const parsed = merged ? mediaLibrarySettingsSchema.safeParse(merged) : undefined;
  const issues = new Map(
    parsed && !parsed.success
      ? parsed.error.issues.map((issue) => [String(issue.path[0]), t.libraries.issues[issue.message] ?? issue.message])
      : [],
  );

  return (
    <CardShell
      confirmLabel={t.brief.card.confirm.updateLibrary(ticked.length, library?.name ?? "…")}
      confirmDisabled={!library || ticked.length === 0 || !parsed?.success}
      confirming={confirming}
      error={error ?? notice}
      onConfirm={() =>
        void run(async () => {
          if (!library || !saved || !parsed?.success) return;
          // A fresh read: nothing is written over a value the user has not seen.
          const fresh = (await port.libraries()).find((candidate) => candidate.id === library.id);
          const stale = ticked.filter((key) => fresh?.[key] !== saved[key]);
          if (!fresh || stale.length) {
            setNotice(t.brief.card.settings.changedSince(stale.map((key) => paramLabel(t, key, "library")).join(", ")));
            loaded.reload();
            return;
          }
          await port.updateLibrary(library.id, parsed.data);
          const fields: BriefFieldRecord[] = ticked.map((key) => ({ key, before: saved[key], after: params[key] }));
          onConfirmed(
            { kind: "instant" },
            { kind: "library", action: "update", name: library.name, libraryId: library.id, fields },
          );
        })
      }
    >
      <ActionRow cell={cell} onChange={onChange} />
      <CardRow label={t.brief.params.libraryId} dropped={findDrop(cell, "libraryId")}>
        {(id) => (
          <LibrarySelect
            id={id}
            libraries={libraries}
            value={library?.id}
            placeholder={t.brief.card.chooseLibrary}
            onChange={(libraryId) => onChange({ libraryId })}
          />
        )}
      </CardRow>
      {changed.length === 0 ? <p className="text-sm text-muted-foreground">{t.brief.card.settings.noRows}</p> : null}
      {changed.map((key) => {
        const drop = findDrop(cell, key);
        const same = saved && saved[key] === params[key];
        return (
          <ChangeRow
            key={key}
            label={paramLabel(t, key, "library")}
            ticked={!unticked.has(key) && !same}
            workedOut={cell.workedOut.includes(key)}
            saved={saved ? describeValue(t, "library", key, saved[key], libraries) : undefined}
            notes={[
              ...(drop ? [{ text: t.brief.dropped[drop.reason](drop.value) }] : []),
              ...(same ? [{ text: t.brief.card.settings.reasons.unchanged }] : []),
              ...(issues.has(key) ? [{ text: issues.get(key) ?? "", tone: "error" as const }] : []),
            ]}
            onTick={(next) =>
              setUnticked((current) => {
                const updated = new Set(current);
                if (next) updated.delete(key);
                else updated.add(key);
                return updated;
              })
            }
          >
            {(id) =>
              CHOICES[key] ? (
                <OptionSelect
                  id={id}
                  value={params[key] as string}
                  placeholder={t.brief.card.settings.choose}
                  options={choiceOptions(t, "library", key, CHOICES[key] ?? [])}
                  onChange={(value) => onChange({ [key]: value }, [key])}
                />
              ) : (
                <TextValue
                  id={id}
                  type={key === "scanIntervalMinutes" ? "number" : undefined}
                  value={String(params[key] ?? "")}
                  mono={key !== "name"}
                  onCommit={(value) =>
                    onChange({ [key]: key === "scanIntervalMinutes" ? Number(value) : value || undefined }, [key])
                  }
                />
              )
            }
          </ChangeRow>
        );
      })}
      {merged && parsed?.success && ticked.some((key) => NAMING_KEYS.has(key)) ? (
        <NamingPreview settings={parsed.data} onPreviewNaming={port.previewNaming} />
      ) : null}
    </CardShell>
  );
}

/** Ignoring a health issue on a library's movies, or restoring the ignored ones: the Library page's own actions. */
function LibraryMovies({ cell, libraries, port, onChange, onConfirmed }: BriefCardProps) {
  const t = useT();
  const params = cell.params as LibraryParams;
  const restore = params.action === "restoreIgnored";
  const issue = params.issue as LibraryHealthIssue | undefined;
  const libraryId = params.libraryId;
  const library = libraries.find((candidate) => candidate.id === libraryId);
  const scope = restore ? { libraryId, ignored: true } : issue ? { libraryId, health: issue } : null;
  const count = useLoad(async () => (scope ? (await port.moviePage(scope, 1)).total : 0), JSON.stringify(scope));
  const { confirming, error, run } = useConfirm();
  const total = count.data ?? 0;
  const libraryName = library?.name ?? t.brief.card.allLibraries;

  return (
    <CardShell
      confirmLabel={
        params.action === "ignoreHealth"
          ? t.brief.card.confirm.ignoreHealth(total, issue ? t.library.health.issues[issue] : "…")
          : restore
            ? t.brief.card.confirm.restoreIgnored(total)
            : t.brief.card.confirm.fallback
      }
      confirmDisabled={!params.action || !scope || total === 0}
      confirming={confirming}
      error={error ?? count.error}
      onConfirm={() =>
        void run(async () => {
          if (restore) await port.restoreIgnored({ libraryId });
          else if (issue) await port.ignoreHealth({ libraryId, health: issue });
          else return;
          onConfirmed(
            { kind: "instant" },
            { kind: "library", action: restore ? "restoreIgnored" : "ignoreHealth", name: libraryName, count: total },
          );
        })
      }
    >
      <ActionRow cell={cell} onChange={onChange} />
      {params.action ? (
        <>
          <CardRow label={t.brief.params.libraryId} dropped={findDrop(cell, "libraryId")}>
            {(id) => (
              <LibrarySelect
                id={id}
                libraries={libraries}
                value={libraryId}
                placeholder={t.brief.card.allLibraries}
                emptyLabel={t.brief.card.allLibraries}
                onChange={(next) => onChange({ libraryId: next })}
              />
            )}
          </CardRow>
          {restore ? null : (
            <CardRow label={t.brief.params.issue} dropped={findDrop(cell, "issue")}>
              {(id) => (
                <OptionSelect
                  id={id}
                  value={issue}
                  placeholder={t.brief.card.chooseIssue}
                  options={choiceOptions(t, "library", "issue", LIBRARY_HEALTH_ISSUES)}
                  onChange={(value) => onChange({ issue: value })}
                />
              )}
            </CardRow>
          )}
          <CardRow label={t.brief.card.moviesLabel}>
            {() => (
              <p className="font-numeric text-sm leading-5 sm:pt-2.5">
                {count.loading ? t.brief.card.loading : t.brief.card.movieCount(total)}
              </p>
            )}
          </CardRow>
        </>
      ) : null}
    </CardShell>
  );
}
