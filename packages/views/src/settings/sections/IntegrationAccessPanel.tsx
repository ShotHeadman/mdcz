import { toErrorMessage } from "@mdcz/shared/error";
import type { ApiKeyDto, IntegrationStatusResponse } from "@mdcz/shared/serverDtos";
import { Button, copyText, Input } from "@mdcz/ui";
import { Copy, Loader2, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { useT } from "../../i18n";
import type { SettingsIntegrationServices } from "../SettingsServices";

const STATUS_REFRESH_MS = 5_000;

/** Polls the integrations' liveness while mounted; settings autosave, so a fix shows within seconds. */
export function useIntegrationStatus(integrations?: SettingsIntegrationServices): IntegrationStatusResponse | null {
  const [status, setStatus] = useState<IntegrationStatusResponse | null>(null);
  useEffect(() => {
    if (!integrations) return;
    let active = true;
    const refresh = () =>
      integrations.status().then(
        (next) => active && setStatus(next),
        (error: unknown) => toast.error(toErrorMessage(error), { id: "integration-status" }),
      );
    void refresh();
    const timer = window.setInterval(refresh, STATUS_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [integrations]);
  return status;
}

export function QbittorrentStatusLine({ status }: { status: IntegrationStatusResponse["qbittorrent"] }) {
  const t = useT();
  const text = t.settings.integrations;
  if (!status.configured || !status.lastPollAt)
    return <p className="py-2 text-xs text-muted-foreground">{text.qbittorrentOff}</p>;
  if (status.error) return <p className="py-2 text-xs text-destructive">{text.qbittorrentError(status.error)}</p>;
  return (
    <div className="space-y-1 py-2 text-xs">
      <p className="text-muted-foreground">
        {text.qbittorrentChecked(new Date(status.lastPollAt).toLocaleString(), status.library?.name ?? null)}
      </p>
      {status.library ? null : <p className="text-amber-600 dark:text-amber-400">{text.qbittorrentNoLibrary}</p>}
      {status.failures.length ? (
        <div className="text-destructive">
          <p>{text.qbittorrentFailures(status.failures.length)}</p>
          <ul className="list-disc pl-4">
            {status.failures.map((failure) => (
              <li key={failure.name} className="break-all">
                {failure.name}: {failure.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function IntegrationAccessPanel({
  integrations,
  cloudDriveLastEventAt,
}: {
  integrations: SettingsIntegrationServices;
  cloudDriveLastEventAt: string | null;
}) {
  const t = useT();
  const [keys, setKeys] = useState<ApiKeyDto[]>([]);
  const [name, setName] = useState("qBittorrent");
  const [secret, setSecret] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const shownKey = secret ?? "<API key>";
  // A query parameter survives Windows backslashes and spaces in %F, which JSON quoting would not.
  const finishedCommand = `curl -fsS -X POST -G -H "Authorization: Bearer ${shownKey}" --data-urlencode "path=%F" ${integrations.origin}/api/automation/scrape/start`;
  const run = async (action: () => Promise<void>) => {
    try {
      await action();
      setKeys(await integrations.listApiKeys());
    } catch (error) {
      toast.error(toErrorMessage(error), { id: "api-keys" });
    }
  };

  useEffect(() => {
    integrations
      .listApiKeys()
      .then(setKeys, (error: unknown) => toast.error(toErrorMessage(error), { id: "api-keys" }));
  }, [integrations]);

  return (
    <div className="space-y-5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t.settings.integrations.keyName}
          className="max-w-xs"
          placeholder={t.settings.integrations.keyNamePlaceholder}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          disabled={creating || !name.trim()}
          onClick={async () => {
            setCreating(true);
            await run(async () => setSecret(await integrations.createApiKey(name.trim())));
            setCreating(false);
          }}
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t.settings.integrations.create}
        </Button>
      </div>

      {secret ? (
        <div className="space-y-1 rounded-quiet border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          <div className="font-medium">{t.settings.integrations.created}</div>
          <CopyLine value={secret} />
        </div>
      ) : null}

      <ul className="divide-y divide-border/60 rounded-quiet border border-border/60">
        {keys.length === 0 ? (
          <li className="px-3 py-2 text-xs text-muted-foreground">{t.settings.integrations.noKeys}</li>
        ) : null}
        {keys.map((key) => (
          <li key={key.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="font-medium">{key.name}</div>
              <div className="font-mono text-xs text-muted-foreground">
                {key.prefix}… ·{" "}
                {t.settings.integrations.lastUsed(key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : null)}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void run(async () => await integrations.revokeApiKey(key.id))}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t.settings.integrations.revoke}
            </Button>
          </li>
        ))}
      </ul>

      <p className="text-xs text-muted-foreground">{t.settings.integrations.addressHint}</p>
      <Snippet title={t.settings.integrations.commandTitle} hint={t.settings.integrations.commandHint}>
        <CopyLine value={finishedCommand} />
      </Snippet>
      <Snippet title={t.settings.integrations.clouddriveTitle} hint={t.settings.integrations.clouddriveHint}>
        <CopyLine value={`${integrations.origin}/api/webhooks/clouddrive`} />
        <p className="text-xs text-muted-foreground">
          {t.settings.integrations.clouddriveLastEvent(
            cloudDriveLastEventAt ? new Date(cloudDriveLastEventAt).toLocaleString() : null,
          )}
        </p>
      </Snippet>
    </div>
  );
}

function Snippet({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-sm font-semibold">{title}</div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {children}
    </div>
  );
}

function CopyLine({ value }: { value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 break-all rounded-quiet bg-surface-low px-2 py-1.5 font-mono text-[11px]">
        {value}
      </code>
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          await copyText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        <Copy className="h-3.5 w-3.5" />
        {copied ? t.settings.integrations.copied : t.settings.integrations.copy}
      </Button>
    </div>
  );
}
