import { type BriefParams, CHECK_TARGETS, MEDIA_SERVERS } from "@mdcz/shared/briefCatalog";
import type { Configuration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type {
  NetworkCheckCookiesResponse,
  SiteConnectivityProbeResponse,
  TranslateTestResponse,
} from "@mdcz/shared/serverDtos";
import type { MediaServerConnectionCheckResult } from "@mdcz/shared/toolTypes";
import { cn } from "@mdcz/ui";
import { type Messages, useT } from "../i18n";
import { ConnectionCheckResult, PERSON_SERVER_NAMES } from "../tools/details/PersonMediaLibraryDetail";
import { CrawlerTesterResult } from "../tools/details/ToolDetails";
import type { BriefPort, CrawlerTestResult } from "./BriefPort";
import type { BriefOutcome } from "./briefStore";
import {
  type BriefCardProps,
  type BriefRequestAnswer,
  CardRow,
  CardShell,
  choiceOptions,
  findDrop,
  OptionSelect,
  TextValue,
  useLoad,
} from "./cardParts";

type CheckParams = BriefParams["check"];
type CheckTarget = NonNullable<CheckParams["target"]>;

/** What a check answered, as the tool that owns it draws it. Kept in memory only, beside the outcome line. */
export type CheckResult =
  | { target: "sites"; sites: Array<{ site: Website; probe: SiteConnectivityProbeResponse }> }
  | { target: "cookies"; response: NetworkCheckCookiesResponse }
  | { target: "translation"; response: TranslateTestResponse }
  | { target: "notifications" }
  | { target: "mediaServer"; server: "jellyfin" | "emby"; response: MediaServerConnectionCheckResult }
  | { target: "crawler"; response: CrawlerTestResult };

const runCheck = async (port: BriefPort, params: CheckParams, config: Configuration): Promise<BriefRequestAnswer> => {
  const target = params.target as CheckTarget;
  const outcome = (passed: number, total: number, detail?: string): BriefOutcome => ({
    kind: "check",
    target,
    passed,
    total,
    detail,
  });
  if (target === "sites") {
    const sites = await Promise.all(
      config.scrape.sites.map(async (site) => ({ site, probe: await port.probeSite(site) })),
    );
    const result: CheckResult = { target, sites };
    return { outcome: outcome(sites.filter((entry) => entry.probe.ok).length, sites.length), result };
  }
  if (target === "cookies") {
    const response = await port.checkCookies();
    return {
      outcome: outcome(response.results.filter((entry) => entry.valid).length, response.results.length),
      result: { target, response } satisfies CheckResult,
    };
  }
  if (target === "translation") {
    const response = await port.testTranslation({});
    return {
      outcome: outcome(response.status === "ok" ? 1 : 0, 1, response.sample),
      result: { target, response } satisfies CheckResult,
    };
  }
  if (target === "notifications") {
    await port.testNotifications(config.notifications);
    return { outcome: outcome(1, 1), result: { target } satisfies CheckResult };
  }
  if (target === "mediaServer") {
    const server = params.server ?? "jellyfin";
    const response = await port.checkMediaServer(server);
    return {
      outcome: outcome(response.success ? 1 : 0, 1, PERSON_SERVER_NAMES[server]),
      result: { target, server, response } satisfies CheckResult,
    };
  }
  const response = await port.crawlerTest({
    number: params.number ?? "",
    site: params.site,
    manualUrl: params.url,
  });
  return {
    outcome: outcome(response.data ? 1 : 0, 1, response.data?.title ?? params.number),
    result: { target, response } satisfies CheckResult,
  };
};

const notificationTargets = (t: Messages, config: Configuration): string[] => [
  ...config.notifications.channels.map((channel) => t.settings.notificationChannels[channel]),
  ...(config.notifications.webhookUrl ? ["Webhook"] : []),
];

/** One read-only check; its answer is drawn by the component that draws it on its own page. */
export function CheckCard({ cell, port, onChange, onRequest }: BriefCardProps) {
  const t = useT();
  const params = cell.params as CheckParams;
  const target = params.target;
  const config = useLoad(() => port.config(), "config");
  const configuration = config.data;
  const enabledSites = configuration?.scrape.sites ?? [];
  const notify = configuration ? notificationTargets(t, configuration) : [];
  const confirm = t.brief.card.confirm;
  const label =
    target === "sites"
      ? confirm.checkSites(enabledSites.length)
      : target === "cookies"
        ? confirm.checkCookies
        : target === "translation"
          ? confirm.checkTranslation
          : target === "notifications"
            ? confirm.checkNotifications
            : target === "mediaServer"
              ? confirm.checkServer(PERSON_SERVER_NAMES[params.server ?? "jellyfin"])
              : target === "crawler"
                ? confirm.crawlerTest(params.number || "…")
                : confirm.fallback;
  const disabled =
    !configuration ||
    !target ||
    (target === "crawler" && !params.number) ||
    (target === "notifications" && notify.length === 0) ||
    (target === "sites" && enabledSites.length === 0);

  return (
    <CardShell
      confirmLabel={label}
      confirmDisabled={disabled}
      confirming={false}
      error={config.error}
      onConfirm={() => configuration && onRequest(() => runCheck(port, params, configuration))}
    >
      <CardRow label={t.brief.params.target} dropped={findDrop(cell, "target")}>
        {(id) => (
          <OptionSelect
            id={id}
            value={target}
            placeholder={t.brief.card.chooseCheck}
            options={choiceOptions(t, "check", "target", CHECK_TARGETS)}
            onChange={(value) => onChange({ target: value })}
          />
        )}
      </CardRow>
      {target === "mediaServer" ? (
        <CardRow label={t.brief.params.server} dropped={findDrop(cell, "server")}>
          {(id) => (
            <OptionSelect
              id={id}
              value={params.server ?? "jellyfin"}
              placeholder={t.brief.card.chooseServer}
              options={choiceOptions(t, "check", "server", MEDIA_SERVERS)}
              onChange={(value) => onChange({ server: value })}
            />
          )}
        </CardRow>
      ) : null}
      {target === "crawler" ? (
        <>
          {(["number", "url"] as const).map((key) => (
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
                  placeholder={key === "number" ? t.tools.movieCodePlaceholder : t.tools.manualUrlPlaceholder}
                  onCommit={(value) => onChange({ [key]: value || undefined })}
                />
              )}
            </CardRow>
          ))}
          <CardRow label={t.brief.params.site} dropped={findDrop(cell, "site")}>
            {(id) => (
              <OptionSelect
                id={id}
                value={params.site ?? "all"}
                placeholder={t.tools.selectSite}
                options={[
                  { value: "all", label: t.tools.aggregateByConfig },
                  ...Object.values(Website).map((site) => ({ value: site, label: site })),
                ]}
                onChange={(value) => onChange({ site: value === "all" ? undefined : value })}
              />
            )}
          </CardRow>
        </>
      ) : null}
      {target && target !== "crawler" && target !== "mediaServer" ? (
        <CardRow label={t.brief.card.checksLabel}>
          {() => (
            <p className="text-sm leading-5 break-words sm:pt-2.5">
              {!configuration
                ? t.brief.card.loading
                : target === "sites"
                  ? enabledSites.join(", ")
                  : target === "notifications"
                    ? notify.join(", ") || t.brief.card.noNotifications
                    : target === "translation"
                      ? t.settings.options.translateEngine[configuration.translate.engine]
                      : t.brief.card.cookieSites}
            </p>
          )}
        </CardRow>
      ) : null}
    </CardShell>
  );
}

