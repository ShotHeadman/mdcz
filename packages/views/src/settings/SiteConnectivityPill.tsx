import type { Website } from "@mdcz/shared/enums";
import { Button, cn } from "@mdcz/ui";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FieldValues } from "react-hook-form";
import { useFormContext, useWatch } from "react-hook-form";
import { getT, useT } from "../i18n";
import { useSettingsInFlightSaves, useSettingsServices } from "./SettingsServices";

type ConnectivityState =
  | { kind: "idle"; configChanged: boolean }
  | { kind: "loading" }
  | { kind: "success" | "error"; message: string };

interface SiteConnectivityPillProps {
  site: Website;
  /** Runs after every check; a passing check lifts the site's unavailability on the backend. */
  onChecked?: () => void;
}

export function SiteConnectivityPill({ site, onChecked }: SiteConnectivityPillProps) {
  const t = useT();
  const form = useFormContext<FieldValues>();
  const services = useSettingsServices();
  const inFlightSaves = useSettingsInFlightSaves();
  const [state, setState] = useState<ConnectivityState>({ kind: "idle", configChanged: false });
  const hasMountedRef = useRef(false);
  const requestVersionRef = useRef(0);

  const probeDependencies = useWatch({
    control: form.control,
    name: [
      "network.proxyType",
      "network.proxy",
      "network.useProxy",
      "network.directSites",
      "network.javdbUrl",
      "network.javbusUrl",
      "network.javdbCookie",
      "network.javbusCookie",
      "network.fantiaCookie",
    ],
  }) as unknown[] | undefined;
  const probeDependencyKey = (probeDependencies ?? []).join("::");

  useEffect(() => {
    void probeDependencyKey;

    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    requestVersionRef.current += 1;
    setState({ kind: "idle", configChanged: true });
  }, [probeDependencyKey]);

  const handleProbe = async () => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setState({ kind: "loading" });

    try {
      const result = await services.probeSiteConnectivity(site);
      if (requestVersionRef.current !== requestVersion) {
        return;
      }

      const messages = getT();
      const text = messages.settings.siteConnectivity;
      const httpResult =
        result.status === undefined
          ? `${text.requestFailed}: ${result.error}`
          : text.httpResult(result.ok, result.status, Math.max(0, Math.trunc(result.latencyMs)));
      setState({
        kind: result.ok ? "success" : "error",
        message: result.redirectedHost
          ? text.redirected(result.redirectedHost)
          : result.reason
            ? `${messages.domain.failureReasons[result.reason]} · ${httpResult}`
            : httpResult,
      });
      onChecked?.();
    } catch (error) {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }

      setState({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const disabled = state.kind === "loading" || inFlightSaves > 0;
  const text = t.settings.connectivity;
  const message =
    state.kind === "idle"
      ? state.configChanged
        ? text.configChanged
        : text.notChecked
      : state.kind === "loading"
        ? text.checking
        : state.message;
  const disabledTitle = inFlightSaves > 0 ? text.waitForAutosave : message;

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={disabled}
        onClick={handleProbe}
        title={disabledTitle}
        className="rounded-[var(--radius-quiet-capsule)] px-2.5 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {text.test}
      </Button>
      <span
        title={message}
        hidden={state.kind === "idle"}
        className={cn(
          "inline-flex min-w-[64px] items-center justify-center gap-1 rounded-[var(--radius-quiet-capsule)] px-2.5 py-1 text-[11px] font-medium",
          state.kind === "loading" && "bg-surface-low text-foreground",
          state.kind === "success" && "bg-emerald-500/10 text-emerald-700",
          state.kind === "error" && "bg-rose-500/10 text-rose-700",
        )}
      >
        {state.kind === "loading" && <Loader2 className="h-3 w-3 animate-spin" />}
        <span>{text.status[state.kind]}</span>
      </span>
    </div>
  );
}
