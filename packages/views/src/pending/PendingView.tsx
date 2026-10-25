import type { MediaLibraryDto } from "@mdcz/shared/mediaLibrary";
import {
  type AmbiguousCandidate,
  PENDING_KINDS,
  type PendingConfirmUncensoredInput,
  type PendingDetailResponse,
  type PendingItemDto,
  type PendingKindDto,
  type PendingRetryInput,
  type PendingRetryManyInput,
  type PendingSiteResultDto,
} from "@mdcz/shared/pending";
import {
  Badge,
  Button,
  Checkbox,
  cn,
  Input,
  Label,
  quietPanelSurfaceClass,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mdcz/ui";
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  FilePlus2,
  FileQuestion,
  Inbox,
  Layers,
  Loader2,
  type LucideIcon,
  RotateCcw,
  SearchX,
  Tag,
  Trash2,
  XCircle,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { confirmDialog } from "../common";
import { useT } from "../i18n";

const KIND_BADGE_META: Record<PendingKindDto, { className: string; icon: LucideIcon; iconClassName?: string }> = {
  uncensored: {
    className: "border-foreground bg-foreground text-background shadow-2xs",
    icon: Tag,
  },
  ambiguous: {
    className: "border-foreground/25 bg-surface text-foreground shadow-2xs",
    icon: Layers,
    iconClassName: "text-foreground/80",
  },
  new_file: {
    className: "border-border bg-surface text-foreground/85",
    icon: FilePlus2,
    iconClassName: "text-muted-foreground",
  },
  not_found: {
    className: "border-border/80 bg-surface-raised/75 text-foreground/85",
    icon: SearchX,
    iconClassName: "text-muted-foreground",
  },
  failed: {
    className: "border-border/80 bg-surface-raised/75 text-foreground/85",
    icon: AlertCircle,
    iconClassName: "text-muted-foreground",
  },
  no_number: {
    className: "border-border/60 bg-surface-low text-muted-foreground",
    icon: FileQuestion,
    iconClassName: "text-muted-foreground/75",
  },
};

const ACTION_ROW_CLASS = "grid grid-cols-1 gap-2.5 sm:grid-cols-[minmax(0,1fr)_8.5rem]";
const UNCENSORED_CHOICES = ["uncensored", "umr", "leak"] as const;
const OWN_LIBRARIES = "own";

export interface PendingViewProps {
  items: PendingItemDto[];
  loading?: boolean;
  errorMessage?: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  detail?: PendingDetailResponse | null;
  detailLoading?: boolean;
  libraries: MediaLibraryDto[];
  onRetry: (input: PendingRetryInput) => Promise<void>;
  onRetryMany: (input: PendingRetryManyInput) => Promise<void>;
  onConfirmUncensored: (input: PendingConfirmUncensoredInput) => Promise<void>;
  onIgnore: (ids: string[]) => Promise<void>;
}

export function PendingView({
  items,
  loading = false,
  errorMessage,
  selectedId,
  onSelect,
  detail,
  detailLoading = false,
  libraries,
  onRetry,
  onRetryMany,
  onConfirmUncensored,
  onIgnore,
}: PendingViewProps) {
  const t = useT();
  const [kindFilter, setKindFilter] = useState<PendingKindDto | "all">("all");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const visibleItems = kindFilter === "all" ? items : items.filter((item) => item.kind === kindFilter);
  // Entries that left the list or the filter drop out of the selection on their own.
  const selected = visibleItems.filter((item) => selectedIds.has(item.id));
  const toggleSelected = (id: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  if (!loading && items.length === 0 && !errorMessage) {
    return (
      <main className="flex h-full min-h-0 flex-col bg-surface-canvas p-4 text-foreground">
        <h1 className="px-1 text-lg font-bold tracking-tight">{t.pending.title}</h1>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-16 text-sm text-muted-foreground">
          <Inbox className="h-10 w-10 text-muted-foreground/40" />
          {t.pending.empty}
        </div>
      </main>
    );
  }
  return (
    <main className="grid h-full min-h-0 grid-cols-1 gap-0 bg-surface-canvas text-foreground lg:grid-cols-[22rem_minmax(0,1fr)]">
      <section className="min-h-0 overflow-y-auto border-border/60 p-4 lg:border-r">
        <div className="mb-3 flex items-center justify-between px-1">
          <h1 className="text-lg font-bold tracking-tight">{t.pending.title}</h1>
          <span className="rounded-full bg-surface-low px-2.5 py-0.5 font-numeric text-xs font-bold text-muted-foreground">
            {items.length}
          </span>
        </div>
        {errorMessage ? (
          <div className="mb-3 flex items-center gap-2 rounded-quiet border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {t.pending.loadFailed(errorMessage)}
          </div>
        ) : null}
        <div className="mb-3 space-y-2.5 px-1">
          <Select value={kindFilter} onValueChange={(value) => setKindFilter(value as PendingKindDto | "all")}>
            <SelectTrigger aria-label={t.pending.kindFilter} className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{`${t.pending.allKinds} (${items.length})`}</SelectItem>
              {PENDING_KINDS.map((kind) => {
                const count = items.filter((item) => item.kind === kind).length;
                return count > 0 ? (
                  <SelectItem key={kind} value={kind}>{`${t.pending.kinds[kind]} (${count})`}</SelectItem>
                ) : null;
              })}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              id="pending-select-all"
              checked={
                selected.length > 0 && selected.length === visibleItems.length
                  ? true
                  : selected.length > 0
                    ? "indeterminate"
                    : false
              }
              disabled={visibleItems.length === 0}
              onCheckedChange={() =>
                setSelectedIds(
                  new Set(selected.length === visibleItems.length ? [] : visibleItems.map((item) => item.id)),
                )
              }
            />
            <label htmlFor="pending-select-all" className="cursor-pointer select-none">
              {t.pending.selectAll(selected.length, visibleItems.length)}
            </label>
          </div>
          {selected.length > 0 ? (
            <BatchActions
              items={selected}
              libraries={libraries}
              onDone={() => setSelectedIds(new Set())}
              onRetryMany={onRetryMany}
              onConfirmUncensored={onConfirmUncensored}
              onIgnore={onIgnore}
            />
          ) : null}
        </div>
        <ul className="space-y-2">
          {visibleItems.map((item) => {
            const active = item.id === selectedId;
            return (
              <li key={item.id} className="flex items-start gap-2.5">
                <Checkbox
                  aria-label={item.fileName}
                  className="mt-3.5"
                  checked={selectedIds.has(item.id)}
                  onCheckedChange={() => toggleSelected(item.id)}
                />
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    quietPanelSurfaceClass,
                    "min-w-0 flex-1 rounded-quiet-lg px-3.5 py-3 text-left transition-all",
                    active
                      ? "border-foreground/35 bg-surface-floating shadow-sm ring-1 ring-foreground/10"
                      : "bg-surface/60 hover:border-border hover:bg-surface-floating/80",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <KindBadge kind={item.kind} />
                    {item.number ? (
                      <span className="rounded border border-border/60 bg-surface-low/70 px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-tight text-muted-foreground">
                        {item.number}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 truncate text-sm font-semibold tracking-tight" title={item.path}>
                    {item.fileName}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {item.libraryName ?? t.pending.noLibrary} ·{" "}
                    {t.pending.updated(new Date(item.updatedAt).toLocaleString())}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="min-h-0 overflow-y-auto p-6 lg:p-8">
        {detailLoading && !detail ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : null}
        {detail ? (
          <PendingDetail
            key={detail.item.id}
            detail={detail}
            libraries={libraries}
            onRetry={onRetry}
            onConfirmUncensored={onConfirmUncensored}
            onIgnore={onIgnore}
          />
        ) : null}
      </section>
    </main>
  );
}

/** Each action applies to the selected entries it fits: scraping again skips published movies, confirming takes only them. */
function BatchActions({
  items,
  libraries,
  onDone,
  onRetryMany,
  onConfirmUncensored,
  onIgnore,
}: {
  items: PendingItemDto[];
  libraries: MediaLibraryDto[];
  onDone: () => void;
  onRetryMany: PendingViewProps["onRetryMany"];
  onConfirmUncensored: PendingViewProps["onConfirmUncensored"];
  onIgnore: PendingViewProps["onIgnore"];
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [libraryId, setLibraryId] = useState(OWN_LIBRARIES);
  const scrapable = items.filter((item) => item.kind !== "uncensored").map((item) => item.id);
  const uncensored = items.filter((item) => item.kind === "uncensored").map((item) => item.id);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn(quietPanelSurfaceClass, "space-y-2.5 rounded-quiet-lg p-3 text-xs")}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-foreground">{t.pending.selectedCount(items.length)}</span>
        <Button variant="ghost" size="xs" className="h-6 px-2 text-[11px]" disabled={busy} onClick={onDone}>
          {t.pending.clearSelection}
        </Button>
      </div>
      {scrapable.length > 0 ? (
        <div className="flex gap-2">
          {libraries.length > 0 ? (
            <Select value={libraryId} onValueChange={setLibraryId}>
              <SelectTrigger aria-label={t.pending.chooseLibrary} className="h-8 min-w-0 flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={OWN_LIBRARIES}>{t.pending.ownLibraries}</SelectItem>
                {libraries.map((library) => (
                  <SelectItem key={library.id} value={library.id}>
                    {library.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            disabled={busy}
            onClick={() =>
              void run(() => onRetryMany({ ids: scrapable, ...(libraryId === OWN_LIBRARIES ? {} : { libraryId }) }))
            }
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t.pending.retrySelected(scrapable.length)}
          </Button>
        </div>
      ) : null}
      {uncensored.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">{t.pending.confirmSelectedAs(uncensored.length)}</span>
          {UNCENSORED_CHOICES.map((choice) => (
            <Button
              key={choice}
              size="sm"
              className="h-7"
              disabled={busy}
              onClick={() => void run(() => onConfirmUncensored({ ids: uncensored, choice }))}
            >
              {t.pending.confirmTypes[choice]}
            </Button>
          ))}
        </div>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        disabled={busy}
        onClick={async () => {
          if (
            await confirmDialog({
              title: t.pending.ignoreSelectedConfirm(items.length),
              confirmLabel: t.pending.ignore,
            })
          )
            await run(() => onIgnore(items.map((item) => item.id)));
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {t.pending.ignoreSelected(items.length)}
      </Button>
    </div>
  );
}

function KindBadge({ kind }: { kind: PendingKindDto }) {
  const t = useT();
  const { className, icon: Icon, iconClassName } = KIND_BADGE_META[kind];
  return (
    <Badge variant="outline" className={cn("gap-1.5 px-2.5 py-0.5 font-medium tracking-tight", className)}>
      <Icon className={cn("size-3 shrink-0", iconClassName)} />
      {t.pending.kinds[kind]}
    </Badge>
  );
}

function PendingDetail({
  detail,
  libraries,
  onRetry,
  onConfirmUncensored,
  onIgnore,
}: {
  detail: PendingDetailResponse;
  libraries: MediaLibraryDto[];
  onRetry: PendingViewProps["onRetry"];
  onConfirmUncensored: PendingViewProps["onConfirmUncensored"];
  onIgnore: PendingViewProps["onIgnore"];
}) {
  const t = useT();
  const { item, siteResults } = detail;
  const [busy, setBusy] = useState(false);
  const [libraryId, setLibraryId] = useState(item.libraryId ?? libraries[0]?.id ?? "");
  useEffect(() => setLibraryId(item.libraryId ?? libraries[0]?.id ?? ""), [item.libraryId, libraries]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };
  const retry = (input: Omit<PendingRetryInput, "id" | "libraryId">) =>
    run(() => onRetry({ id: item.id, ...(libraryId ? { libraryId } : {}), ...input }));
  const scrapable = item.kind !== "uncensored";
  const showIgnoreToken = item.kind === "no_number" || item.kind === "not_found";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className={cn(quietPanelSurfaceClass, "space-y-3 rounded-quiet-xl p-5")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <KindBadge kind={item.kind} />
              {item.number ? (
                <span className="rounded border border-border/60 bg-surface-low/70 px-2 py-0.5 font-mono text-xs font-semibold tracking-tight text-muted-foreground">
                  {item.number}
                </span>
              ) : null}
            </div>
            <h2 className="break-words text-lg font-bold tracking-tight">{item.fileName}</h2>
            <div className="break-words font-mono text-xs text-muted-foreground">{item.path}</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 gap-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            disabled={busy}
            onClick={async () => {
              if (await confirmDialog({ title: t.pending.ignoreConfirm, confirmLabel: t.pending.ignore }))
                await run(() => onIgnore([item.id]));
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t.pending.ignore}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{t.pending.kindDescriptions[item.kind]}</p>
        {item.detail && item.kind !== "ambiguous" ? (
          <p className="rounded-quiet border border-border/50 bg-surface-low/80 px-3 py-2 font-mono text-xs break-words text-foreground/85">
            {item.detail}
          </p>
        ) : null}
        {item.kind === "uncensored" ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {UNCENSORED_CHOICES.map((choice) => (
              <Button
                key={choice}
                disabled={busy}
                onClick={() => void run(() => onConfirmUncensored({ ids: [item.id], choice }))}
              >
                {t.pending.confirmTypes[choice]}
              </Button>
            ))}
          </div>
        ) : null}
      </header>

      {item.candidates.length > 0 ? (
        <Block title={t.pending.candidatesTitle}>
          <CandidateGroups
            candidates={item.candidates}
            disabled={busy || !libraryId}
            onChoose={(index) => void retry({ candidate: index })}
          />
        </Block>
      ) : null}

      {scrapable ? (
        <Block title={t.pending.retry}>
          <div className="divide-y divide-border/40">
            <div className="pb-4">
              {libraries.length > 0 ? (
                <LabeledRow label={t.pending.chooseLibrary}>
                  {(id) => (
                    <div className={ACTION_ROW_CLASS}>
                      <Select value={libraryId} onValueChange={setLibraryId}>
                        <SelectTrigger id={id} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {libraries.map((library) => (
                            <SelectItem key={library.id} value={library.id}>
                              {library.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        className="w-full justify-center"
                        disabled={busy || !libraryId}
                        onClick={() => void retry({})}
                      >
                        <RotateCcw className="h-4 w-4" />
                        {item.kind === "new_file" ? t.pending.scrape : t.pending.retry}
                      </Button>
                    </div>
                  )}
                </LabeledRow>
              ) : (
                <Button variant="outline" disabled={busy || !libraryId} onClick={() => void retry({})}>
                  <RotateCcw className="h-4 w-4" />
                  {item.kind === "new_file" ? t.pending.scrape : t.pending.retry}
                </Button>
              )}
            </div>
            <div className="py-4">
              <NumberRetry item={item} disabled={busy || !libraryId} onRetry={(input) => void retry(input)} />
            </div>
            <div className={cn("py-4", !showIgnoreToken && "pb-0")}>
              <UrlRetry disabled={busy || !libraryId} onRetry={(manualUrl) => void retry({ manualUrl })} />
            </div>
            {showIgnoreToken ? (
              <div className="pt-4">
                <IgnoreTokenRetry
                  disabled={busy || !libraryId}
                  onRetry={(token) => void retry({ rule: { kind: "ignoreToken", token } })}
                />
              </div>
            ) : null}
          </div>
        </Block>
      ) : null}

      {item.number ? (
        <Block title={t.pending.siteResultsTitle}>
          {siteResults.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.pending.noSiteResults}</p>
          ) : (
            <ul className="divide-y divide-border/40">
              {siteResults.map((result) => (
                <SiteResultRow key={result.site} result={result} />
              ))}
            </ul>
          )}
        </Block>
      ) : null}
    </div>
  );
}

function SiteResultRow({ result }: { result: PendingSiteResultDto }) {
  const t = useT();
  const seconds = `${(result.elapsedMs / 1000).toFixed(1)}s`;
  const reason = result.reason ? t.domain.failureReasons[result.reason] : "";
  const outcome =
    result.status === "success"
      ? t.pending.siteResult.success
      : result.status === "skipped"
        ? t.pending.siteResult.skipped(
            result.skipReason
              ? reason
                ? `${t.pending.skipReasons[result.skipReason]} (${reason})`
                : t.pending.skipReasons[result.skipReason]
              : reason,
          )
        : t.pending.siteResult.failed(reason || (result.detail ?? ""));

  const Icon = result.status === "success" ? CheckCircle2 : result.status === "failed" ? XCircle : CircleDashed;
  const iconClass = result.status === "success" ? "text-foreground/80" : "text-muted-foreground";

  return (
    <li
      aria-label={`${result.site}: ${outcome} (${seconds})`}
      className="flex items-center justify-between gap-3 py-2.5 text-xs first:pt-1 last:pb-0"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", iconClass)} />
        <span className="shrink-0 font-mono font-bold text-foreground">{result.site}</span>
        <span className="truncate text-muted-foreground">{outcome}</span>
      </div>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">{seconds}</span>
    </li>
  );
}

/** Sites disagree on details such as release dates, so works stay grouped by the site that listed them. */
function CandidateGroups({
  candidates,
  disabled,
  onChoose,
}: {
  candidates: AmbiguousCandidate[];
  disabled: boolean;
  onChoose: (index: number) => void;
}) {
  const t = useT();
  const sites = [...new Set(candidates.map((candidate) => candidate.site))];
  return (
    <div className="space-y-4">
      {sites.map((site) => (
        <div key={site} className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase">{site}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {candidates.map((candidate, index) =>
              candidate.site === site ? (
                <div
                  key={candidate.detailUrl}
                  className="flex gap-3.5 rounded-quiet-lg border border-border/60 bg-surface-low/40 p-3.5"
                >
                  {candidate.coverUrl ? (
                    <img
                      src={candidate.coverUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-24 w-16 shrink-0 rounded object-cover"
                    />
                  ) : null}
                  <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                    <div className="space-y-1">
                      <div className="line-clamp-2 text-sm font-semibold">{candidate.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {[candidate.studio, candidate.releaseDate ? t.pending.released(candidate.releaseDate) : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      <a
                        href={candidate.detailUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-xs text-primary underline-offset-2 hover:underline"
                      >
                        {candidate.detailUrl}
                      </a>
                    </div>
                    <Button size="sm" className="self-start" disabled={disabled} onClick={() => onChoose(index)}>
                      {t.pending.choose}
                    </Button>
                  </div>
                </div>
              ) : null,
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function NumberRetry({
  item,
  disabled,
  onRetry,
}: {
  item: PendingItemDto;
  disabled: boolean;
  onRetry: (input: Pick<PendingRetryInput, "number" | "rule">) => void;
}) {
  const t = useT();
  const id = useId();
  const [number, setNumber] = useState(item.number ?? "");
  const [remember, setRemember] = useState(false);
  const [match, setMatch] = useState(item.fileName.replace(/\.[^.]+$/u, ""));
  return (
    <div className="space-y-2.5">
      <LabeledRow label={t.pending.number}>
        {(inputId) => (
          <div className={ACTION_ROW_CLASS}>
            <Input
              id={inputId}
              className="w-full font-mono"
              placeholder={t.pending.numberPlaceholder}
              value={number}
              onChange={(event) => setNumber(event.target.value)}
            />
            <Button
              variant="outline"
              className="w-full justify-center"
              disabled={disabled || !number.trim() || (remember && !match.trim())}
              onClick={() =>
                onRetry({
                  number: number.trim(),
                  ...(remember ? { rule: { kind: "numberMapping", match: match.trim() } } : {}),
                })
              }
            >
              {t.pending.retryWithNumber}
            </Button>
          </div>
        )}
      </LabeledRow>
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5 pl-0.5 text-xs text-muted-foreground">
        <Checkbox id={id} checked={remember} onCheckedChange={(checked) => setRemember(checked === true)} />
        <label htmlFor={id} className="cursor-pointer select-none">
          {t.pending.rememberMapping}
        </label>
        <input
          type="text"
          aria-label={t.pending.rememberMappingMatch}
          className="h-5 max-w-[16rem] min-w-[5rem] border-b border-dashed border-muted-foreground/45 bg-transparent px-1 font-mono text-xs text-foreground transition-colors hover:border-foreground/60 focus:border-solid focus:border-foreground focus:outline-none"
          style={{ width: `${Math.max(match.length + 2, 8)}ch` }}
          value={match}
          onChange={(event) => {
            setMatch(event.target.value);
            if (!remember && event.target.value.trim()) setRemember(true);
          }}
        />
        <span>{t.pending.rememberMappingHint}</span>
      </div>
    </div>
  );
}

function UrlRetry({ disabled, onRetry }: { disabled: boolean; onRetry: (url: string) => void }) {
  const t = useT();
  const [url, setUrl] = useState("");
  return (
    <LabeledRow label={t.pending.manualUrl}>
      {(id) => (
        <div className={ACTION_ROW_CLASS}>
          <Input
            id={id}
            className="w-full"
            placeholder={t.pending.manualUrlPlaceholder}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <Button
            variant="outline"
            className="w-full justify-center"
            disabled={disabled || !url.trim()}
            onClick={() => onRetry(url.trim())}
          >
            {t.pending.scrapeUrl}
          </Button>
        </div>
      )}
    </LabeledRow>
  );
}

function IgnoreTokenRetry({ disabled, onRetry }: { disabled: boolean; onRetry: (token: string) => void }) {
  const t = useT();
  const [token, setToken] = useState("");
  return (
    <LabeledRow label={t.pending.ignoreToken}>
      {(id) => (
        <div className={ACTION_ROW_CLASS}>
          <Input
            id={id}
            className="w-full font-mono"
            placeholder={t.pending.ignoreTokenPlaceholder}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <Button
            variant="outline"
            className="w-full justify-center"
            disabled={disabled || !token.trim()}
            onClick={() => onRetry(token.trim())}
          >
            {t.pending.saveIgnoreToken}
          </Button>
        </div>
      )}
    </LabeledRow>
  );
}

function LabeledRow({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={cn(quietPanelSurfaceClass, "space-y-3 rounded-quiet-xl p-5")}>
      <h3 className="text-sm font-bold tracking-tight">{title}</h3>
      {children}
    </section>
  );
}
