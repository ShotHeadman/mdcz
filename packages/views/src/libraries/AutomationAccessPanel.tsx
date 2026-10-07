import type { ApiKeyDto } from "@mdcz/shared/serverDtos";
import { Button, cn, Input, quietPanelSurfaceClass } from "@mdcz/ui";
import { Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useT } from "../i18n";

export interface AutomationAccessPanelProps {
  keys: ApiKeyDto[];
  /** The origin downloaders reach this server at, as the browser sees it. */
  origin: string;
  onCreate: (name: string) => Promise<string>;
  onRevoke: (id: string) => Promise<void>;
}

const copy = async (value: string) => await navigator.clipboard.writeText(value);

export function AutomationAccessPanel({ keys, origin, onCreate, onRevoke }: AutomationAccessPanelProps) {
  const t = useT();
  const [name, setName] = useState("qBittorrent");
  const [secret, setSecret] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const shownKey = secret ?? "<API key>";
  // A query parameter survives Windows backslashes and spaces in %F, which JSON quoting would not.
  const qbittorrentCommand = `curl -fsS -X POST -G -H "Authorization: Bearer ${shownKey}" --data-urlencode "path=%F" ${origin}/api/automation/scrape/start`;

  return (
    <section className={cn(quietPanelSurfaceClass, "space-y-5 rounded-quiet-xl p-5")}>
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
          <KeyRound className="h-4 w-4" />
          {t.libraries.access.title}
        </h2>
        <p className="text-sm text-muted-foreground">{t.libraries.access.description}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t.libraries.access.keyName}
          className="max-w-xs"
          placeholder={t.libraries.access.keyNamePlaceholder}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          disabled={creating || !name.trim()}
          onClick={async () => {
            setCreating(true);
            try {
              setSecret(await onCreate(name.trim()));
            } finally {
              setCreating(false);
            }
          }}
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t.libraries.access.create}
        </Button>
      </div>

      {secret ? (
        <div className="space-y-1 rounded-quiet border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          <div className="font-medium">{t.libraries.access.created}</div>
          <CopyLine value={secret} />
        </div>
      ) : null}

      <ul className="divide-y divide-border/60 rounded-quiet border border-border/60">
        {keys.length === 0 ? (
          <li className="px-3 py-2 text-xs text-muted-foreground">{t.libraries.access.noKeys}</li>
        ) : null}
        {keys.map((key) => (
          <li key={key.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="font-medium">{key.name}</div>
              <div className="font-mono text-xs text-muted-foreground">
                {key.prefix}… ·{" "}
                {t.libraries.access.lastUsed(key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : null)}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void onRevoke(key.id)}>
              <Trash2 className="h-3.5 w-3.5" />
              {t.libraries.access.revoke}
            </Button>
          </li>
        ))}
      </ul>

      <Snippet title={t.libraries.access.qbittorrentTitle} hint={t.libraries.access.qbittorrentHint}>
        <CopyLine value={qbittorrentCommand} />
      </Snippet>
      <Snippet title={t.libraries.access.clouddriveTitle} hint={t.libraries.access.clouddriveHint}>
        <CopyLine value={`${origin}/api/webhooks/clouddrive`} />
      </Snippet>
    </section>
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
          await copy(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        <Copy className="h-3.5 w-3.5" />
        {copied ? t.libraries.access.copied : t.libraries.access.copy}
      </Button>
    </div>
  );
}
