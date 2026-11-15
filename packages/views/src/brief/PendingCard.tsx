import { type BriefParams, matchPendingItems } from "@mdcz/shared/briefCatalog";
import { toErrorMessage } from "@mdcz/shared/error";
import { PENDING_KINDS, type PendingItemDto } from "@mdcz/shared/pending";
import { Checkbox, cn } from "@mdcz/ui";
import { useEffect, useId, useState } from "react";
import { useT } from "../i18n";
import { PendingItemSummary } from "../pending/PendingParts";
import { type BriefCardProps, CardRow, CardShell, findDrop, LibrarySelect, OptionSelect, TextValue } from "./cardParts";

type PendingAction = NonNullable<BriefParams["pending"]["action"]>;

const fits = (action: PendingAction | undefined, item: PendingItemDto): boolean =>
  action === "confirm" ? item.kind === "uncensored" : action === "ignore" || item.kind !== "uncensored";

/** Files are never named by the model: its filters run over the pending list, and the card lists what they match. */
export function PendingCard({ cell, libraries, port, onChange, onConfirmed }: BriefCardProps) {
  const t = useT();
  const params = cell.params as BriefParams["pending"];
  const action = params.action;
  const [items, setItems] = useState<PendingItemDto[] | null>(null);
  const [ticks, setTicks] = useState<{ key: string; ids: ReadonlySet<string> } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    port.pendingItems().then(
      (loaded) => current && setItems(loaded),
      (loadError) => current && setError(toErrorMessage(loadError)),
    );
    return () => {
      current = false;
    };
  }, [port]);

  const eligible = matchPendingItems(items ?? [], params).filter((item) => fits(action, item));
  // New filters start the ticks over: everything they match, or for a repair the one file when only one matches.
  const ticksKey = `${action}\n${eligible.map((item) => item.id).join("\n")}`;
  const ticked =
    ticks?.key === ticksKey
      ? eligible.filter((item) => ticks.ids.has(item.id))
      : action === "repair"
        ? eligible.length === 1
          ? eligible
          : []
        : eligible;
  const target = typeof params.targetLibraryId === "string" ? params.targetLibraryId : undefined;
  const repairTarget = ticked.length === 1 ? (target ?? ticked[0]?.libraryId ?? undefined) : undefined;
  const choice = params.choice;
  const confirmLabel =
    action === "retry"
      ? t.brief.card.confirm.retry(ticked.length)
      : action === "repair"
        ? t.brief.card.confirm.repairFile(ticked[0]?.fileName ?? "…")
        : action === "confirm"
          ? t.brief.card.confirm.confirmType(ticked.length, choice ? t.pending.confirmTypes[choice] : "…")
          : action === "ignore"
            ? t.brief.card.confirm.ignore(ticked.length)
            : t.brief.card.confirm.fallback;
  const confirmDisabled =
    !action ||
    ticked.length === 0 ||
    (action === "repair" && (ticked.length !== 1 || !repairTarget || !(params.number || params.url))) ||
    (action === "confirm" && !choice);

  const toggle = (id: string) => {
    const ids = new Set(ticked.map((item) => item.id));
    if (!ids.delete(id)) {
      if (action === "repair") ids.clear();
      ids.add(id);
    }
    setTicks({ key: ticksKey, ids });
  };

  const confirm = async () => {
    const ids = ticked.map((item) => item.id);
    if (action === "retry") {
      onConfirmed({ kind: "scrape", taskIds: await port.retryPendingMany({ ids, libraryId: target }) });
    } else if (action === "repair" && repairTarget) {
      const taskId = await port.retryPending({
        id: ids[0] ?? "",
        libraryId: repairTarget,
        number: params.number,
        manualUrl: params.url,
      });
      onConfirmed({ kind: "scrape", taskIds: [taskId] });
    } else if (action === "confirm" && choice) {
      await port.confirmUncensored({ ids, choice });
      onConfirmed({ kind: "instant" }, { kind: "pending", action: "confirm", count: ids.length, choice });
    } else if (action === "ignore") {
      await port.ignorePending(ids);
      onConfirmed({ kind: "instant" }, { kind: "pending", action: "ignore", count: ids.length });
    }
  };

  return (
    <CardShell
      confirmLabel={confirmLabel}
      confirmDisabled={confirmDisabled}
      confirming={confirming}
      error={
        error ?? (action === "repair" && ticked.length !== 1 ? t.brief.card.repairNeedsOne(eligible.length) : null)
      }
      onConfirm={async () => {
        setConfirming(true);
        setError(null);
        try {
          await confirm();
        } catch (confirmError) {
          setError(toErrorMessage(confirmError));
        } finally {
          setConfirming(false);
        }
      }}
    >
      <CardRow label={t.brief.params.action} dropped={findDrop(cell, "action")}>
        {(id) => (
          <OptionSelect
            id={id}
            value={action}
            placeholder={t.brief.card.chooseAction}
            options={(["retry", "repair", "confirm", "ignore"] as const).map((value) => ({
              value,
              label: t.brief.pendingActions[value],
            }))}
            onChange={(value) => onChange({ action: value })}
          />
        )}
      </CardRow>
      <CardRow label={t.brief.params.kinds} dropped={findDrop(cell, "kinds")}>
        {() => (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {PENDING_KINDS.filter((kind) => items?.some((item) => item.kind === kind)).map((kind) => {
              const selected = params.kinds?.includes(kind) ?? false;
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={selected}
                  className={cn(
                    "rounded-quiet border px-2 py-0.5 text-xs transition-colors",
                    selected ? "border-foreground text-foreground" : "border-border/60 text-muted-foreground",
                  )}
                  onClick={() => {
                    const kinds = selected
                      ? (params.kinds ?? []).filter((entry) => entry !== kind)
                      : [...(params.kinds ?? []), kind];
                    onChange({ kinds: kinds.length ? kinds : undefined });
                  }}
                >
                  {t.pending.kinds[kind]}
                </button>
              );
            })}
          </div>
        )}
      </CardRow>
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
      <CardRow label={t.brief.params.name} workedOut={cell.workedOut.includes("name")} dropped={findDrop(cell, "name")}>
        {(id) => (
          <TextValue
            id={id}
            value={params.name ?? ""}
            mono
            onCommit={(value) => onChange({ name: value || undefined })}
          />
        )}
      </CardRow>
      {action === "retry" || action === "repair" ? (
        <CardRow label={t.brief.params.targetLibraryId} dropped={findDrop(cell, "targetLibraryId")}>
          {(id) => (
            <LibrarySelect
              id={id}
              libraries={libraries}
              value={target}
              placeholder={t.brief.card.ownLibraries}
              emptyLabel={t.brief.card.ownLibraries}
              onChange={(next) => onChange({ targetLibraryId: next })}
            />
          )}
        </CardRow>
      ) : null}
      {action === "repair"
        ? (["number", "url"] as const).map((key) => (
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
                  mono={key === "number"}
                  placeholder={key === "number" ? t.pending.numberPlaceholder : t.pending.manualUrlPlaceholder}
                  onCommit={(value) => onChange({ [key]: value || undefined })}
                />
              )}
            </CardRow>
          ))
        : null}
      {action === "confirm" ? (
        <CardRow label={t.brief.params.choice} dropped={findDrop(cell, "choice")}>
          {(id) => (
            <OptionSelect
              id={id}
              value={choice}
              placeholder={t.brief.card.chooseType}
              options={(["uncensored", "umr", "leak"] as const).map((value) => ({
                value,
                label: t.pending.confirmTypes[value],
              }))}
              onChange={(value) => onChange({ choice: value })}
            />
          )}
        </CardRow>
      ) : null}
      <div className="-mx-5 max-h-[22rem] overflow-y-auto border-t border-border/60">
        {items === null ? (
          <p className="px-5 py-3 text-sm text-muted-foreground">{t.brief.card.loading}</p>
        ) : eligible.length === 0 ? (
          <p className="px-5 py-3 text-sm text-muted-foreground">{t.brief.card.noPending}</p>
        ) : (
          eligible.map((item) => (
            <PendingRow
              key={item.id}
              item={item}
              ticked={ticked.some((entry) => entry.id === item.id)}
              onToggle={() => toggle(item.id)}
            />
          ))
        )}
      </div>
    </CardShell>
  );
}

function PendingRow({ item, ticked, onToggle }: { item: PendingItemDto; ticked: boolean; onToggle: () => void }) {
  const checkboxId = useId();
  return (
    <label
      htmlFor={checkboxId}
      className="flex cursor-pointer items-start gap-3 border-b border-border/40 px-5 py-2.5 last:border-b-0 hover:bg-surface-low"
    >
      <Checkbox
        id={checkboxId}
        aria-label={item.fileName}
        className="mt-1"
        checked={ticked}
        onCheckedChange={onToggle}
      />
      <div className="min-w-0 flex-1">
        <PendingItemSummary item={item} />
      </div>
    </label>
  );
}
