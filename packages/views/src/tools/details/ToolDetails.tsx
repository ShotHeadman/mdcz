import type { MediaRootDto, RootBrowserEntryDto, ToolId } from "@mdcz/shared";
import { Website } from "@mdcz/shared/enums";
import { TOOL_DEFINITIONS } from "@mdcz/shared/toolCatalog";
import {
  Badge,
  Button,
  Checkbox,
  cn,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mdcz/ui";
import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { useT } from "../../i18n";
import { ToolField as Field, ToolShell } from "../ToolScaffold";

const TOOL_INPUT_CLASS =
  "h-11 rounded-quiet-sm border-none bg-surface-low/90 px-4 shadow-none focus-visible:ring-2 focus-visible:ring-ring/30";
const TOOL_SECONDARY_BUTTON_CLASS =
  "h-11 rounded-quiet-capsule bg-surface-low px-5 text-sm font-semibold text-foreground hover:bg-surface-raised/75";
const TOOL_SELECT_TRIGGER_CLASS =
  "h-11 rounded-quiet-sm border-none bg-surface-low/90 px-4 shadow-none focus-visible:ring-2 focus-visible:ring-ring/30";
const TOOL_SUBSECTION_CLASS = "space-y-4 rounded-quiet-lg bg-surface-low/90 p-4 md:p-5";

export interface ToolRunState {
  pending?: boolean;
  message?: string;
  error?: string;
  data?: unknown;
}

export interface SingleFileScraperDetailProps {
  browserEntries: RootBrowserEntryDto[];
  roots: MediaRootDto[];
  state?: ToolRunState;
  onRootChange?: (rootId: string) => void;
  onRun: (input: { rootId: string; relativePath: string; manualUrl?: string }) => void;
  workbenchLink?: React.ReactNode;
}

export function SingleFileScraperDetail({
  browserEntries,
  roots,
  state,
  onRootChange,
  onRun,
  workbenchLink,
}: SingleFileScraperDetailProps) {
  const t = useT();
  const [rootId, setRootId] = useState("");
  const [relativePath, setRelativePath] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const enabledRoots = roots;
  const files = browserEntries.filter((entry) => entry.type === "file");

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label={t.tools.mediaDirectory}>
          <select
            className="h-10 rounded-quiet border border-border bg-surface-low px-3 text-sm text-foreground"
            value={rootId}
            onChange={(event) => {
              const nextRootId = event.target.value;
              setRootId(nextRootId);
              setRelativePath("");
              onRootChange?.(nextRootId);
            }}
          >
            <option value="">{t.tools.selectMediaDirectory}</option>
            {enabledRoots.map((root) => (
              <option key={root.id} value={root.id}>
                {root.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.tools.manualUrl}>
          <Input
            value={manualUrl}
            onChange={(event) => setManualUrl(event.target.value)}
            placeholder={t.tools.manualUrlPlaceholder}
          />
        </Field>
      </div>
      <Field label={t.tools.relativePath}>
        <Input
          value={relativePath}
          onChange={(event) => setRelativePath(event.target.value)}
          placeholder={t.tools.relativePathPlaceholder}
        />
      </Field>
      <div className="grid max-h-[320px] gap-2 overflow-y-auto rounded-quiet border border-border/50 bg-surface-low/40 p-3">
        {files.map((entry) => (
          <button
            key={entry.relativePath}
            className={`rounded-quiet px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
              relativePath === entry.relativePath ? "bg-primary/10 text-foreground" : "hover:bg-surface-raised/60"
            }`}
            type="button"
            onClick={() => setRelativePath(entry.relativePath)}
          >
            <span className="block truncate font-medium">{entry.name}</span>
            <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{entry.relativePath}</span>
          </button>
        ))}
        {rootId && files.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t.tools.rootNoFiles}</p>
        )}
        {!rootId && (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t.tools.pleaseSelectMediaDirectory}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!rootId || !relativePath.trim() || state?.pending}
          onClick={() => onRun({ rootId, relativePath: relativePath.trim(), manualUrl: manualUrl.trim() || undefined })}
        >
          {t.tools.startSingleFileScrape}
        </Button>
        {workbenchLink}
      </div>
      <ToolState state={state} />
    </div>
  );
}

export interface CrawlerTesterDetailProps {
  result?: {
    data: {
      actors?: string[];
      genres?: string[];
      release_date?: string;
      studio?: string;
      title?: string;
    } | null;
    elapsed: number;
    error?: string;
  } | null;
  siteOptions?: Array<{ enabled: boolean; name: string; native: boolean; site: string }>;
  state?: ToolRunState;
  onRun: (input: { number: string; site?: Website; manualUrl?: string }) => void;
}

export function CrawlerTesterDetail({ result, siteOptions, state, onRun }: CrawlerTesterDetailProps) {
  const [number, setNumber] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [site, setSite] = useState("");
  const sites =
    siteOptions ?? Object.values(Website).map((value) => ({ enabled: true, name: value, native: true, site: value }));
  const selectedSite = site || (siteOptions ? "" : "all");
  const run = () =>
    onRun({
      number: number.trim(),
      site: selectedSite && selectedSite !== "all" ? (selectedSite as Website) : undefined,
      manualUrl: manualUrl.trim() || undefined,
    });

  const t = useT();
  return (
    <div className="space-y-5">
      <div className={TOOL_SUBSECTION_CLASS}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.tools.site}>
            <Select value={selectedSite} onValueChange={(value) => setSite(value === "all" ? "" : value)}>
              <SelectTrigger className={TOOL_SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder={t.tools.selectSite} />
              </SelectTrigger>
              <SelectContent>
                {!siteOptions ? <SelectItem value="all">{t.tools.aggregateByConfig}</SelectItem> : null}
                {sites.map((option) => (
                  <SelectItem key={option.site} value={option.site}>
                    <span className="flex items-center gap-2">
                      {option.name}
                      {option.enabled ? (
                        <Badge variant="secondary" className="h-5 rounded-quiet-capsule px-2 text-[10px]">
                          {t.common.enabled}
                        </Badge>
                      ) : null}
                      {!option.native ? (
                        <Badge variant="outline" className="h-5 rounded-quiet-capsule px-2 text-[10px]">
                          {t.tools.browser}
                        </Badge>
                      ) : null}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t.tools.movieCode}>
            <Input
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              placeholder={t.tools.movieCodePlaceholder}
              className={TOOL_INPUT_CLASS}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  run();
                }
              }}
            />
          </Field>
          {!siteOptions ? (
            <Field label={t.tools.manualUrl}>
              <Input
                value={manualUrl}
                onChange={(event) => setManualUrl(event.target.value)}
                placeholder={t.tools.manualUrlPlaceholder}
                className={TOOL_INPUT_CLASS}
              />
            </Field>
          ) : null}
        </div>
      </div>
      <Button
        variant="secondary"
        disabled={!number.trim() || state?.pending}
        className={cn(TOOL_SECONDARY_BUTTON_CLASS, "w-full sm:w-auto")}
        onClick={run}
      >
        {state?.pending ? t.tools.testing : siteOptions ? t.tools.startTest : t.tools.runCrawlerTest}
      </Button>
      {result ? <CrawlerTesterResult result={result} /> : null}
      <ToolState state={state} pre />
    </div>
  );
}

