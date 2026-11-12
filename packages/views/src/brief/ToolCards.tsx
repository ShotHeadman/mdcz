import { type BriefParams, MEDIA_SERVERS, type MediaServerId } from "@mdcz/shared/briefCatalog";
import { isAbsoluteHostPath } from "@mdcz/shared/mediaCandidate";
import { configProfileNameInputSchema } from "@mdcz/shared/serverDtos";
import { Checkbox } from "@mdcz/ui";
import { useId, useState } from "react";
import { useT } from "../i18n";
import { ConnectionCheckResult, PERSON_SERVER_NAMES } from "../tools/details/PersonMediaLibraryDetail";
import type { SymlinkResult } from "./BriefPort";
import {
  type BriefCardProps,
  basename,
  CardRow,
  CardShell,
  choiceOptions,
  findDrop,
  OptionSelect,
  TextValue,
  useConfirm,
  useLoad,
} from "./cardParts";

/** Person sync, with the server's connection check the media server tools run first. */
export function PersonSyncCard({ cell, port, onChange, onConfirmed }: BriefCardProps) {
  const t = useT();
  const params = cell.params as BriefParams["person-sync"];
  const action = params.action ?? "sync";
  const server: MediaServerId | undefined = action === "stopNameMatching" ? "jellyfin" : params.server;
  const kind = params.kind ?? "info";
  const mode = params.mode ?? "missing";
  const check = useLoad(async () => (server ? await port.checkMediaServer(server) : null), server ?? null);
  const { confirming, error, run } = useConfirm();
  const serverName = server ? PERSON_SERVER_NAMES[server] : "…";

  return (
    <CardShell
      confirmLabel={
        action === "sync"
          ? t.brief.card.confirm.personSync(kind, mode, serverName)
          : t.brief.card.confirm.stopNameMatching
      }
      confirmDisabled={!server}
      confirming={confirming}
      error={error ?? check.error}
      onConfirm={() =>
        void run(async () => {
          if (!server) return;
          if (action === "stopNameMatching") {
            await port.stopNameMatching();
            onConfirmed({ kind: "instant" }, { kind: "name-matching" });
            return;
          }
          onConfirmed({ kind: "person-sync", jobId: await port.startPersonSync({ server, kind, mode }) });
        })
      }
    >
      <CardRow label={t.brief.params.action} dropped={findDrop(cell, "action")}>
        {(id) => (
          <OptionSelect
            id={id}
            value={action}
            placeholder={t.brief.card.chooseAction}
            options={choiceOptions(t, "person-sync", "action", ["sync", "stopNameMatching"] as const)}
            onChange={(value) => onChange({ action: value })}
          />
        )}
      </CardRow>
      <CardRow label={t.brief.params.server} dropped={findDrop(cell, "server")}>
        {(id) => (
          <OptionSelect
            id={id}
            value={server}
            placeholder={t.brief.card.chooseServer}
            disabled={action === "stopNameMatching"}
            options={choiceOptions(t, "person-sync", "server", MEDIA_SERVERS)}
            onChange={(value) => onChange({ server: value })}
          />
        )}
      </CardRow>
      {action === "sync" ? (
        <>
          <CardRow label={t.brief.params.kind} dropped={findDrop(cell, "kind")}>
            {(id) => (
              <OptionSelect
                id={id}
                value={kind}
                placeholder={t.brief.card.chooseAction}
                options={choiceOptions(t, "person-sync", "kind", ["info", "photo"] as const)}
                onChange={(value) => onChange({ kind: value })}
              />
            )}
          </CardRow>
          <CardRow label={t.brief.params.mode} dropped={findDrop(cell, "mode")}>
            {(id) => (
              <OptionSelect
                id={id}
                value={mode}
                placeholder={t.brief.card.chooseAction}
                options={choiceOptions(t, "person-sync", "mode", ["missing", "all"] as const)}
                onChange={(value) => onChange({ mode: value })}
              />
            )}
          </CardRow>
        </>
      ) : null}
      {server ? (
        check.data ? (
          <ConnectionCheckResult server={server} result={check.data} />
        ) : check.loading ? (
          <p className="text-sm text-muted-foreground">{t.tools.checkingConnection}</p>
        ) : null
      ) : null}
    </CardShell>
  );
}

