import type { BriefCheckResponse } from "@mdcz/shared/briefCatalog";
import type { LlmSettings } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import { LLM_SERVICE_TYPE_OPTIONS } from "@mdcz/shared/llm";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PasswordInput,
} from "@mdcz/ui";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { useT } from "../i18n";
import { OptionSelect } from "./cardParts";

const DISMISSED_KEY = "mdcz-brief-setup-dismissed";

export const isBriefSetupDismissed = (): boolean =>
  typeof localStorage !== "undefined" && localStorage.getItem(DISMISSED_KEY) === "1";

/**
 * The first-run step, beside the hero card while Brief is off. It explains the feature by example, because
 * the sidebar item does not exist until the user has been through it.
 */
export function BriefSetupCard({
  className,
  llm,
  check,
  turnOn,
  onTurnedOn,
  onDismiss,
}: {
  className?: string;
  /** The saved AI model section, so a connection translation already uses is filled in. */
  llm: LlmSettings;
  check: (settings: LlmSettings) => Promise<BriefCheckResponse>;
  /** Saves the connection with Brief on; the page shows the change once the dialog closes. */
  turnOn: (settings: LlmSettings) => Promise<void>;
  onTurnedOn: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const text = t.brief.setup;
  const [open, setOpen] = useState(false);

  return (
    <section
      className={cn(
        "flex min-h-[210px] flex-col justify-between gap-5 rounded-quiet-xl border border-dashed border-border p-6 text-foreground md:p-7",
        className,
      )}
    >
      <div className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight">{text.title}</h2>
        <div className="space-y-2" aria-hidden="true">
          <p className="text-sm text-muted-foreground">{text.example}</p>
          <div className="flex items-center justify-end rounded-quiet border border-dashed border-border px-3 py-2">
            <span className="rounded-quiet bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
              {text.exampleCard}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          {text.action}
        </Button>
        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground"
          onClick={() => {
            localStorage.setItem(DISMISSED_KEY, "1");
            onDismiss();
          }}
        >
          {text.dismiss}
        </button>
      </div>
      {open ? (
        <SetupDialog
          llm={llm}
          check={check}
          turnOn={turnOn}
          onClose={(turnedOn) => {
            setOpen(false);
            if (turnedOn) onTurnedOn();
          }}
        />
      ) : null}
    </section>
  );
}

function SetupDialog({
  llm,
  check,
  turnOn,
  onClose,
}: {
  llm: LlmSettings;
  check: (settings: LlmSettings) => Promise<BriefCheckResponse>;
  turnOn: (settings: LlmSettings) => Promise<void>;
  onClose: (turnedOn: boolean) => void;
}) {
  const t = useT();
  const text = t.brief.setup;
  const id = useId();
  const [settings, setSettings] = useState(llm);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const edit = (patch: Partial<LlmSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    setMessage(null);
  };

  const testAndTurnOn = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const result = await check(settings);
      if (result.status !== "ok") {
        setMessage({ ok: false, text: t.brief.check.failed[result.status](result.error ?? "") });
        return;
      }
      await turnOn(settings);
      setMessage({ ok: true, text: text.turnedOn });
    } catch (error) {
      setMessage({ ok: false, text: t.brief.check.failed.failed(toErrorMessage(error)) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(Boolean(message?.ok))}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{text.dialogTitle}</DialogTitle>
          <DialogDescription>{text.dialogDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-service`}>{text.service}</Label>
            <OptionSelect
              id={`${id}-service`}
              value={settings.serviceType}
              placeholder={text.service}
              options={LLM_SERVICE_TYPE_OPTIONS.map((value) => ({
                value,
                label: t.settings.options.llmServiceType[value],
              }))}
              onChange={(serviceType) => edit({ serviceType })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-url`}>{text.baseUrl}</Label>
            <Input
              id={`${id}-url`}
              value={settings.baseUrl}
              onChange={(event) => edit({ baseUrl: event.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-key`}>{text.apiKey}</Label>
            <PasswordInput
              id={`${id}-key`}
              visibilityLabels={{ show: t.common.showPassword, hide: t.common.hidePassword }}
              value={settings.apiKey}
              onChange={(event) => edit({ apiKey: event.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-model`}>{text.model}</Label>
            <Input
              id={`${id}-model`}
              value={settings.modelName}
              onChange={(event) => edit({ modelName: event.target.value })}
            />
          </div>
          <p className="text-xs text-muted-foreground">{text.privacy}</p>
          {message ? (
            <p role="status" className={cn("text-sm", message.ok ? "text-foreground" : "text-destructive")}>
              {message.text}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onClose(Boolean(message?.ok))}>
            {message?.ok ? t.common.close : text.dismiss}
          </Button>
          {message?.ok ? null : (
            <Button type="button" disabled={testing} onClick={() => void testAndTurnOn()}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {testing ? text.testing : text.testAndTurnOn}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