/** A finished check's answer, drawn the way its own page draws it. */
export function CheckResultView({ result }: { result: CheckResult }) {
  const t = useT();
  if (result.target === "mediaServer") return <ConnectionCheckResult server={result.server} result={result.response} />;
  if (result.target === "crawler")
    return <CrawlerTesterResult result={{ data: result.response.data, elapsed: result.response.elapsed }} />;
  if (result.target === "notifications") return null;
  if (result.target === "translation")
    return (
      <p
        className={cn(
          "rounded-quiet-lg border border-border px-4 py-3 text-sm",
          result.response.status !== "ok" && "text-foreground",
        )}
      >
        {result.response.status === "ok"
          ? result.response.sample
          : t.brief.card.translationFailed(result.response.error ?? result.response.status)}
      </p>
    );
  const rows =
    result.target === "sites"
      ? result.sites.map(({ site, probe }) => ({
          key: site,
          ok: probe.ok,
          label: site,
          detail: probe.ok
            ? `${probe.latencyMs} ms`
            : (probe.error ?? (probe.status ? `HTTP ${probe.status}` : t.common.failed)),
        }))
      : result.response.results.map((entry) => ({
          key: entry.site,
          ok: entry.valid,
          label: entry.site,
          detail: t.configForm.cookieCheckStatus[entry.status](entry.site),
        }));
  return (
    <ul className="divide-y divide-border/50 rounded-quiet-lg border border-border text-sm">
      {rows.map((row) => (
        <li key={row.key} className="flex items-start justify-between gap-4 px-4 py-2">
          <span className="font-medium">{row.label}</span>
          <span
            className={cn("min-w-0 text-right text-xs leading-5", row.ok ? "text-muted-foreground" : "text-foreground")}
          >
            {row.detail}
          </span>
        </li>
      ))}
    </ul>
  );
}