function CrawlerTesterResult({ result }: { result: NonNullable<CrawlerTesterDetailProps["result"]> }) {
  const t = useT();
  return (
    <div className={TOOL_SUBSECTION_CLASS}>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="font-medium">
          {result.data ? (
            <span className="text-emerald-600 dark:text-emerald-400">{t.tools.testSuccess}</span>
          ) : (
            <span className="text-destructive">{t.tools.testFailed}</span>
          )}
        </span>
        <span className="font-numeric text-muted-foreground">
          {t.tools.elapsedSeconds((result.elapsed / 1000).toFixed(1))}
        </span>
      </div>

      {result.error ? <p className="mt-3 text-sm text-destructive">{result.error}</p> : null}

      {result.data ? (
        <div className="mt-3 grid gap-2 text-sm leading-7">
          {result.data.title ? <CrawlerTesterResultRow label={t.tools.title} value={result.data.title} /> : null}
          {result.data.actors?.length ? (
            <CrawlerTesterResultRow label={t.tools.actors} value={result.data.actors.join(", ")} />
          ) : null}
          {result.data.genres?.length ? (
            <CrawlerTesterResultRow label={t.tools.tags} value={result.data.genres.join(", ")} />
          ) : null}
          {result.data.release_date ? (
            <CrawlerTesterResultRow label={t.tools.releaseDate} value={result.data.release_date} />
          ) : null}
          {result.data.studio ? <CrawlerTesterResultRow label={t.tools.studio} value={result.data.studio} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function CrawlerTesterResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

export interface SymlinkManagerDetailProps {
  state?: ToolRunState;
  onBrowseDestDir?: () => Promise<string | null | undefined>;
  onBrowseSourceDir?: () => Promise<string | null | undefined>;
  onRun: (input: { sourceDir: string; destDir: string; copyFiles: boolean; dryRun: boolean }) => void;
}

export function SymlinkManagerDetail({ state, onBrowseDestDir, onBrowseSourceDir, onRun }: SymlinkManagerDetailProps) {
  const t = useT();
  const [sourceDir, setSourceDir] = useState("");
  const [destDir, setDestDir] = useState("");
  const [copyFiles, setCopyFiles] = useState(false);
  const [dryRun] = useState(false);
  const handleBrowseSource = async () => {
    const selected = await onBrowseSourceDir?.();
    if (selected) setSourceDir(selected);
  };
  const handleBrowseDest = async () => {
    const selected = await onBrowseDestDir?.();
    if (selected) setDestDir(selected);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={TOOL_SUBSECTION_CLASS}>
          <Field label={t.tools.sourceDirectory}>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={sourceDir}
                onChange={(event) => setSourceDir(event.target.value)}
                className={cn(TOOL_INPUT_CLASS, "flex-1")}
                placeholder={t.tools.sourceDirectoryPlaceholder}
              />
              {onBrowseSourceDir ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="h-11 w-11 shrink-0 rounded-quiet-sm bg-surface-low text-foreground hover:bg-surface-raised/75"
                  onClick={handleBrowseSource}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </Field>
        </div>
        <div className={TOOL_SUBSECTION_CLASS}>
          <Field label={t.tools.destDirectory}>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={destDir}
                onChange={(event) => setDestDir(event.target.value)}
                className={cn(TOOL_INPUT_CLASS, "flex-1")}
                placeholder={t.tools.destDirectoryPlaceholder}
              />
              {onBrowseDestDir ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="h-11 w-11 shrink-0 rounded-quiet-sm bg-surface-low text-foreground hover:bg-surface-raised/75"
                  onClick={handleBrowseDest}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </Field>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-quiet-lg bg-surface-low/90 p-4">
        <Checkbox id="copyFiles" checked={copyFiles} onCheckedChange={(checked) => setCopyFiles(Boolean(checked))} />
        <Label htmlFor="copyFiles" className="cursor-pointer text-sm leading-6">
          {t.tools.syncSidecarFiles}
        </Label>
      </div>
      <Button
        variant="secondary"
        className={cn(TOOL_SECONDARY_BUTTON_CLASS, "w-full sm:w-auto")}
        disabled={!sourceDir.trim() || !destDir.trim() || state?.pending}
        onClick={() => onRun({ sourceDir, destDir, copyFiles, dryRun })}
      >
        {state?.pending ? t.tools.processing : t.tools.createMappingNow}
      </Button>
      <ToolState state={state} pre />
    </div>
  );
}

export function ToolDetailShell({ toolId, children }: { toolId: ToolId; children: React.ReactNode }) {
  const tool = TOOL_DEFINITIONS.find((candidate) => candidate.id === toolId);
  return tool ? <ToolShell tool={tool}>{children}</ToolShell> : null;
}

function ToolState({ state, pre = false }: { state?: ToolRunState; pre?: boolean }) {
  if (!state) return null;
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (state.data && pre) {
    return (
      <pre className="max-h-[360px] overflow-auto rounded-quiet bg-surface-low p-3 text-xs text-muted-foreground">
        {JSON.stringify(state.data, null, 2)}
      </pre>
    );
  }
  if (state.data) {
    return (
      <p className="rounded-quiet bg-surface-low p-3 text-sm text-muted-foreground">{JSON.stringify(state.data)}</p>
    );
  }
  if (state.message) return <p className="text-sm text-muted-foreground">{state.message}</p>;
  return null;
}