/** The symlink manager, with the links its dry run plans; the request runs while the cell waits for its answer. */
export function SymlinkCard({ cell, port, onChange, onRequest }: BriefCardProps) {
  const t = useT();
  const copyId = useId();
  const params = cell.params as BriefParams["symlink"];
  const sourceDir = params.sourceDir ?? "";
  const destDir = params.destDir ?? "";
  const copyFiles = params.copyFiles ?? false;
  const [showAll, setShowAll] = useState(false);
  const ready = isAbsoluteHostPath(sourceDir) && isAbsoluteHostPath(destDir);
  const input = { sourceDir, destDir, copyFiles };
  const dryRun = useLoad(() => port.symlink({ ...input, dryRun: true }), ready ? JSON.stringify(input) : null);
  const planned = dryRun.data?.planned ?? [];

  return (
    <CardShell
      confirmLabel={t.brief.card.confirm.symlink(planned.length, copyFiles)}
      confirmDisabled={!dryRun.data || planned.length === 0}
      confirming={false}
      error={dryRun.error}
      onConfirm={() =>
        onRequest(async () => {
          const result: SymlinkResult = await port.symlink({ ...input, dryRun: false });
          return { outcome: { kind: "symlink", ...result }, result };
        })
      }
      footer={
        <label htmlFor={copyId} className="inline-flex cursor-pointer items-center gap-2">
          <Checkbox
            id={copyId}
            checked={copyFiles}
            onCheckedChange={(checked) => onChange({ copyFiles: checked === true })}
          />
          {t.tools.syncSidecarFiles}
        </label>
      }
    >
      {(["sourceDir", "destDir"] as const).map((key) => (
        <CardRow
          key={key}
          label={t.brief.params[key]}
          workedOut={cell.workedOut.includes(key)}
          dropped={findDrop(cell, key)}
        >
          {(id) => (
            <TextValue
              id={id}
              value={params[key] ?? ""}
              mono
              onCommit={(value) => onChange({ [key]: value || undefined })}
            />
          )}
        </CardRow>
      ))}
      <CardRow label={t.brief.card.plannedLabel}>
        {() => (
          <div className="space-y-1 text-sm leading-5 sm:pt-2.5">
            <p className="font-numeric">
              {!ready
                ? t.brief.empty
                : dryRun.loading
                  ? t.brief.card.scanning
                  : t.brief.card.plannedLinks(planned.length, dryRun.data?.skipped ?? 0)}
            </p>
            {planned.length ? (
              <ul className="space-y-0.5 font-mono text-xs text-muted-foreground">
                {(showAll ? planned : planned.slice(0, 6)).map((path) => (
                  <li key={path} className="truncate" title={path}>
                    {basename(path)}
                  </li>
                ))}
              </ul>
            ) : null}
            {planned.length > 6 ? (
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => setShowAll((shown) => !shown)}
              >
                {showAll ? `▾ ${t.brief.card.hideFiles}` : `▸ ${t.brief.card.showFiles}`}
              </button>
            ) : null}
          </div>
        )}
      </CardRow>
    </CardShell>
  );
}

/** Switching to a configuration profile, or creating one. */
export function ProfileCard({ cell, port, onChange, onConfirmed }: BriefCardProps) {
  const t = useT();
  const params = cell.params as BriefParams["profile"];
  const action = params.action;
  const name = params.name ?? "";
  const profiles = useLoad(() => port.profiles(), "profiles");
  const { confirming, error, run } = useConfirm();
  const active = profiles.data?.active ?? "";
  const exists = profiles.data?.profiles.includes(name) ?? false;
  const valid =
    action === "switch"
      ? exists && name !== active
      : action === "create" && !exists && configProfileNameInputSchema.safeParse({ name }).success;

  return (
    <CardShell
      confirmLabel={
        action === "create"
          ? t.brief.card.confirm.createProfile(name || "…")
          : t.brief.card.confirm.switchProfile(name || "…")
      }
      confirmDisabled={!profiles.data || !valid}
      confirming={confirming}
      error={error ?? profiles.error}
      onConfirm={() =>
        void run(async () => {
          if (action === "switch") await port.switchProfile(name);
          else if (action === "create") await port.createProfile(name);
          else return;
          onConfirmed({ kind: "instant" }, { kind: "profile", action, name, previous: active });
        })
      }
    >
      <CardRow label={t.brief.params.action} dropped={findDrop(cell, "action")}>
        {(id) => (
          <OptionSelect
            id={id}
            value={action}
            placeholder={t.brief.card.chooseAction}
            options={choiceOptions(t, "profile", "action", ["switch", "create"] as const)}
            onChange={(value) => onChange({ action: value })}
          />
        )}
      </CardRow>
      <CardRow label={t.brief.card.currentProfile}>
        {() => <p className="text-sm leading-5 sm:pt-2.5">{active || t.brief.card.loading}</p>}
      </CardRow>
      <CardRow
        label={t.brief.params.profileName}
        workedOut={cell.workedOut.includes("name")}
        dropped={findDrop(cell, "name")}
      >
        {(id) =>
          action === "switch" ? (
            <OptionSelect
              id={id}
              value={exists ? name : undefined}
              placeholder={t.brief.card.chooseProfile}
              options={(profiles.data?.profiles ?? [])
                .filter((profile) => profile !== active)
                .map((profile) => ({ value: profile, label: profile }))}
              onChange={(value) => onChange({ name: value })}
            />
          ) : (
            <TextValue id={id} value={name} onCommit={(value) => onChange({ name: value || undefined })} />
          )
        }
      </CardRow>
      {action === "create" && name && !valid ? (
        <p className="text-xs text-muted-foreground">
          {exists ? t.brief.dropped.exists(name) : t.brief.dropped.invalid(name)}
        </p>
      ) : null}
    </CardShell>
  );
}
