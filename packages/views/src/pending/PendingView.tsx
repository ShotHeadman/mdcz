import type { MediaLibraryDto } from "@mdcz/shared/mediaLibrary";
import type {
  AmbiguousCandidate,
  PendingConfirmUncensoredInput,
  PendingDetailResponse,
  PendingItemDto,
  PendingRetryInput,
  PendingSiteResultDto,
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
import { AlertCircle, Inbox, Loader2, RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { confirmDialog } from "../common";
import { useT } from "../i18n";

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
  onConfirmUncensored: (input: PendingConfirmUncensoredInput) => Promise<void>;
  onIgnore: (id: string) => Promise<void>;
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
  onConfirmUncensored,
  onIgnore,
}: PendingViewProps) {
  const t = useT();
  return (
    <main className="grid h-full min-h-0 grid-cols-1 gap-0 bg-surface-canvas text-foreground lg:grid-cols-[22rem_minmax(0,1fr)]">
      <section className="min-h-0 overflow-y-auto border-border/60 p-4 lg:border-r">
        <h1 className="mb-3 px-1 text-lg font-bold tracking-tight">{t.pending.title}</h1>
        {errorMessage ? (
          <div className="mb-3 flex items-center gap-2 rounded-quiet border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {t.pending.loadFailed(errorMessage)}
          </div>
        ) : null}
        {!loading && items.length === 0 && !errorMessage ? (
          <div className="flex flex-col items-center gap-3 px-4 py-16 text-center text-sm text-muted-foreground">
            <Inbox className="h-8 w-8 opacity-30" />
            {t.pending.empty}
          </div>
        ) : null}
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={item.id === selectedId}
                onClick={() => onSelect(item.id)}
                className={cn(
                  quietPanelSurfaceClass,
                  "w-full rounded-quiet-lg px-3 py-2.5 text-left transition-colors hover:border-ring/40",
                  item.id === selectedId && "border-ring/50 ring-2 ring-ring/10",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={item.kind === "uncensored" || item.kind === "new_file" ? "outline" : "secondary"}>
                    {t.pending.kinds[item.kind]}
                  </Badge>
                  {item.number ? <span className="font-mono text-xs text-muted-foreground">{item.number}</span> : null}
                </div>
                <div className="mt-1.5 truncate text-sm font-medium" title={item.path}>
                  {item.fileName}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.libraryName ?? t.pending.noLibrary} ·{" "}
                  {t.pending.updated(new Date(item.updatedAt).toLocaleString())}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="min-h-0 overflow-y-auto p-6">
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <Badge variant="secondary">{t.pending.kinds[item.kind]}</Badge>
        <h2 className="break-all text-lg font-bold tracking-tight">{item.fileName}</h2>
        <div className="break-all font-mono text-xs text-muted-foreground">{item.path}</div>
        <p className="text-sm text-muted-foreground">{t.pending.kindDescriptions[item.kind]}</p>
        {item.detail && item.kind !== "ambiguous" ? (
          <p className="rounded-quiet bg-surface-low px-3 py-2 font-mono text-xs break-all">{item.detail}</p>
        ) : null}
      </header>

      {item.kind === "uncensored" ? (
        <div className="flex flex-wrap gap-2">
          {(["uncensored", "umr", "leak"] as const).map((choice) => (
            <Button
              key={choice}
              disabled={busy}
              onClick={() => void run(() => onConfirmUncensored({ id: item.id, choice }))}
            >
              {t.pending.confirmTypes[choice]}
            </Button>
          ))}
        </div>
      ) : null}

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
          <div className="space-y-4">
            {libraries.length > 0 ? (
              <LabeledRow label={t.pending.chooseLibrary}>
                {(id) => (
                  <Select value={libraryId} onValueChange={setLibraryId}>
                    <SelectTrigger id={id} className="w-full max-w-sm">
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
                )}
              </LabeledRow>
            ) : null}
            <Button variant="outline" disabled={busy || !libraryId} onClick={() => void retry({})}>
              <RotateCcw className="h-4 w-4" />
              {item.kind === "new_file" ? t.pending.scrape : t.pending.retry}
            </Button>
            <NumberRetry item={item} disabled={busy || !libraryId} onRetry={(input) => void retry(input)} />
            <UrlRetry disabled={busy || !libraryId} onRetry={(manualUrl) => void retry({ manualUrl })} />
            <IgnoreTokenRetry
              disabled={busy || !libraryId}
              onRetry={(token) => void retry({ rule: { kind: "ignoreToken", token } })}
            />
          </div>
        </Block>
      ) : null}

      {item.number ? (
        <Block title={t.pending.siteResultsTitle}>
          {siteResults.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.pending.noSiteResults}</p>
          ) : (
            <ul className="space-y-1 font-mono text-xs">
              {siteResults.map((result) => (
                <li key={result.site}>{describeSiteResult(t, result)}</li>
              ))}
            </ul>
          )}
        </Block>
      ) : null}

      <Button
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          if (await confirmDialog({ title: t.pending.ignoreConfirm, confirmLabel: t.pending.ignore }))
            await run(() => onIgnore(item.id));
        }}
      >
        {t.pending.ignore}
      </Button>
    </div>
  );
}

const describeSiteResult = (t: ReturnType<typeof useT>, result: PendingSiteResultDto): string => {
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
  return `${result.site}: ${outcome} (${seconds})`;
};

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
                <div key={candidate.detailUrl} className="flex gap-3 rounded-quiet border border-border/60 p-3">
                  {candidate.coverUrl ? (
                    <img
                      src={candidate.coverUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-24 w-16 shrink-0 rounded object-cover"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="line-clamp-3 text-sm font-medium">{candidate.title}</div>
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
                    <Button size="sm" disabled={disabled} onClick={() => onChoose(index)}>
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
    <div className="space-y-2">
      <LabeledRow label={t.pending.number}>
        {(inputId) => (
          <div className="flex flex-wrap gap-2">
            <Input
              id={inputId}
              className="max-w-xs font-mono"
              placeholder={t.pending.numberPlaceholder}
              value={number}
              onChange={(event) => setNumber(event.target.value)}
            />
            <Button
              variant="outline"
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
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Checkbox id={id} checked={remember} onCheckedChange={(checked) => setRemember(checked === true)} />
        <label htmlFor={id}>{t.pending.rememberMapping}</label>
        <Input
          className="h-7 max-w-[14rem] font-mono text-xs"
          value={match}
          onChange={(event) => setMatch(event.target.value)}
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
        <div className="flex flex-wrap gap-2">
          <Input
            id={id}
            className="max-w-md"
            placeholder={t.pending.manualUrlPlaceholder}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <Button variant="outline" disabled={disabled || !url.trim()} onClick={() => onRetry(url.trim())}>
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
        <div className="flex flex-wrap gap-2">
          <Input
            id={id}
            className="max-w-xs font-mono"
            placeholder={t.pending.ignoreTokenPlaceholder}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <Button variant="outline" disabled={disabled || !token.trim()} onClick={() => onRetry(token.trim())}>
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
